import dgram from 'node:dgram';
import os from 'node:os';
import type { FFTData } from './types.js';
import { FFT_BINS, GEQ_BANDS, type FftStub } from './fft.js';

const MULTICAST_GROUP = '239.0.0.1';
const AUDIO_SYNC_PORT = 11988;
const V2_HEADER = '00002';
const V1_HEADER = '00001';
const V2_PACKET_SIZE = 44;
const DECAY_RATE = 3.0; // units per second — full decay in ~0.33s

export interface AudioSync extends FftStub {
  lastPacketTime: number;
  close(): void;
}

export function createAudioSync(): AudioSync {
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

  let lastPacketTime = 0;
  let packetCount = 0;

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  function applyGeqBands(): void {
    // Map 16 GEQ bands → 512 bins (each band fills 32 consecutive bins)
    const binsPerBand = FFT_BINS / GEQ_BANDS;
    for (let band = 0; band < GEQ_BANDS; band++) {
      const value = geqBands[band];
      const start = band * binsPerBand;
      for (let j = 0; j < binsPerBand; j++) {
        bins[start + j] = value;
      }
    }

    // Derive energy: bass (bands 0-2), mid (3-8), high (9-15)
    data.bassEnergy = (geqBands[0] + geqBands[1] + geqBands[2]) / 3;
    data.midEnergy = (geqBands[3] + geqBands[4] + geqBands[5] + geqBands[6] + geqBands[7] + geqBands[8]) / 6;
    let highSum = 0;
    for (let i = 9; i < GEQ_BANDS; i++) highSum += geqBands[i];
    data.highEnergy = highSum / 7;
  }

  function handleV2(msg: Buffer): void {
    for (let i = 0; i < GEQ_BANDS; i++) {
      geqBands[i] = msg[18 + i] / 255;
    }
    data.beatDetected = msg[16] > 0;
    applyGeqBands();
  }

  function handleV1(msg: Buffer): void {
    // V1 struct (with padding): header[6] + myVals[32] + sampleAgc(4) + sampleRaw(4) + sampleAvg(4) + samplePeak(1) + fftResult[16]
    // fftResult starts at offset 51 (6+32+4+4+4+1)
    const fftOffset = 51;
    if (msg.length < fftOffset + GEQ_BANDS) return;
    for (let i = 0; i < GEQ_BANDS; i++) {
      geqBands[i] = msg[fftOffset + i] / 255;
    }
    data.beatDetected = msg[50] > 0; // samplePeak at offset 50
    applyGeqBands();
  }

  socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
    if (msg.length < 6) {
      console.log(`AudioSync: short packet (${msg.length}B) from ${rinfo.address}:${rinfo.port}`);
      return;
    }

    const header = msg.subarray(0, 5).toString('ascii');

    if (header === V2_HEADER && msg.length >= V2_PACKET_SIZE) {
      handleV2(msg);
    } else if (header === V1_HEADER && msg.length >= 67) {
      handleV1(msg);
    } else {
      console.log(`AudioSync: unknown packet from ${rinfo.address}:${rinfo.port} len=${msg.length} header=${JSON.stringify(header)} hex=${msg.subarray(0, 8).toString('hex')}`);
      return;
    }

    lastPacketTime = Date.now();
    packetCount++;
    if (packetCount === 1) {
      console.log(`AudioSync: receiving from ${rinfo.address} (${header === V2_HEADER ? 'V2' : 'V1'})`);
    } else if (packetCount % 500 === 0) {
      console.log(`AudioSync: ${packetCount} packets received from ${rinfo.address}`);
    }
  });

  socket.on('error', (err) => {
    console.error('AudioSync socket error:', err.message);
  });

  socket.bind(AUDIO_SYNC_PORT, () => {
    const ifaces = os.networkInterfaces();
    const joined: string[] = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) {
          try {
            socket.addMembership(MULTICAST_GROUP, addr.address);
            joined.push(`${name}/${addr.address}`);
            console.log(`  joined ${MULTICAST_GROUP} on ${name} (${addr.address})`);
          } catch (e: any) {
            console.warn(`  failed to join multicast on ${name}: ${e.message}`);
          }
        }
      }
    }
    socket.setBroadcast(true);
    console.log(`AudioSync listening on :${AUDIO_SYNC_PORT} (multicast ${MULTICAST_GROUP} + broadcast)`);
    if (joined.length === 0) {
      console.warn('AudioSync: WARNING — no interfaces joined multicast group!');
    }

    // Periodic "waiting" log if no packets arrive
    const waitTimer = setInterval(() => {
      if (packetCount === 0) {
        console.log(`AudioSync: still waiting for packets on :${AUDIO_SYNC_PORT} (joined: ${joined.join(', ') || 'none'})`);
      } else {
        clearInterval(waitTimer);
      }
    }, 10_000);
    waitTimer.unref();
  });

  function update(t: number): void {
    if (lastPacketTime === 0) return;
    const elapsed = (Date.now() - lastPacketTime) / 1000;
    if (elapsed > 0.1) {
      const decay = Math.max(0, 1 - (elapsed - 0.1) * DECAY_RATE);
      for (let i = 0; i < GEQ_BANDS; i++) geqBands[i] *= decay;
      for (let i = 0; i < FFT_BINS; i++) bins[i] *= decay;
      data.bassEnergy *= decay;
      data.midEnergy *= decay;
      data.highEnergy *= decay;
      if (decay === 0) data.beatDetected = false;
    }
  }

  function close(): void {
    const ifaces = os.networkInterfaces();
    for (const [, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) {
          try { socket.dropMembership(MULTICAST_GROUP, addr.address); } catch {}
        }
      }
    }
    socket.close();
  }

  return {
    data,
    update,
    close,
    get lastPacketTime() { return lastPacketTime; },
  };
}
