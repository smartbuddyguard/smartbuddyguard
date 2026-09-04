// Minimaler WebSocket-Server (RFC 6455) auf Basis von node:net-Sockets.
// Ersetzt die Bibliothek `ws`, damit das Projekt ohne `npm install` läuft.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 8 * 1024 * 1024; // 8 MB pro Nachricht reichen; Medien laufen über HTTP-Upload

export class WebSocketConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.open = true;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOp = 0;
    this.isAlive = true;

    socket.on('data', (chunk) => this._onData(chunk));
    // HTTP-Sockets laufen mit allowHalfOpen: ohne `end` bliebe die Gegenseite
    // nach einem FIN als tote Verbindung registriert.
    socket.on('end', () => this._down());
    socket.on('close', () => this._down());
    socket.on('error', () => this._down());
  }

  _down() {
    if (!this.open) return;
    this.open = false;
    try { this.socket.destroy(); } catch { /* bereits geschlossen */ }
    this.emit('close');
  }

  _onData(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    while (this.open) {
      const frame = this._readFrame();
      if (!frame) break;
      this._handleFrame(frame);
    }
  }

  _readFrame() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const fin = (buf[0] & 0x80) !== 0;
    const opcode = buf[0] & 0x0f;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < offset + 2) return null;
      len = buf.readUInt16BE(offset);
      offset += 2;
    } else if (len === 127) {
      if (buf.length < offset + 8) return null;
      const big = buf.readBigUInt64BE(offset);
      if (big > BigInt(MAX_FRAME)) { this.close(1009, 'too large'); return null; }
      len = Number(big);
      offset += 8;
    }
    if (len > MAX_FRAME) { this.close(1009, 'too large'); return null; }

    let mask = null;
    if (masked) {
      if (buf.length < offset + 4) return null;
      mask = buf.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buf.length < offset + len) return null;

    const payload = Buffer.from(buf.subarray(offset, offset + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buffer = buf.subarray(offset + len);
    return { fin, opcode, payload };
  }

  _handleFrame({ fin, opcode, payload }) {
    switch (opcode) {
      case 0x0: // Fortsetzung
      case 0x1: // Text
      case 0x2: { // Binär
        if (opcode !== 0x0) this.fragmentOp = opcode;
        this.fragments.push(payload);
        if (!fin) return;
        const full = this.fragments.length === 1 ? this.fragments[0] : Buffer.concat(this.fragments);
        this.fragments = [];
        if (this.fragmentOp === 0x1) this.emit('message', full.toString('utf8'));
        else this.emit('binary', full);
        return;
      }
      case 0x8: // Close
        this.close(1000, '');
        return;
      case 0x9: // Ping
        this._frame(0xa, payload);
        return;
      case 0xa: // Pong
        this.isAlive = true;
        return;
      default:
        this.close(1002, 'bad opcode');
    }
  }

  _frame(opcode, payload) {
    if (!this.open || this.socket.destroyed) return;
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
    try { this.socket.write(Buffer.concat([header, payload])); } catch { this._down(); }
  }

  send(data) {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    this._frame(0x1, Buffer.from(text, 'utf8'));
  }

  ping() {
    this.isAlive = false;
    this._frame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = '') {
    if (!this.open) return;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    this._frame(0x8, body);
    this.open = false;
    try { this.socket.end(); } catch { /* egal */ }
    this.emit('close');
  }
}

/**
 * Hängt sich an das `upgrade`-Event eines http.Servers.
 * `onConnection(conn, request)` wird nach erfolgreichem Handshake aufgerufen.
 */
export function attachWebSocket(server, onConnection) {
  server.on('upgrade', (req, socket, head) => {
    const key = req.headers['sec-websocket-key'];
    if (req.headers.upgrade?.toLowerCase() !== 'websocket' || !key) {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    socket.setTimeout(0);
    const conn = new WebSocketConnection(socket);
    if (head?.length) conn._onData(head);
    onConnection(conn, req);
  });
}
