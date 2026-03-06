import type { Effect } from '../src/types.js';

const NUM_BANDS = 16;

const effect: Effect = {
  name: 'EQ',
  params: [
    { key: 'brightness', label: 'Brightness', type: 'float', min: 0, max: 1, default: 1 },
    { key: 'decay', label: 'Decay', type: 'float', min: 0.5, max: 10, default: 4 },
  ],

  init() {},

  update(ctx, params) {
    const brightness = params.brightness as number;
    const bands = ctx.fft.geqBands;
    const ledsPerBand = ctx.ledCount / NUM_BANDS;

    for (let band = 0; band < NUM_BANDS; band++) {
      const energy = bands[band];
      const startLed = Math.floor(band * ledsPerBand);
      const endLed = Math.floor((band + 1) * ledsPerBand);

      // Color: green (low) → yellow (mid) → red (high)
      const t = band / (NUM_BANDS - 1);
      let r: number, g: number, b: number;
      if (t < 0.5) {
        // green → yellow
        const mix = t * 2;
        r = mix;
        g = 1;
        b = 0;
      } else {
        // yellow → red
        const mix = (t - 0.5) * 2;
        r = 1;
        g = 1 - mix;
        b = 0;
      }

      for (let i = startLed; i < endLed && i < ctx.ledCount; i++) {
        // Within each band segment, brightness ramps from full at center to dimmer at edges
        const posInBand = (i - startLed) / (endLed - startLed);
        const edgeFade = 1 - Math.abs(posInBand - 0.5) * 0.5; // subtle edge fade
        const level = energy * brightness * edgeFade;

        ctx.leds[i * 3] = Math.round(r * level * 255);
        ctx.leds[i * 3 + 1] = Math.round(g * level * 255);
        ctx.leds[i * 3 + 2] = Math.round(b * level * 255);
      }
    }
  },
};

export default effect;
