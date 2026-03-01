# WLED Effect Host — Project Plan

## Overview

Build a TypeScript/Node.js effect host that drives a WLED-controlled ARGB LED strip (634 LEDs) via the DDP protocol over UDP. Effects are authored in TypeScript with a clean, portable interface designed to make future porting to C++ on the ESP32 straightforward. A browser-based UI (served by the Node host) provides real-time controls. Audio FFT input is stubbed for now and will be wired up in a later phase.

## Goals

- Drive 634 LEDs at 60fps via DDP over local WiFi
- Clean effect interface in TypeScript that maps closely to C structs/functions
- Hot-reload effects without restarting the host
- Browser UI for: selecting active effect, adjusting parameters, viewing a simple LED preview
- Stub FFT data structure in place from day one so effects can be written against it
- Effect authoring workflow suitable for LLM-assisted generation (Claude as effect author)

---

## Tech Stack

- **Runtime**: Node.js with TypeScript (tsx or ts-node for development)
- **UDP**: Node's built-in `dgram` module — no dependencies needed for DDP
- **Browser UI**: Vite + vanilla TypeScript (or minimal React if preferred) served by the Node host
- **Hot reload**: `chokidar` watching the effects directory, dynamic `import()` with cache-busting
- **HTTP/WS server**: `fastify` or plain `http` + `ws` for serving the UI and pushing state updates to the browser
- **Package manager**: pnpm or npm, developer preference

---

## Project Structure

```
wled-host/
├── src/
│   ├── main.ts              # Entry point, wires everything together
│   ├── ddp.ts               # DDP protocol implementation
│   ├── loop.ts              # Render loop (setInterval or hrtime-based)
│   ├── effectLoader.ts      # Hot-reload effect files from /effects
│   ├── fft.ts               # FFT stub (returns zeroed/simulated data)
│   ├── server.ts            # HTTP server for browser UI + WebSocket
│   └── types.ts             # Shared TypeScript interfaces
├── effects/
│   ├── solidColor.ts        # Minimal smoke-test effect
│   ├── chase.ts             # Simple chase/rotation effect
│   └── ...                  # Additional effects added over time
├── ui/
│   └── index.html           # Browser UI (Vite project or single file)
├── package.json
└── tsconfig.json
```

---

## Core Types (`src/types.ts`)

These types are the central contract of the system. They are intentionally designed to map closely to C structs — no classes, no closures over mutable state, flat typed arrays.

```typescript
// Normalized 0-1 float RGB color helper type (for effect math)
export interface Color {
  r: number; // 0.0 - 1.0
  g: number;
  b: number;
}

// FFT data passed into every effect update — stubbed initially
export interface FFTData {
  bins: Float32Array;       // Frequency bins, normalized 0-1, length = FFT_BINS
  bassEnergy: number;       // 0-1 low frequency energy
  midEnergy: number;        // 0-1 mid frequency energy
  highEnergy: number;       // 0-1 high frequency energy
  beatDetected: boolean;    // Simple onset/beat flag
}

// Per-frame context passed to every effect
export interface EffectContext {
  t: number;                // Time in seconds since host start
  dt: number;               // Delta time in seconds since last frame
  ledCount: number;         // Total LED count (634)
  leds: Uint8Array;         // Output buffer: flat RGB, length = ledCount * 3
                            // leds[i*3+0] = R, leds[i*3+1] = G, leds[i*3+2] = B
  fft: FFTData;
}

// Effect parameter definition — used to generate browser UI controls
export interface ParamDef {
  key: string;
  label: string;
  type: 'float' | 'int' | 'color' | 'bool';
  min?: number;
  max?: number;
  default: number | boolean;
}

// The effect interface every effect module must export as default
export interface Effect {
  name: string;
  params: ParamDef[];       // Declarative parameter definitions
  init(ctx: EffectContext, params: Record<string, number | boolean>): void;
  update(ctx: EffectContext, params: Record<string, number | boolean>): void;
}
```

### Key design decisions

- `leds` is a flat `Uint8Array` — this is `uint8_t*` in C, the port is trivial
- `FFTData.bins` is a `Float32Array` — maps to `float*` in C
- No heap allocation in `update()` — any per-effect state should be allocated in `init()` or as module-level variables
- `params` is passed in rather than closed over, keeping effects as pure functions against context
- `ParamDef` declarations allow the browser UI to auto-generate controls for any effect

