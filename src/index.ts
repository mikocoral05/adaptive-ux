import {
  Vibe,
  AdaptiveUXConfig,
  StrictAdaptiveUXConfig,
  CapabilityState,
} from "./types";

// Re-export all types so consumers of the library can use them
export * from "./types";

type BatteryManagerLike = {
  charging: boolean;
  level: number;
};

type NetworkInformationLike = {
  downlink: number;
  rtt: number;
};

type NavigatorWithDeviceInfo = Navigator & {
  connection?: NetworkInformationLike;
  getBattery?: () => Promise<BatteryManagerLike>;
};

// A more comprehensive benchmark function that runs a variety of tasks.
const runCpuBenchmark = () => {
  const start = performance.now();

  // Task 1: Math-heavy operations - more complex than just sqrt
  for (let i = 0; i < 500_000; i++) {
    (Math.sin(i) * Math.cos(i)) / Math.tan(i);
  }

  // Task 2: String manipulation
  let str = "hello";
  for (let i = 0; i < 5_000; i++) {
    str += "a";
    if (str.length > 1000) {
      str = str.substring(str.length - 500);
    }
  }

  // Task 3: Array and object manipulation
  const arr = Array.from({ length: 500 }, (_, i) => ({ val: i }));
  for (let i = 0; i < 5; i++) {
    arr.sort((a, b) => b.val - a.val);
    arr.map((item) => ({ ...item, val: item.val * 2 }));
  }

  return performance.now() - start;
};

// Default throughput thresholds for the ping test, in Mbps.
const defaultThroughputThresholds = { LITE: 0.7, MEDIUM: 4 };

// Default configuration values. These are sensible starting points.
const defaultConfig: StrictAdaptiveUXConfig = {
  initialVibe: "PREMIUM",
  checkInterval: 5000, // Check health every 5 seconds
  cpu: {
    /**
     * A more robust benchmark that runs multiple iterations of a varied workload
     * to get a more stable and representative CPU score. Lower is better.
     */
    benchmark: () => {
      const runs = 3;
      let totalTime = 0;
      // Run multiple times and average the result for stability.
      for (let i = 0; i < runs; i++) {
        totalTime += runCpuBenchmark();
      }
      return totalTime / runs;
    },
    // Lower is better. Calibrate these for your app's specific needs.
    thresholds: { LITE: 300, MEDIUM: 150 }, // in ms - NOTE: These may need recalibration
  },
  network: {
    // Higher is better.
    downlinkThresholds: { LITE: 0.5, MEDIUM: 2 }, // in Mbps
    // Lower is better.
    rttThresholds: { LITE: 600, MEDIUM: 300 }, // in ms
    ping: {
      url: "", // Empty string means disabled
      sizeInBytes: 0,
      throughputThresholds: defaultThroughputThresholds,
    },
  },
  battery: {
    // Lower is worse.
    levelThresholds: { LITE: 0.2, MEDIUM: 0.5 },
  },
  persistence: {
    enabled: false,
    key: "adaptive-ux-manual-vibe",
  },
};

/**
 * The main class for managing the adaptive user experience.
 */
export class AdaptiveUXManager extends EventTarget {
  private state: CapabilityState;
  private config: StrictAdaptiveUXConfig;
  private intervalId: number | undefined;
  private isManual: boolean = false;

  constructor(config: AdaptiveUXConfig = {}) {
    super();
    // Deep merge of default and user config
    const networkConfig = {
      ...defaultConfig.network,
      ...config.network,
      ping: {
        ...defaultConfig.network.ping,
        ...config.network?.ping,
        throughputThresholds: {
          ...defaultConfig.network.ping.throughputThresholds,
          ...config.network?.ping?.throughputThresholds,
        },
      },
    };

    this.config = {
      ...defaultConfig,
      ...config,
      cpu: { ...defaultConfig.cpu, ...config.cpu },
      battery: { ...defaultConfig.battery, ...config.battery },
      network: networkConfig,
      persistence: { ...defaultConfig.persistence, ...config.persistence },
    } as StrictAdaptiveUXConfig;

    const persistedVibe = this.getPersistedVibe();
    if (persistedVibe) {
      this.isManual = true;
      this.state = {
        vibe: persistedVibe,
        health: { cpu: 1, network: 1, battery: 1 }, // Neutral health for manual mode
      };
    } else {
      this.state = {
        vibe: this.config.initialVibe,
        health: {
          cpu: 1,
          network: 1,
          battery: 1,
        },
      };
    }

    this.start();
  }

