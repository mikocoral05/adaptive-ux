import "whatwg-fetch"; // Polyfill fetch for JSDOM tests
import { AdaptiveUXManager } from "./index";
import { StrictAdaptiveUXConfig, Vibe } from "./types";
import { delay, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer();

type AdaptiveUXManagerInternals = {
  config: StrictAdaptiveUXConfig;
  getBatteryHealth: () => Promise<number>;
  getCPUHealth: () => number;
  getNetworkHealth: () => number | Promise<number>;
  getNetworkHealthByPing: () => Promise<number>;
  getNetworkHealthFromConnection: () => number;
  updateHealthAndVibe: () => Promise<void>;
};

const getInternals = (
  instance: AdaptiveUXManager,
): AdaptiveUXManagerInternals =>
  instance as unknown as AdaptiveUXManagerInternals;

// Mock browser APIs that are not in jsdom or need to be controlled
beforeAll(() => {
  server.listen({ onUnhandledRequest: "warn" });

  // Mock for localStorage
  const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
      getItem: (key: string) => store[key] || null,
      setItem: (key: string, value: string) => {
        store[key] = value.toString();
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        store = {};
      },
    };
  })();
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
  });

  // Mock for navigator.connection
  Object.defineProperty(navigator, "connection", {
    value: {
      downlink: 10, // PREMIUM default
      rtt: 50, // PREMIUM default
    },
    writable: true,
  });

  // Mock for navigator.getBattery
  Object.defineProperty(navigator, "getBattery", {
    value: async () => ({
      level: 1, // PREMIUM default
      charging: true, // PREMIUM default
    }),
    writable: true,
  });

  // Mock for performance.now() used in CPU benchmark
  let performanceNow = 0;
  Object.defineProperty(performance, "now", {
    value: () => {
      performanceNow += 50; // Simulate time passing
      return performanceNow;
    },
    writable: true,
  });

  // Mock for AbortSignal.timeout which might be missing in jsdom
  if (!AbortSignal.timeout) {
    AbortSignal.timeout = (ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error("TimeoutError")), ms);
      return controller.signal;
    };
  }
});

