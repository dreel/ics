import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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

  function broadcastState(): void {
    const state = {
      type: 'state',
      effects: effectManager.getEffectList(),
      activeEffect: effectManager.activeEffect?.name ?? null,
      params: effectManager.activeEffect?.effect.params ?? [],
      paramValues: effectManager.activeParams,
      actualFps: renderLoop.actualFps,
    };
    const msg = JSON.stringify(state);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg);
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.add(ws);

    // Send initial state
    const state = {
      type: 'state',
      effects: effectManager.getEffectList(),
      activeEffect: effectManager.activeEffect?.name ?? null,
      params: effectManager.activeEffect?.effect.params ?? [],
      paramValues: effectManager.activeParams,
      actualFps: renderLoop.actualFps,
    };
    ws.send(JSON.stringify(state));

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
          case 'discover':
            discoverDevices(ws);
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
    previewThrottle++;
    if (previewThrottle % 2 !== 0) return; // ~30fps if running at 60fps

    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(leds, { binary: true });
      }
    }
  }

  // Periodically broadcast state (for FPS updates)
  let stateInterval: ReturnType<typeof setInterval> | null = null;

  function discoverDevices(ws: WebSocket): void {
    const devices: { name: string; ip: string }[] = [];
    const browse = spawn('dns-sd', ['-B', '_wled._tcp', 'local.']);
    const hostnames: string[] = [];

    browse.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        const match = line.match(/\s+(\S+)\s*$/);
        if (match && !line.includes('Instance Name') && line.includes('_wled')) {
          hostnames.push(match[1]);
        }
      }
    });

    setTimeout(() => {
      browse.kill();
      if (hostnames.length === 0) {
        ws.send(JSON.stringify({ type: 'devices', devices: [] }));
        return;
      }

      let resolved = 0;
      for (const hostname of hostnames) {
        const resolve = spawn('dns-sd', ['-G', 'v4', `${hostname}.local.`]);
        resolve.stdout.on('data', (data: Buffer) => {
          const match = data.toString().match(/(\d+\.\d+\.\d+\.\d+)/);
          if (match) {
            devices.push({ name: hostname, ip: match[1] });
          }
        });
        setTimeout(() => {
          resolve.kill();
          resolved++;
          if (resolved === hostnames.length) {
            ws.send(JSON.stringify({ type: 'devices', devices }));
          }
        }, 2000);
      }
    }, 3000);
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

  return { start, stop, broadcastPreview };
}
