import type { Effect } from '../src/types.js';

const effect: Effect = {
  name: 'Chase',
  params: [
    { key: 'speed', label: 'Speed', type: 'float', min: 0.1, max: 10, default: 2 },
    { key: 'width', label: 'Width', type: 'float', min: 0.01, max: 0.5, default: 0.05 },
    { key: 'hue', label: 'Hue', type: 'float', min: 0, max: 1, default: 0.6 },
  ],

  init() {},

  update(ctx, params) {
    const speed = params.speed as number;
    const width = params.width as number;
    const hue = params.hue as number;

    // HSV to RGB (simple)
    const h = hue * 6;
    const c = 1;
    const x = c * (1 - Math.abs(h % 2 - 1));
    let r1 = 0, g1 = 0, b1 = 0;
    if (h < 1) { r1 = c; g1 = x; }
    else if (h < 2) { r1 = x; g1 = c; }
    else if (h < 3) { g1 = c; b1 = x; }
    else if (h < 4) { g1 = x; b1 = c; }
    else if (h < 5) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }

    const headPos = (ctx.t * speed) % 1;

    for (let i = 0; i < ctx.ledCount; i++) {
      const pos = i / ctx.ledCount;
      let dist = Math.abs(pos - headPos);
      if (dist > 0.5) dist = 1 - dist; // wrap around

      const brightness = Math.max(0, 1 - dist / width);
      ctx.leds[i * 3] = Math.round(r1 * brightness * 255);
      ctx.leds[i * 3 + 1] = Math.round(g1 * brightness * 255);
      ctx.leds[i * 3 + 2] = Math.round(b1 * brightness * 255);
    }
  },
};

export default effect;
