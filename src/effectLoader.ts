import { watch } from 'chokidar';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import type { Effect, EffectContext } from './types.js';

export interface EffectEntry {
  name: string;
  filename: string;
  effect: Effect;
}

export interface EffectManager {
  effects: Map<string, EffectEntry>;
  activeEffect: EffectEntry | null;
  activeParams: Record<string, number | boolean>;
  activateEffect(name: string): void;
  setParam(key: string, value: number | boolean): void;
  getEffectList(): { name: string; filename: string }[];
  getActive(): { effect: Effect; params: Record<string, number | boolean> } | null;
  start(): Promise<void>;
  stop(): void;
}

export function createEffectManager(effectsDir: string, ledCount: number): EffectManager {
  const effects = new Map<string, EffectEntry>();
  let activeEffect: EffectEntry | null = null;
  let activeParams: Record<string, number | boolean> = {};
  let watcher: ReturnType<typeof watch> | null = null;
  let onChangeCallback: (() => void) | null = null;

  async function loadEffect(filePath: string): Promise<EffectEntry | null> {
    try {
      const url = pathToFileURL(filePath).href + '?t=' + Date.now();
      const mod = await import(url);
      const effect: Effect = mod.default;
      if (!effect || !effect.name || !effect.update) {
        console.error(`Invalid effect module: ${filePath}`);
        return null;
      }
      const filename = path.basename(filePath);
      return { name: effect.name, filename, effect };
    } catch (err) {
      console.error(`Error loading effect ${filePath}:`, err);
      return null;
    }
  }

  async function loadAll(): Promise<void> {
    const fs = await import('node:fs');
    const files = fs.readdirSync(effectsDir).filter(f => f.endsWith('.ts'));
    for (const file of files) {
      const entry = await loadEffect(path.join(effectsDir, file));
      if (entry) {
        effects.set(entry.name, entry);
      }
    }

    // Activate first effect if none active
    if (!activeEffect && effects.size > 0) {
      const first = effects.values().next().value!;
      activateEffect(first.name);
    }
  }

  function activateEffect(name: string): void {
    const entry = effects.get(name);
    if (!entry) return;

    // Build params, preserving existing values where keys match
    const oldParams = activeParams;
    activeParams = {};
    for (const p of entry.effect.params) {
      if (p.key in oldParams) {
        activeParams[p.key] = oldParams[p.key];
      } else {
        activeParams[p.key] = p.default;
      }
    }

    activeEffect = entry;

    // Call init with a dummy context
    const dummyLeds = new Uint8Array(ledCount * 3);
    const ctx: EffectContext = {
      t: 0, dt: 0, ledCount,
      leds: dummyLeds,
      fft: {
        bins: new Float32Array(512),
        bassEnergy: 0, midEnergy: 0, highEnergy: 0,
        beatDetected: false,
      },
    };
    entry.effect.init(ctx, activeParams);
  }

  function setParam(key: string, value: number | boolean): void {
    activeParams[key] = value;
  }

  function getEffectList(): { name: string; filename: string }[] {
    return Array.from(effects.values()).map(e => ({ name: e.name, filename: e.filename }));
  }

  function getActive(): { effect: Effect; params: Record<string, number | boolean> } | null {
    if (!activeEffect) return null;
    return { effect: activeEffect.effect, params: activeParams };
  }

  async function start(): Promise<void> {
    await loadAll();

    watcher = watch(effectsDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on('change', async (filePath: string) => {
      if (!filePath.endsWith('.ts')) return;
      console.log(`Effect changed: ${filePath}`);
      const entry = await loadEffect(filePath);
      if (entry) {
        effects.set(entry.name, entry);
        // If this was the active effect, re-activate
        if (activeEffect?.filename === entry.filename) {
          const prevParams = { ...activeParams };
          activateEffect(entry.name);
          // Restore params that still exist
          for (const key of Object.keys(prevParams)) {
            if (key in activeParams) {
              activeParams[key] = prevParams[key];
            }
          }
        }
        onChangeCallback?.();
      }
    });

    watcher.on('add', async (filePath: string) => {
      if (!filePath.endsWith('.ts')) return;
      const entry = await loadEffect(filePath);
      if (entry) {
        effects.set(entry.name, entry);
        if (!activeEffect) activateEffect(entry.name);
        onChangeCallback?.();
      }
    });
  }

  function stop(): void {
    watcher?.close();
  }

  const manager: EffectManager = {
    effects,
    get activeEffect() { return activeEffect; },
    get activeParams() { return activeParams; },
    activateEffect,
    setParam,
    getEffectList,
    getActive,
    start,
    stop,
  };

  // Allow registering change callback
  (manager as any).onChange = (cb: () => void) => { onChangeCallback = cb; };

  return manager;
}
