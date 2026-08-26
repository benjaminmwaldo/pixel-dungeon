// A small RFC 6455 WebSocket server, written from scratch so the whole game
// runs on a bare `node server/index.js` with nothing to install.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xA };

export class WebSocketConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.fragOp = 0;
    this.frags = [];

    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => this._die());
    socket.on('error', () => this._die());
    socket.setNoDelay(true);
  }

  _die() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  _onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    // Cheap flood guard: a client should never queue megabytes at us.
    if (this.buf.length > 1 << 20) { this.close(1009, 'too big'); return; }

    for (;;) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handleFrame(frame);
      if (this.closed) break;
    }
  }

  _readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;

    const fin = (b[0] & 0x80) !== 0;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;

    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off); off += 8;
      if (big > 1n << 24n) { this.close(1009, 'too big'); return null; }
      len = Number(big);
    }

    let mask = null;
    if (masked) {
      if (b.length < off + 4) return null;
      mask = b.subarray(off, off + 4); off += 4;
    }

    if (b.length < off + len) return null;
    const payload = Buffer.from(b.subarray(off, off + len));
    this.buf = b.subarray(off + len);

    if (mask) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    return { fin, opcode, payload };
  }

  _handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case OP.PING: this._send(OP.PONG, payload); break;
      case OP.PONG: break;
      case OP.CLOSE: this.close(1000, ''); break;
      case OP.TEXT:
      case OP.BIN:
        if (fin) { this.emit('message', payload.toString('utf8')); }
        else { this.fragOp = opcode; this.frags = [payload]; }
        break;
      case OP.CONT:
        this.frags.push(payload);
        if (fin) {
          const all = Buffer.concat(this.frags);
          this.frags = [];
          this.emit('message', all.toString('utf8'));
        }
        break;
      default: this.close(1002, 'bad opcode');
    }
  }

  _send(opcode, payload) {
    if (this.closed || this.socket.destroyed) return;
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this._die(); }
  }

  send(str) { this._send(OP.TEXT, Buffer.from(str, 'utf8')); }

  sendJson(obj) { this.send(JSON.stringify(obj)); }

  close(code = 1000, reason = '') {
    if (this.closed) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this._send(OP.CLOSE, body);
    this.closed = true;
    try { this.socket.end(); } catch { /* already gone */ }
    this.emit('close');
  }
}

/** Attach WebSocket upgrade handling to a plain node http server. */
export function attachWebSocket(server, onConnection) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    onConnection(new WebSocketConn(socket), req);
  });
}