  private getPersistedVibe(): Vibe | null {
    if (!this.config.persistence.enabled) {
      return null;
    }
    try {
      const storedVibe = localStorage.getItem(this.config.persistence.key);
      if (
        storedVibe === "LITE" ||
        storedVibe === "MEDIUM" ||
        storedVibe === "PREMIUM"
      ) {
        return storedVibe;
      }
    } catch (error) {
      console.error("Adaptive-UX: Could not read from localStorage.", error);
    }
    return null;
  }

  private async getBatteryHealth(): Promise<number> {
    const deviceNavigator = navigator as NavigatorWithDeviceInfo;
    if (!deviceNavigator.getBattery) {
      return 1; // API not supported, assume good health
    }
    try {
      const battery = await deviceNavigator.getBattery();
      const { levelThresholds } = this.config.battery;
      if (!battery.charging && battery.level < levelThresholds.LITE) return 0; // LITE
      if (!battery.charging && battery.level < levelThresholds.MEDIUM)
        return 0.5; // MEDIUM
      return 1; // PREMIUM
    } catch (error) {
      console.error("Adaptive-UX: Could not read battery status.", error);
      return 1; // Default to good on error
    }
  }

  private async getNetworkHealthByPing(): Promise<number> {
    const { ping } = this.config.network;
    if (!ping.url || !ping.sizeInBytes) {
      return 1; // Not configured, assume good health
    }

    try {
      const startTime = performance.now();
      // Use a cache-busting query parameter to ensure a fresh download
      const testUrl = new URL(ping.url);
      testUrl.searchParams.set("_", Date.now().toString());

      // Abort the request if it takes too long.
      const response = await fetch(testUrl.toString(), {
        cache: "no-store",
        signal: AbortSignal.timeout(4000), // 4-second timeout
      });

      if (!response.ok) {
        console.error(
          `Adaptive-UX: Network ping test failed with status ${response.status}.`,
        );
        return this.getNetworkHealthFromConnection(); // Fallback
      }
      await response.arrayBuffer();
      const endTime = performance.now();

      const durationInSeconds = (endTime - startTime) / 1000;
      if (durationInSeconds === 0) return 1; // Too fast to measure, assume excellent

      const bitsLoaded = ping.sizeInBytes * 8;
      const bps = bitsLoaded / durationInSeconds;
      const mbps = bps / (1024 * 1024);

      const thresholds = ping.throughputThresholds;
      if (mbps < thresholds.LITE) return 0;
      if (mbps < thresholds.MEDIUM) return 0.5;
      return 1;
    } catch (error) {
      console.error("Adaptive-UX: Network ping test failed.", error);
      // On failure (e.g., timeout, CORS error), fallback to the less reliable method.
      return this.getNetworkHealthFromConnection();
    }
  }

  private getNetworkHealthFromConnection(): number {
    const connection = (navigator as NavigatorWithDeviceInfo).connection;
    if (!connection) {
      return 1; // API not supported, assume good health
    }
    const { downlinkThresholds, rttThresholds } = this.config.network;
    if (
      connection.downlink < downlinkThresholds.LITE ||
      connection.rtt > rttThresholds.LITE
    )
      return 0; // LITE
    if (
      connection.downlink < downlinkThresholds.MEDIUM ||
      connection.rtt > rttThresholds.MEDIUM
    )
      return 0.5; // MEDIUM
    return 1;
  }

