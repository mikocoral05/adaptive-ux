import { Vibe, DeviceHealth, AdaptiveUXConfig, CapabilityState } from "./types";

// Default configuration values. These are sensible starting points.
const defaultConfig: Required<AdaptiveUXConfig> = {
  initialVibe: "PREMIUM",
  checkInterval: 5000, // Check health every 5 seconds
  cpu: {
    /**
     * A simple benchmark function. A more sophisticated one could be provided by the user.
     * This measures the time for a CPU-intensive task. Lower is better.
     */
    benchmark: () => {
      const start = performance.now();
      for (let i = 0; i < 1_000_000; i++) {
        Math.sqrt(i);
      }
      return performance.now() - start;
    },
    // Lower is better. Calibrate these for your app's specific needs.
    thresholds: { LITE: 150, MEDIUM: 75 }, // in ms
  },
  network: {
    // Higher is better.
    downlinkThresholds: { LITE: 0.5, MEDIUM: 2 }, // in Mbps
    // Lower is better.
    rttThresholds: { LITE: 600, MEDIUM: 300 }, // in ms
  },
  battery: {
    // Lower is worse.
    levelThresholds: { LITE: 0.2, MEDIUM: 0.5 },
  },
};

/**
 * The main class for managing the adaptive user experience.
 */
export class AdaptiveUXManager extends EventTarget {
  private state: CapabilityState;
  private config: Required<AdaptiveUXConfig>;
  private intervalId: number | undefined;

  constructor(config: AdaptiveUXConfig = {}) {
    super();
    // Deep merge of default and user config
    this.config = {
      ...defaultConfig,
      ...config,
      cpu: { ...defaultConfig.cpu, ...config.cpu },
      network: { ...defaultConfig.network, ...config.network },
      battery: { ...defaultConfig.battery, ...config.battery },
    };

    this.state = {
      vibe: this.config.initialVibe,
      health: {
        cpu: 1,
        network: 1,
        battery: 1,
      },
    };

    this.start();
  }

  private async getBatteryHealth(): Promise<number> {
    if (!(navigator as any).getBattery) {
      return 1; // API not supported, assume good health
    }
    try {
      const battery = await (navigator as any).getBattery();
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

  private getNetworkHealth(): number {
    const connection = (navigator as any).connection;
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
    return 1; // PREMIUM
  }

  private getCPUHealth(): number {
    const benchmarkTime = this.config.cpu.benchmark();
    const { thresholds } = this.config.cpu;
    if (benchmarkTime > thresholds.LITE) return 0; // LITE
    if (benchmarkTime > thresholds.MEDIUM) return 0.5; // MEDIUM
    return 1; // PREMIUM
  }

  private async updateHealthAndVibe() {
    const [battery, network, cpu] = await Promise.all([
      this.getBatteryHealth(),
      this.getNetworkHealth(),
      this.getCPUHealth(),
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
    if (this.intervalId) return;
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
    clearInterval(this.intervalId);
    this.intervalId = undefined;
  }

  /**
   * Returns the current capability state.
   */
  public getCurrentState(): CapabilityState {
    return { ...this.state };
  }
}