describe("AdaptiveUXManager", () => {
  let manager: AdaptiveUXManager;

  // Stop any running manager after each test to clean up intervals
  afterEach(() => {
    manager?.stop();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it("should initialize with a PREMIUM vibe by default", () => {
    manager = new AdaptiveUXManager();
    expect(manager.getCurrentState().vibe).toBe("PREMIUM");
  });

  it("should accept an initialVibe in config", () => {
    manager = new AdaptiveUXManager({ initialVibe: "LITE" });
    expect(manager.getCurrentState().vibe).toBe("LITE");
  });

  describe("Configuration Merging", () => {
    beforeEach(() => {
      // Prevent the constructor's automatic `start` call
      jest
        .spyOn(AdaptiveUXManager.prototype, "start")
        .mockImplementation(() => {});
    });

    it("should use default configuration when no config is provided", () => {
      manager = new AdaptiveUXManager();
      const config = getInternals(manager).config;
      expect(config.checkInterval).toBe(5000);
      expect(config.initialVibe).toBe("PREMIUM");
      expect(config.network.downlinkThresholds.LITE).toBe(0.5);
      expect(config.network.ping.url).toBe(""); // Default disabled ping
    });

    it("should merge top-level options", () => {
      manager = new AdaptiveUXManager({
        checkInterval: 10000,
        initialVibe: "LITE",
      });
      const config = getInternals(manager).config;
      expect(config.checkInterval).toBe(10000);
      expect(config.initialVibe).toBe("LITE");
    });

    it("should deeply merge nested options", () => {
      manager = new AdaptiveUXManager({
        network: {
          downlinkThresholds: { LITE: 1, MEDIUM: 5 },
          ping: { url: "https://example.com", sizeInBytes: 50000 },
        },
      });
      const config = getInternals(manager).config;

      // Overridden values
      expect(config.network.downlinkThresholds.LITE).toBe(1);
      expect(config.network.downlinkThresholds.MEDIUM).toBe(5);
      expect(config.network.ping.url).toBe("https://example.com");

      // Retained default values
      expect(config.network.rttThresholds.LITE).toBe(600);
      expect(config.network.ping.throughputThresholds.LITE).toBe(0.7);
    });
  });

  it('should emit a "vibechange" event when the vibe changes', async () => {
    // Prevent the constructor's automatic `start` call to isolate the test
    jest
      .spyOn(AdaptiveUXManager.prototype, "start")
      .mockImplementation(() => {});

    manager = new AdaptiveUXManager({ initialVibe: "PREMIUM" });
    const listener = jest.fn();
    manager.addEventListener("vibechange", listener);

    // Make all signals LITE to force a change
    const internals = getInternals(manager);
    jest.spyOn(internals, "getCPUHealth").mockReturnValue(0);
    jest.spyOn(internals, "getNetworkHealth").mockReturnValue(0);
    jest.spyOn(internals, "getBatteryHealth").mockResolvedValue(0);

    await internals.updateHealthAndVibe();

    expect(listener).toHaveBeenCalledTimes(1);
    const eventDetail = listener.mock.calls[0][0].detail;
    expect(eventDetail.vibe).toBe("LITE");
  });

  describe("Vibe Calculation Logic", () => {
    beforeEach(() => {
      // Prevent the constructor's automatic `start` call to allow manual control
      jest
        .spyOn(AdaptiveUXManager.prototype, "start")
        .mockImplementation(() => {});
      manager = new AdaptiveUXManager();
    });

    const testVibe = async (
      health: { cpu: number; network: number; battery: number },
      expectedVibe: Vibe,
    ) => {
      const internals = getInternals(manager);
      jest.spyOn(internals, "getCPUHealth").mockReturnValue(health.cpu);
      jest.spyOn(internals, "getNetworkHealth").mockReturnValue(health.network);
      jest
        .spyOn(internals, "getBatteryHealth")
        .mockResolvedValue(health.battery);

      await internals.updateHealthAndVibe();
      expect(manager.getCurrentState().vibe).toBe(expectedVibe);
    };

    it("should be PREMIUM when all signals are good", async () => {
      await testVibe({ cpu: 1, network: 1, battery: 1 }, "PREMIUM");
    });

    it("should be MEDIUM when one signal is LITE", async () => {
      await testVibe({ cpu: 0, network: 1, battery: 1 }, "MEDIUM");
    });

    it("should be MEDIUM when two signals are MEDIUM", async () => {
      await testVibe({ cpu: 0.5, network: 0.5, battery: 1 }, "MEDIUM");
    });

    it("should be LITE when two signals are LITE", async () => {
      await testVibe({ cpu: 0, network: 0, battery: 1 }, "LITE");
    });
  });

  describe("Manual Vibe & localStorage", () => {
    beforeEach(() => {
      // Prevent the constructor's automatic `start` call
      jest
        .spyOn(AdaptiveUXManager.prototype, "start")
        .mockImplementation(() => {});
      window.localStorage.clear();
    });

    it("should save the manual vibe to localStorage", () => {
      manager = new AdaptiveUXManager({
        persistence: { enabled: true, key: "adaptive-ux-manual-vibe" },
      });
      manager.setManualVibe("LITE");

      expect(window.localStorage.getItem("adaptive-ux-manual-vibe")).toBe(
        "LITE",
      );
      expect(manager.getCurrentState().vibe).toBe("LITE");
    });

    it("should remove the manual vibe from localStorage when set to null", () => {
      manager = new AdaptiveUXManager({
        persistence: { enabled: true, key: "adaptive-ux-manual-vibe" },
      });
      manager.setManualVibe("MEDIUM");
      manager.setManualVibe(null); // Back to automatic

      expect(window.localStorage.getItem("adaptive-ux-manual-vibe")).toBeNull();
    });
  });

  describe("getNetworkHealthByPing", () => {
    beforeEach(() => {
      // Prevent the constructor's automatic `start` call
      jest
        .spyOn(AdaptiveUXManager.prototype, "start")
        .mockImplementation(() => {});

      // Suppress expected console errors in the test output
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    it("should return 1 (PREMIUM) if ping is not configured", async () => {
      manager = new AdaptiveUXManager({
        network: { ping: { url: "", sizeInBytes: 0 } },
      });
      // Accessing private method for testing
      const health = await getInternals(manager).getNetworkHealthByPing();
      expect(health).toBe(1);
    });

    const runPingTest = async (downloadTimeMs: number) => {
      manager = new AdaptiveUXManager({
        network: {
          ping: {
            url: "https://example.com/ping",
            sizeInBytes: 500000, // 0.5 MB
            throughputThresholds: { LITE: 1, MEDIUM: 5 }, // 1 Mbps, 5 Mbps
          },
        },
      });

      // Mock performance.now to control time measurement
      let now = 0;
      jest.spyOn(performance, "now").mockImplementation(() => {
        const current = now;
        now += downloadTimeMs; // Advance time for the next call (endTime)
        return current;
      });

      server.use(
        http.get("https://example.com/ping", () => {
          return HttpResponse.arrayBuffer(new ArrayBuffer(0));
        }),
      );

      return await getInternals(manager).getNetworkHealthByPing();
    };

    it("should return 1 (PREMIUM) for a fast connection", async () => {
      // 0.5 MB in 0.5s = 1 MB/s = 8 Mbps. 8 > 5 (MEDIUM threshold) -> PREMIUM
      const health = await runPingTest(500);
      expect(health).toBe(1);
    });

    it("should return 0.5 (MEDIUM) for a medium connection", async () => {
      // 0.5 MB in 1.5s = 0.333 MB/s = 2.66 Mbps. 1 < 2.66 < 5 -> MEDIUM
      const health = await runPingTest(1500);
      expect(health).toBe(0.5);
    });

    it("should return 0 (LITE) for a slow connection", async () => {
      // 0.5 MB in 5s = 0.1 MB/s = 0.8 Mbps. 0.8 < 1 (LITE threshold) -> LITE
      const health = await runPingTest(5000);
      expect(health).toBe(0);
    });

    it("should fall back to connection health if fetch fails", async () => {
      manager = new AdaptiveUXManager({
        network: { ping: { url: "https://example.com/ping", sizeInBytes: 1 } },
      });
      server.use(
        http.get("https://example.com/ping", () => {
          return HttpResponse.error();
        }),
      );
      const fallbackSpy = jest
        .spyOn(getInternals(manager), "getNetworkHealthFromConnection")
        .mockReturnValue(0.5);

      const health = await getInternals(manager).getNetworkHealthByPing();
      expect(health).toBe(0.5);
      expect(fallbackSpy).toHaveBeenCalled();
    });

    it("should fall back to connection health on a non-ok response", async () => {
      manager = new AdaptiveUXManager({
        network: { ping: { url: "https://example.com/ping", sizeInBytes: 1 } },
      });
      server.use(
        http.get("https://example.com/ping", () => {
          return new HttpResponse(null, { status: 404 });
        }),
      );
      const fallbackSpy = jest
        .spyOn(getInternals(manager), "getNetworkHealthFromConnection")
        .mockReturnValue(0);

      const health = await getInternals(manager).getNetworkHealthByPing();
      expect(health).toBe(0);
      expect(fallbackSpy).toHaveBeenCalled();
    });

    it("should fall back to connection health if fetch times out", async () => {
      manager = new AdaptiveUXManager({
        network: { ping: { url: "https://example.com/ping", sizeInBytes: 1 } },
      });
      server.use(
        http.get("https://example.com/ping", async () => {
          // Delay the response by 5 seconds (exceeds the 4000ms AbortSignal timeout)
          await delay(5000);
          return HttpResponse.arrayBuffer(new ArrayBuffer(0));
        }),
      );
      const fallbackSpy = jest
        .spyOn(getInternals(manager), "getNetworkHealthFromConnection")
        .mockReturnValue(0.5);

      const health = await getInternals(manager).getNetworkHealthByPing();
      expect(health).toBe(0.5);
      expect(fallbackSpy).toHaveBeenCalled();
    }, 10000); // Increase jest timeout to 10s so it doesn't fail before the 5s mock delay
  });

  describe("Integration: Lifecycle and Polling", () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.spyOn(window, "setInterval");
      jest.spyOn(window, "clearInterval");
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("should start polling on initialization and stop when requested", () => {
      manager = new AdaptiveUXManager({ checkInterval: 3000 });

      expect(window.setInterval).toHaveBeenCalledWith(
        expect.any(Function),
        3000,
      );

      manager.stop();
      expect(window.clearInterval).toHaveBeenCalled();
    });

    it("should stop polling when manual vibe is set and restart when cleared", () => {
      manager = new AdaptiveUXManager({ checkInterval: 3000 });
      expect(window.setInterval).toHaveBeenCalledTimes(1);

      manager.setManualVibe("LITE");
      expect(window.clearInterval).toHaveBeenCalledTimes(1);

      manager.setManualVibe(null);
      expect(window.setInterval).toHaveBeenCalledTimes(2);
    });
  });
});