  private getNetworkHealth(): Promise<number> {
    if (this.config.network.ping.url) {
      return this.getNetworkHealthByPing();
    }
    return Promise.resolve(this.getNetworkHealthFromConnection());
  }

  private getCPUHealth(): number {
    const benchmarkTime = this.config.cpu.benchmark();
    const { thresholds } = this.config.cpu;
    if (benchmarkTime > thresholds.LITE) return 0; // LITE
    if (benchmarkTime > thresholds.MEDIUM) return 0.5; // MEDIUM
    return 1; // PREMIUM
  }

  private async updateHealthAndVibe() {
    if (this.isManual) return; // Do not run automatic checks in manual mode
    const [battery, network, cpu] = await Promise.all([
      this.getBatteryHealth(),
      this.getNetworkHealth(),
      Promise.resolve(this.getCPUHealth()),
    ]);

    this.state.health = { battery, network, cpu };

    const scores = Object.values(this.state.health);
    const liteSignals = scores.filter((s) => s === 0).length;
    const mediumSignals = scores.filter((s) => s === 0.5).length;

    let newVibe: Vibe = "PREMIUM";
    // Logic: 2+ LITE signals -> LITE, otherwise 1 LITE or 2+ MEDIUM -> MEDIUM
    if (liteSignals >= 2) {
      newVibe = "LITE";
    } else if (liteSignals === 1 || mediumSignals >= 2) {
      newVibe = "MEDIUM";
    }

    if (newVibe !== this.state.vibe) {
      this.state.vibe = newVibe;
      this.dispatchEvent(new CustomEvent("vibechange", { detail: this.state }));
    }
  }

  /**
   * Starts the periodic health checks. This is called automatically on instantiation.
   */
  public start(): void {
    if (this.intervalId || this.isManual) return; // Don't start if already running or in manual mode
    this.updateHealthAndVibe(); // Initial check
    this.intervalId = window.setInterval(
      () => this.updateHealthAndVibe(),
      this.config.checkInterval,
    );
  }

  /**
   * Stops the periodic health checks.
   */
  public stop(): void {
    if (this.intervalId !== undefined) {
      const clearTimer =
        typeof window.clearInterval === "function"
          ? window.clearInterval.bind(window)
          : typeof globalThis.clearInterval === "function"
            ? globalThis.clearInterval.bind(globalThis)
            : undefined;

      clearTimer?.(this.intervalId);
    }
    this.intervalId = undefined;
  }

  /**
   * Returns the current capability state.
   */
  public getCurrentState(): CapabilityState {
    return { ...this.state };
  }

  /**
   * Manually sets the Vibe and optionally persists it to localStorage.
   * Call with a Vibe to enable manual mode, or with `null` to return to automatic mode.
   * @param vibe The desired Vibe, or null to disable manual mode.
   */
  public setManualVibe(vibe: Vibe | null): void {
    if (vibe) {
      // Entering manual mode
      this.stop(); // Stop automatic checks
      this.isManual = true;

      if (this.state.vibe !== vibe) {
        this.state.vibe = vibe;
        this.state.health = { cpu: 1, network: 1, battery: 1 }; // Reset health to neutral
        this.dispatchEvent(
          new CustomEvent("vibechange", { detail: this.state }),
        );
      }

      if (this.config.persistence.enabled) {
        try {
          localStorage.setItem(this.config.persistence.key, vibe);
        } catch (error) {
          console.error(
            "Adaptive-UX: Could not save manual vibe to localStorage.",
            error,
          );
        }
      }
    } else {
      // Exiting manual mode, back to automatic
      this.isManual = false;
      if (this.config.persistence.enabled) {
        try {
          localStorage.removeItem(this.config.persistence.key);
        } catch (error) {
          console.error(
            "Adaptive-UX: Could not remove manual vibe from localStorage.",
            error,
          );
        }
      }
      // Restart automatic checks. `start` will perform an initial check.
      this.start();
    }
  }
}
