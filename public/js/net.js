// WebSocket client: join, input upload, snapshot download, latency probe.

import { INPUT_HZ } from '/shared/constants.js';

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.connected = false;
    this.ping = 0;
    this.seq = 0;
    this.lastInputSent = 0;
    this.serverOffset = 0;
    this.bytesIn = 0;
  }

  connect(name, color) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${location.host}`;
    this.ws = new WebSocket(url);
    this.name = name;
    this.color = color;

    this.ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'join', name, color });
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
      this.send({ t: 'ping', c: performance.now() });
      this.h.onOpen && this.h.onOpen();
    };

    this.ws.onmessage = (ev) => {
      this.bytesIn += ev.data.length || 0;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.t) {
        case 'welcome': this.h.onWelcome && this.h.onWelcome(msg); break;
        case 's': this.h.onSnapshot && this.h.onSnapshot(msg); break;
        case 'r': this.h.onRoster && this.h.onRoster(msg); break;
        case 'pong':
          this.ping = Math.round(performance.now() - msg.c);
          this.serverOffset = msg.s - Date.now();
          break;
        case 'full': this.h.onError && this.h.onError('Server ist voll – bitte später erneut versuchen.'); break;
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this.pingTimer);
      this.h.onClose && this.h.onClose();
    };

    this.ws.onerror = () => {
      this.h.onError && this.h.onError('Verbindung fehlgeschlagen.');
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendInput(input, now) {
    if (now - this.lastInputSent < 1000 / INPUT_HZ) return;
    this.lastInputSent = now;
    this.send({
      t: 'in',
      seq: ++this.seq,
      mx: Math.round(input.mx * 100) / 100,
      my: Math.round(input.my * 100) / 100,
      aim: Math.round(input.aim * 1000) / 1000,
      fire: input.fire,
      brake: input.brake,
      enter: input.enter,
      swap: input.swap
    });
  }

  requestRespawn() { this.send({ t: 'respawn' }); }

  selectWeapon(w) { this.send({ t: 'weapon', w }); }

  close() { if (this.ws) this.ws.close(); }
}
