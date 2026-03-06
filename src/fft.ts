import type { FFTData } from './types.js';

export const FFT_BINS = 512;

export interface FftStub {
  data: FFTData;
  update(t: number): void;
}

export const GEQ_BANDS = 16;

export function createFftStub(): FftStub {
  const bins = new Float32Array(FFT_BINS);
  const geqBands = new Float32Array(GEQ_BANDS);
  const data: FFTData = {
    bins,
    geqBands,
    bassEnergy: 0,
    midEnergy: 0,
    highEnergy: 0,
    beatDetected: false,
  };

  let lastBeatTime = 0;

  function update(t: number): void {
    // Gentle sine waves across bins
    for (let i = 0; i < FFT_BINS; i++) {
      bins[i] = Math.max(0, Math.sin(t * 2 + i * 0.05) * 0.3 + 0.2);
    }

    // Simulated GEQ bands
    for (let i = 0; i < GEQ_BANDS; i++) {
      geqBands[i] = Math.max(0, Math.sin(t * 2 + i * 0.4) * 0.4 + 0.3);
    }

    data.bassEnergy = Math.sin(t * 1.5) * 0.5 + 0.5;
    data.midEnergy = Math.sin(t * 1.5 + Math.PI * 0.66) * 0.5 + 0.5;
    data.highEnergy = Math.sin(t * 1.5 + Math.PI * 1.33) * 0.5 + 0.5;

    // Beat toggle every ~500ms
    data.beatDetected = t - lastBeatTime >= 0.5;
    if (data.beatDetected) lastBeatTime = t;
  }

  return { data, update };
}
