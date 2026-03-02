import path from 'node:path';
import { DEFAULT_LED_COUNT, DEFAULT_TARGET_FPS } from './types.js';
import { createDdpClient } from './ddp.js';
import { createFftStub } from './fft.js';
import { createRenderLoop, type RenderLoop } from './loop.js';
import { createEffectManager } from './effectLoader.js';
import { createServer } from './server.js';

const WLED_IP = process.env.WLED_IP ?? '';
const LED_COUNT = parseInt(process.env.LED_COUNT ?? String(DEFAULT_LED_COUNT), 10);
const TARGET_FPS = parseInt(process.env.TARGET_FPS ?? String(DEFAULT_TARGET_FPS), 10);
const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function queryWledInfo(ip: string): Promise<{ name: string; ledCount: number } | null> {
  try {
    const res = await fetch(`http://${ip}/json/info`);
    const info = await res.json();
    const name = (info as any).name ?? 'unknown';
    const ledCount = (info as any).leds?.count;
    if (typeof ledCount === 'number' && ledCount > 0) {
      return { name, ledCount };
    }
  } catch (err) {
    console.warn(`Failed to query WLED info from ${ip}:`, err);
  }
  return null;
}

function applyLedCount(count: number, ddp: ReturnType<typeof createDdpClient>, renderLoop: RenderLoop) {
  ddp.setLedCount(count);
  renderLoop.setLedCount(count);
}

async function main() {
  console.log('ICS — Infinite Crystal Universe');
  console.log(`LED count: ${LED_COUNT}, Target FPS: ${TARGET_FPS}`);

  if (WLED_IP) {
    console.log(`WLED target: ${WLED_IP}`);
  } else {
    console.log('No WLED_IP set — running in preview-only mode');
  }

  const ddp = createDdpClient(WLED_IP, LED_COUNT);
  const fft = createFftStub();
  const effectsDir = path.resolve(import.meta.dirname, '..', 'effects');
  const effectManager = createEffectManager(effectsDir, LED_COUNT);

  const renderLoop = createRenderLoop({
    targetFps: TARGET_FPS,
    ledCount: LED_COUNT,
    ddp,
    fft,
    getActiveEffect: () => effectManager.getActive(),
    onFrame: (leds) => server.broadcastPreview(leds),
  });

  // Auto-detect LED count from WLED device at startup
  if (WLED_IP) {
    const info = await queryWledInfo(WLED_IP);
    if (info) {
      console.log(`WLED device: ${info.name}, LEDs: ${info.ledCount}`);
      applyLedCount(info.ledCount, ddp, renderLoop);
    } else {
      console.log('Could not reach WLED device (will send DDP anyway)');
    }
  }

  const server = createServer({
    port: PORT,
    effectManager,
    renderLoop,
    onConfigChange(config) {
      if (config.ip !== undefined) {
        ddp.setTarget(config.ip);
        console.log(`DDP target changed to: ${config.ip}`);
        // Auto-detect LED count from new device
        queryWledInfo(config.ip).then((info) => {
          if (info) {
            console.log(`WLED device: ${info.name}, LEDs: ${info.ledCount}`);
            applyLedCount(info.ledCount, ddp, renderLoop);
            server.broadcastState();
          }
        });
      } else if (config.ledCount !== undefined) {
        // Only apply manual ledCount when not changing IP
        // (IP change triggers auto-detect which sets the correct count)
        applyLedCount(config.ledCount, ddp, renderLoop);
        console.log(`LED count changed to: ${config.ledCount}`);
      }
      if (config.fps !== undefined) {
        renderLoop.setFps(config.fps);
        console.log(`Target FPS changed to: ${config.fps}`);
      }
    },
  });

  await effectManager.start();
  server.start();
  renderLoop.start();

  console.log('Render loop started');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    renderLoop.stop();
    server.stop();
    effectManager.stop();
    ddp.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