---

## DDP Implementation (`src/ddp.ts`)

### Protocol overview

- UDP to port 4048 on the WLED device IP
- 10-byte header + raw RGB payload
- Offset-based: you write into a flat byte buffer starting at a given byte offset
- For frames exceeding MTU (~1440 bytes payload), split into multiple packets
- Set the "push" flag on the final packet of each frame to trigger WLED output

### Header format

```
Byte 0: flags
  bit 7 (0x80): push (render now)
  bit 6 (0x40): query (not used)
  bit 5 (0x20): reply (not used)
  bit 4 (0x10): storage (not used)
  bit 3 (0x08): time (not used)
  bit 2 (0x04): data type follows
  bits 1-0: version (always 1)
Byte 1: sequence number (0-255, wrapping — can leave 0 for now)
Byte 2: data type (0x01 = RGB, 3 bytes per pixel)
Byte 3: destination (0x01 = output 1)
Bytes 4-7: offset (uint32 big-endian) — byte offset into the output buffer
Bytes 8-9: length (uint16 big-endian) — byte length of payload in this packet
```

### Packet splitting for 634 LEDs

- Total bytes: 634 × 3 = 1902
- Max payload per packet: 1440 bytes (480 LEDs)
- Packet 1: offset=0, length=1440, no push flag
- Packet 2: offset=1440, length=462, push flag set

### Implementation notes

- Create a single `UdpSocket` at startup, keep it open for the session
- Pre-allocate packet buffers at init — do not allocate per frame
- Query WLED LED count on startup via `GET http://<ip>/json/info` and assert it matches `LED_COUNT` constant

---

## FFT Stub (`src/fft.ts`)

Implement the `FFTData` interface with zeroed or time-varying simulated data so effects can be written against real types immediately.

```typescript
// Suggested stub behaviour:
// - bins: all zeros, or a slow sine wave across bins for visual interest during dev
// - bassEnergy: slow sine wave 0-1
// - midEnergy: slow sine wave 0-1, offset phase
// - highEnergy: slow sine wave 0-1, offset phase
// - beatDetected: fires every ~500ms as a simple tempo simulation
```

Constants to define up front:
```typescript
export const FFT_BINS = 512;
export const FFT_SAMPLE_RATE = 44100;
```

When real audio is wired up, this module is replaced — the interface is unchanged.

---

## Render Loop (`src/loop.ts`)

Use `setInterval` at 16ms (≈60fps) as a starting point. If timing jitter is noticeable, upgrade to an `hrtime`-based busy loop or a native addon.

```typescript
// Pseudocode
const interval = 1000 / TARGET_FPS;
let lastTime = hrtime();

setInterval(() => {
  const now = hrtime();
  const dt = now - lastTime;
  lastTime = now;

  fftStub.update(now);               // advance stub simulation
  activeEffect.update(ctx, params);  // fill leds buffer
  ddp.sendFrame(leds);               // split and send DDP packets
  broadcastPreview(leds);            // push to browser UI via WebSocket
}, interval);
```

Note: `setInterval` in Node.js is sufficient for this use case. LED effects at 60fps do not require frame-perfect timing — human perception of LED brightness changes is not sensitive to ±2ms jitter.

---

## Effect Hot Reload (`src/effectLoader.ts`)

- Watch the `effects/` directory with `chokidar`
- On file change: re-import the module using dynamic `import()` with a cache-busting query string (e.g. `?t=<timestamp>`) to bypass Node's module cache
- Call `effect.init()` on the new instance with current context to reset state
- Swap the active effect atomically (single variable assignment)
- On import error: log the error, keep the previous effect running

---

## Browser UI

Served statically by the Node host. Communicates over WebSocket for:
- Receiving LED preview updates (every frame or throttled to ~20fps for the UI)
- Receiving the effect list and current state
- Sending effect selection, parameter changes, and device configuration

### Layout

The UI has two distinct sections:

