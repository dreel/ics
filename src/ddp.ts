import dgram from 'node:dgram';
import { DDP_PORT, MAX_DDP_PAYLOAD } from './types.js';

export interface DdpClient {
  sendFrame(leds: Uint8Array): void;
  setTarget(ip: string): void;
  close(): void;
}

export function createDdpClient(ip: string, ledCount: number): DdpClient {
  const socket = dgram.createSocket('udp4');
  let targetIp = ip;
  let seq = 1;

  // Pre-allocate packet buffers
  const totalBytes = ledCount * 3;
  const packetCount = Math.ceil(totalBytes / MAX_DDP_PAYLOAD);
  const packets: Buffer[] = [];
  for (let i = 0; i < packetCount; i++) {
    const offset = i * MAX_DDP_PAYLOAD;
    const payloadLen = Math.min(MAX_DDP_PAYLOAD, totalBytes - offset);
    packets.push(Buffer.alloc(10 + payloadLen));
  }

  function sendFrame(leds: Uint8Array): void {
    if (!targetIp) return;

    for (let i = 0; i < packetCount; i++) {
      const buf = packets[i];
      const offset = i * MAX_DDP_PAYLOAD;
      const payloadLen = Math.min(MAX_DDP_PAYLOAD, totalBytes - offset);
      const isLast = i === packetCount - 1;

      // Flags: version=1, push on last packet
      buf[0] = isLast ? (0x41 | 0x80) : 0x41; // VER1 + PUSH + DATATYPE
      buf[1] = seq;
      buf[2] = 0x01; // data type: RGB
      buf[3] = 0x01; // destination: output 1

      // Offset (uint32 BE)
      buf[4] = (offset >>> 24) & 0xff;
      buf[5] = (offset >>> 16) & 0xff;
      buf[6] = (offset >>> 8) & 0xff;
      buf[7] = offset & 0xff;

      // Length (uint16 BE)
      buf[8] = (payloadLen >>> 8) & 0xff;
      buf[9] = payloadLen & 0xff;

      // Copy LED data
      buf.set(leds.subarray(offset, offset + payloadLen), 10);

      socket.send(buf, 0, buf.length, DDP_PORT, targetIp);
    }

    seq = (seq % 255) + 1;
  }

  function setTarget(ip: string): void {
    targetIp = ip;
  }

  function close(): void {
    try {
      socket.close();
    } catch {}
  }

  return { sendFrame, setTarget, close };
}
