import type { Effect } from '../src/types.js';

const effect: Effect = {
  name: 'Solid Color',
  params: [
    { key: 'r', label: 'Red', type: 'float', min: 0, max: 1, default: 1 },
    { key: 'g', label: 'Green', type: 'float', min: 0, max: 1, default: 0 },
    { key: 'b', label: 'Blue', type: 'float', min: 0, max: 1, default: 0 },
  ],

  init() {},

  update(ctx, params) {
    const r = Math.round((params.r as number) * 255);
    const g = Math.round((params.g as number) * 255);
    const b = Math.round((params.b as number) * 255);
    for (let i = 0; i < ctx.ledCount; i++) {
      ctx.leds[i * 3] = r;
      ctx.leds[i * 3 + 1] = g;
      ctx.leds[i * 3 + 2] = b;
    }
  },
};

export default effect;