**Header bar (device configuration)** — persistent across all interactions:
- WLED device IP address: text input, with a "Scan" button that triggers mDNS discovery and populates a dropdown of found WLED devices on the local network
- LED count: numeric input (default 634), applied immediately on change — updates the host's `LED_COUNT` and re-allocates buffers
- Update rate: numeric input in FPS (default 60, reasonable range 1-120), applied immediately — adjusts the render loop interval
- Connection status indicator: shows whether DDP packets are being sent and whether the WLED device responded to the last `/json/info` query

**Main panel (effect controls)**:
- Effect selector dropdown (populated from loaded effects)
- Auto-generated parameter sliders/toggles from `ParamDef[]`
- LED strip preview: a horizontal bar of colored blocks, one per LED, updated in real time
- Current actual FPS display (measured on the host, sent over WebSocket)

### mDNS Device Discovery

WLED advertises itself over mDNS using the `_wled._tcp` service type. On macOS, the `dns-sd` command line tool is available without any dependencies and can be invoked as a child process:

```typescript
// Pseudocode for discovery via dns-sd subprocess
const proc = spawn('dns-sd', ['-B', '_wled._tcp', 'local.']);
// parse stdout for service names, then resolve each to an IP
// with: dns-sd -G v4 <hostname>
// Collect results for ~3 seconds, then kill the process and return the list
```

Alternatively use the `bonjour-service` npm package for a pure-JS approach if subprocess feels fragile.

The "Scan" button triggers discovery, shows a spinner for ~3 seconds, then populates a dropdown. Selecting a device from the dropdown fills the IP field and immediately queries `/json/info` to confirm connectivity and auto-populate the LED count field.

### LED preview rendering

Render the LEDs as a horizontal strip in a `<canvas>` element. At 634px wide this is 1px per LED, or scale up to fill available width. Update via WebSocket messages containing the raw RGB buffer (send as binary, not JSON).

---

## Startup Sequence

1. Read config (WLED IP, LED count, target FPS) from environment or config file
2. Query `GET http://<wled-ip>/json/info` — log LED count, assert matches config
3. Pre-allocate LED buffer (`Uint8Array`, length 634×3) and DDP packet buffers
4. Initialize FFT stub
5. Load effects from `effects/` directory, start file watcher
6. Start HTTP server and WebSocket server for browser UI
7. Activate default effect, start render loop

---

## First Effects (Smoke Tests)

### `solidColor.ts`
Sets every LED to a single configurable color. Verifies DDP pipeline is working end to end.

### `chase.ts`
A single bright pixel (or short bright segment) that travels around the loop at configurable speed. Good first test of the looped geometry and time-based animation.

### `breathe.ts`
All LEDs pulse in brightness using a sine wave. Tests `t` and `dt` usage and parameter system.

---

## Effect Authoring Guidelines (for LLM prompting)

When generating new effects with Claude or another LLM, provide this context in the system prompt:

- The full contents of `types.ts`
- `LED_COUNT = 634` — LEDs are arranged in a continuous loop around a room
- `leds` buffer is flat RGB bytes: `leds[i*3] = R, leds[i*3+1] = G, leds[i*3+2] = B`
- Values are 0-255 integers
- Normalized position of LED `i` around the loop: `i / LED_COUNT` (0.0 to 1.0)
- Angular position: `(i / LED_COUNT) * Math.PI * 2`
- Do not allocate in `update()` — use module-level variables for any per-effect state
- Avoid TypeScript-specific idioms: no classes, no closures over mutable state, explicit typed arrays, simple for loops
- The effect must export a default object conforming to the `Effect` interface

---

## Future Phases (Out of Scope for Now)

- **Audio capture**: Replace FFT stub with real line-level input via `node-portaudio` or similar, running FFT in a Worker thread
- **ESP32 port**: C++ effect runner with matching interface, effects ported from TypeScript
- **LLM integration**: API endpoint on the host that accepts a prompt, generates an effect via Claude API, hot-loads it
- **Palette system**: Shared color palette abstraction usable by effects
- **2D/positional mapping**: If LEDs are ever mapped with physical coordinates, add x/y to context

---

## Open Questions

- Should the browser UI be a Vite project (with build step) or a single self-contained HTML file served directly? For simplicity, a single HTML file with inline JS is fine for MVP.
- Should params be persisted between hot-reloads? Probably yes — store last param values by effect name in host memory.
- Should the host support multiple simultaneous effects (e.g. blending)? Out of scope for MVP, but the interface should not preclude it.
