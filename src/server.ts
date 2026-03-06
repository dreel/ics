import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import type { EffectManager } from './effectLoader.js';
import type { RenderLoop } from './loop.js';

export interface ServerOptions {
  port: number;
  effectManager: EffectManager;
  renderLoop: RenderLoop;
  onConfigChange(config: { ip?: string; ledCount?: number; fps?: number }): void;
}

export interface Server {
  start(): void;
  stop(): void;
  broadcastPreview(leds: Uint8Array): void;
  broadcastGeq(bands: Float32Array, lastPacketTime: number): void;
  broadcastState(): void;
}

export function createServer(opts: ServerOptions): Server {
  const { port, effectManager, renderLoop, onConfigChange } = opts;
  const clients = new Set<WebSocket>();
  let previewThrottle = 0;

  const uiPath = path.resolve(import.meta.dirname, '..', 'ui', 'index.html');

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      fs.createReadStream(uiPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  function getState() {
    return {
      type: 'state',
      effects: effectManager.getEffectList(),
      activeEffect: effectManager.activeEffect?.name ?? null,
      params: effectManager.activeEffect?.effect.params ?? [],
      paramValues: effectManager.activeParams,
      actualFps: renderLoop.actualFps,
      playState: renderLoop.playState,
      ledCount: renderLoop.ledCount,
    };
  }

  function broadcastState(): void {
    const msg = JSON.stringify(getState());
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);

    // Send initial state
    ws.send(JSON.stringify(getState()));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        switch (msg.type) {
          case 'selectEffect':
            effectManager.activateEffect(msg.name);
            broadcastState();
            break;
          case 'setParam':
            effectManager.setParam(msg.key, msg.value);
            broadcastState();
            break;
          case 'setConfig':
            onConfigChange(msg.config);
            break;
          case 'play':
            renderLoop.resume();
            broadcastState();
            break;
          case 'pause':
            renderLoop.pause();
            broadcastState();
            break;
          case 'blackout':
            renderLoop.blackout();
            broadcastState();
            break;
          case 'discover':
            discoverDevices(ws);
            break;
          case 'testAudioSync':
            sendTestAudioSync(ws);
            break;
        }
      } catch {}
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  // Register effect change callback
  (effectManager as any).onChange?.(() => broadcastState());

  function broadcastPreview(leds: Uint8Array): void {
    // Only throttle during active playback
    if (renderLoop.playState === 'playing') {
      previewThrottle++;
      if (previewThrottle % 2 !== 0) return; // ~30fps if running at 60fps
    }

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(leds, { binary: true });
      }
    }
  }

  let geqThrottle = 0;

  function broadcastGeq(bands: Float32Array, lastPacketTime: number): void {
    geqThrottle++;
    if (geqThrottle % 3 !== 0) return; // ~20fps at 60fps render

    const msg = JSON.stringify({
      type: 'geq',
      bands: Array.from(bands),
      lastPacketTime,
    });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  // Periodically broadcast state (for FPS updates)
  let stateInterval: ReturnType<typeof setInterval> | null = null;

  function discoverDevices(ws: WebSocket): void {
    const devices = new Map<string, { name: string; ip: string }>();
    const browse = spawn('dns-sd', ['-B', '_wled._tcp', 'local.']);
    const hostnames = new Set<string>();

    browse.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const match = line.match(/\s+(\S+)\s*$/);
        if (match && !line.includes('Instance Name') && line.includes('_wled')) {
          hostnames.add(match[1]);
        }
      }
    });

    setTimeout(() => {
      browse.kill();
      if (hostnames.size === 0) {
        ws.send(JSON.stringify({ type: 'devices', devices: [] }));
        return;
      }

      const hostnameList = [...hostnames];
      let resolved = 0;
      for (const hostname of hostnameList) {
        const resolve = spawn('dns-sd', ['-G', 'v4', `${hostname}.local.`]);
        resolve.stdout.on('data', (data: Buffer) => {
          const match = data.toString().match(/(\d+\.\d+\.\d+\.\d+)/);
          if (match && !devices.has(hostname)) {
            devices.set(hostname, { name: hostname, ip: match[1] });
          }
        });
        setTimeout(() => {
          resolve.kill();
          resolved++;
          if (resolved === hostnameList.length) {
            ws.send(JSON.stringify({ type: 'devices', devices: [...devices.values()] }));
          }
        }, 2000);
      }
    }, 3000);
  }

  let testAudioActive = false;

  function sendTestAudioSync(ws: WebSocket): void {
    if (testAudioActive) return;
    testAudioActive = true;

    const sock = dgram.createSocket('udp4');
    sock.bind(() => {
      sock.setMulticastTTL(32);
      sock.setBroadcast(true);
      // Pick the first non-internal IPv4 interface for multicast
      const ifaces = os.networkInterfaces();
      for (const addrs of Object.values(ifaces)) {
        for (const addr of addrs ?? []) {
          if (addr.family === 'IPv4' && !addr.internal) {
            try { sock.setMulticastInterface(addr.address); } catch {}
            break;
          }
        }
      }

      const DURATION = 4000; // ms
      const INTERVAL = 20;   // ms
      const TOTAL = DURATION / INTERVAL;
      let i = 0;

      ws.send(JSON.stringify({ type: 'testAudioSync', status: 'started' }));

      const timer = setInterval(() => {
        const t = i / TOTAL; // 0..1 progress
        const buf = Buffer.alloc(44);
        // Header '00002\0'
        buf.write('00002', 0, 'ascii');
        buf[5] = 0;
        // Sweep a peak across the 16 GEQ bands
        const peakBand = t * 15;
        for (let b = 0; b < 16; b++) {
          const dist = Math.abs(b - peakBand);
          const val = Math.max(0, 1 - dist / 2.5);
          buf[18 + b] = Math.floor(val * 254);
        }
        // sampleRaw / sampleSmth (float32 LE)
        const level = buf[18 + Math.round(peakBand)] / 254;
        buf.writeFloatLE(level * 1000, 8);
        buf.writeFloatLE(level * 800, 12);
        // samplePeak
        buf[16] = level > 0.9 ? 1 : 0;
        // FFT_Magnitude, FFT_MajorPeak
        buf.writeFloatLE(level * 500, 36);
        buf.writeFloatLE(63 * Math.pow(2, peakBand / 2), 40);

        sock.send(buf, 0, 44, 11988, '239.0.0.1');
        i++;
        if (i >= TOTAL) {
          clearInterval(timer);
          testAudioActive = false;
          sock.close();
          ws.send(JSON.stringify({ type: 'testAudioSync', status: 'done' }));
        }
      }, INTERVAL);
    });
  }

  function start(): void {
    httpServer.listen(port, () => {
      console.log(`UI: http://localhost:${port}`);
    });
    stateInterval = setInterval(broadcastState, 1000);
  }

  function stop(): void {
    if (stateInterval) clearInterval(stateInterval);
    wss.close();
    httpServer.close();
  }

  return { start, stop, broadcastPreview, broadcastGeq, broadcastState };
}
