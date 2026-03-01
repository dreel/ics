// Normalized 0-1 float RGB color
export interface Color {
  r: number;
  g: number;
  b: number;
}

// FFT data passed into every effect update — stubbed initially
export interface FFTData {
  bins: Float32Array;
  bassEnergy: number;
  midEnergy: number;
  highEnergy: number;
  beatDetected: boolean;
}

// Per-frame context passed to every effect
export interface EffectContext {
  t: number;
  dt: number;
  ledCount: number;
  leds: Uint8Array;
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
  params: ParamDef[];
  init(ctx: EffectContext, params: Record<string, number | boolean>): void;
  update(ctx: EffectContext, params: Record<string, number | boolean>): void;
}

export const DEFAULT_LED_COUNT = 634;
export const DEFAULT_TARGET_FPS = 60;
export const DDP_PORT = 4048;
export const MAX_DDP_PAYLOAD = 1440;
