import type { Effect } from '../src/types.js';

const effect: Effect = {
  name: 'Breathe',
  params: [
    { key: 'speed', label: 'Speed', type: 'float', min: 0.1, max: 5, default: 1 },
    { key: 'r', label: 'Red', type: 'float', min: 0, max: 1, default: 0 },
    { key: 'g', label: 'Green', type: 'float', min: 0, max: 1, default: 0.8 },
    { key: 'b', label: 'Blue', type: 'float', min: 0, max: 1, default: 1 },
  ],

  init() {},

  update(ctx, params) {
    const speed = params.speed as number;
    const brightness = (Math.sin(ctx.t * speed * Math.PI * 2) * 0.5 + 0.5);
    const r = Math.round((params.r as number) * brightness * 255);
    const g = Math.round((params.g as number) * brightness * 255);
    const b = Math.round((params.b as number) * brightness * 255);

    for (let i = 0; i < ctx.ledCount; i++) {
      ctx.leds[i * 3] = r;
      ctx.leds[i * 3 + 1] = g;
      ctx.leds[i * 3 + 2] = b;
    }
  },
};

export default effect;
