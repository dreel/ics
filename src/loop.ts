import type { EffectContext, Effect } from './types.js';
import type { DdpClient } from './ddp.js';
import type { FftStub } from './fft.js';

export interface RenderLoopOptions {
  targetFps: number;
  ledCount: number;
  ddp: DdpClient;
  fft: FftStub;
  getActiveEffect(): { effect: Effect; params: Record<string, number | boolean> } | null;
  onFrame?(leds: Uint8Array): void;
}

export type PlayState = 'playing' | 'paused' | 'stopped';

export interface RenderLoop {
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  blackout(): void;
  setFps(fps: number): void;
  setLedCount(count: number): void;
  actualFps: number;
  playState: PlayState;
}

export function createRenderLoop(opts: RenderLoopOptions): RenderLoop {
  let { targetFps, ledCount } = opts;
  const { ddp, fft, getActiveEffect, onFrame } = opts;

  let leds = new Uint8Array(ledCount * 3);
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTime = process.hrtime.bigint();
  const startTime = process.hrtime.bigint();
  let playState: PlayState = 'playing';

  // FPS tracking
  let frameCount = 0;
  let fpsAccum = 0;
  let actualFps = 0;

  function tick(): void {
    const now = process.hrtime.bigint();
    const dtNs = Number(now - lastTime);
    const dt = dtNs / 1e9;
    const t = Number(now - startTime) / 1e9;
    lastTime = now;

    // FPS counter
    frameCount++;
    fpsAccum += dt;
    if (fpsAccum >= 1.0) {
      actualFps = frameCount;
      frameCount = 0;
      fpsAccum = 0;
    }

    if (playState !== 'playing') return;

    fft.update(t);

    const ctx: EffectContext = {
      t,
      dt,
      ledCount,
      leds,
      fft: fft.data,
    };

    const active = getActiveEffect();
    if (active) {
      active.effect.update(ctx, active.params);
    }

    ddp.sendFrame(leds);
    onFrame?.(leds);
  }

  function start(): void {
    if (timer) return;
    playState = 'playing';
    lastTime = process.hrtime.bigint();
    timer = setInterval(tick, Math.round(1000 / targetFps));
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function pause(): void {
    playState = 'paused';
  }

  function resume(): void {
    playState = 'playing';
  }

  function blackout(): void {
    playState = 'stopped';
    leds.fill(0);
    ddp.sendFrame(leds);
    onFrame?.(leds);
  }

  function setFps(fps: number): void {
    targetFps = fps;
    if (timer) {
      stop();
      start();
    }
  }

  function setLedCount(count: number): void {
    ledCount = count;
    leds = new Uint8Array(count * 3);
  }

  return {
    start,
    stop,
    pause,
    resume,
    blackout,
    setFps,
    setLedCount,
    get actualFps() { return actualFps; },
    get playState() { return playState; },
  };
}
