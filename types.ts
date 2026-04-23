export type Vibe = "LITE" | "MEDIUM" | "PREMIUM";

export interface DeviceHealth {
  /** A score from 0 (poor) to 1 (excellent) */
  cpu: number;
  /** A score from 0 (poor) to 1 (excellent) */
  network: number;
  /** A score from 0 (poor) to 1 (excellent) */
  battery: number;
}

export interface CapabilityState {
  vibe: Vibe;
  health: DeviceHealth;
}

export interface AdaptiveUXConfig {
  initialVibe?: Vibe;
  checkInterval?: number;
  cpu?: {
    benchmark?: () => number;
    thresholds?: { LITE: number; MEDIUM: number };
  };
  network?: {
    downlinkThresholds?: { LITE: number; MEDIUM: number };
    rttThresholds?: { LITE: number; MEDIUM: number };
  };
  battery?: {
    levelThresholds?: { LITE: number; MEDIUM: number };
  };
}
