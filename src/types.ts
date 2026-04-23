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

/**
 * Utility type to deeply make all properties of a type required.
 */
export type DeepRequired<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [P in keyof T]-?: DeepRequired<NonNullable<T[P]>> }
    : NonNullable<T>;

export type StrictAdaptiveUXConfig = DeepRequired<AdaptiveUXConfig>;

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
    ping?: {
      url: string;
      sizeInBytes: number;
      throughputThresholds?: { LITE: number; MEDIUM: number }; // in Mbps
    };
  };
  battery?: {
    levelThresholds?: { LITE: number; MEDIUM: number };
  };
  persistence?: {
    enabled: boolean;
    key?: string;
  };
}
