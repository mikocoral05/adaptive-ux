# adaptive-ux

[![npm version](https://img.shields.io/npm/v/adaptive-ux.svg)](https://www.npmjs.com/package/adaptive-ux)
[![Node.js CI](https://github.com/mikocoral05/adaptive-ux/actions/workflows/ci.yml/badge.svg)](https://github.com/mikocoral05/adaptive-ux/actions/workflows/ci.yml)

A "Lite Mode" Manager for modern web apps.

`adaptive-ux` intelligently monitors the user's device capabilities (CPU, Network, and Battery) to determine the optimal user experience "Vibe". This allows you to gracefully degrade resource-intensive features (like heavy animations or high-resolution media) for users on slower networks or low-end devices.

## Installation

```bash
npm install adaptive-ux
```

## Core Concepts

The library calculates a **Vibe** based on the health of the user's device:

- **`PREMIUM`**: Excellent connection, high battery, and fast CPU.
- **`MEDIUM`**: Average device capabilities. Some light throttling recommended.
- **`LITE`**: Slow network, low battery, or struggling CPU. You should turn off heavy animations and defer non-critical scripts.

## Usage

Initialize the manager and listen for the `vibechange` event to adjust your application's UI.

```typescript
import { AdaptiveUXManager } from "adaptive-ux";

// 1. Initialize the manager with optional configuration
const uxManager = new AdaptiveUXManager({
  initialVibe: "PREMIUM",
  checkInterval: 5000, // Evaluate health every 5 seconds
  persistence: {
    enabled: true, // Save user preferences to localStorage
    key: "my-app-vibe",
  },
  network: {
    // Optional: Configure an active ping test for accurate network throughput
    ping: {
      url: "https://your-domain.com/small-ping-file.bin",
      sizeInBytes: 50000,
    },
  },
});

// 2. Listen for capability changes
uxManager.addEventListener("vibechange", (event: any) => {
  const { vibe, health } = event.detail;

  console.log(`Current Vibe is: ${vibe}`);
  console.log("Device Health Scores (0 to 1):", health);

  if (vibe === "LITE") {
    document.body.classList.add("lite-mode");
    // Disable animations, load lower-res images, pause background videos, etc.
  } else {
    document.body.classList.remove("lite-mode");
    // Enable premium features
  }
});
```

### Manual Overrides

Sometimes users want to explicitly force "Lite Mode" or "Premium Mode" regardless of what their device capabilities are. You can manually set the vibe, which stops the automatic background checks.

```typescript
// Force Lite Mode (saves to localStorage if persistence is enabled)
uxManager.setManualVibe("LITE");

// Re-enable automatic device capability monitoring
uxManager.setManualVibe(null);
```

## API

### `AdaptiveUXManager(config?: AdaptiveUXConfig)`

Creates a new instance and automatically starts health polling.

- **`getCurrentState()`**: Synchronously returns the current `{ vibe, health }` state.
- **`setManualVibe(vibe: Vibe | null)`**: Forces a specific vibe or restores auto-detection.
- **`stop()`**: Clears the interval preventing further background checks.
- **`start()`**: Resumes background health polling.
