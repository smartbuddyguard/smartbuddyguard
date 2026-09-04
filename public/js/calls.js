// Sprach- und Videoanrufe über WebRTC. Die Signalisierung (Angebot, Antwort,
// ICE-Kandidaten) läuft über die bestehende WebSocket-Verbindung; Ton und Bild
// gehen anschließend direkt von Gerät zu Gerät.
import { $, el, svg, ICONS, avatarEl, duration, toast } from './util.js';
import { state, on, getChat, getUser } from './state.js';
import { sendCall, sendMessage } from './socket.js';
import { seal, chatKey } from './crypto.js';

const RTC_CONF = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
};
const RING_TIMEOUT = 45000;

const call = {
  id: null, pc: null, local: null, kind: 'video', peerId: null, chatId: null,
  outgoing: false, startedAt: 0, timer: null, ui: null, ringEl: null,
  ringTimer: null, pendingIce: [], ended: false
};

/* ------------------------------ Oberfläche ------------------------------ */
function callButton(icon, label, cls, onClick) {
  return el('button', {
    class: `call-btn ${cls}`.trim(), type: 'button', title: label,
    'aria-label': label, html: svg(icon, 25), onclick: onClick
  });
}

function buildUi(peerName, peerColor) {
  const remote = el('video', { class: 'call-remote', autoplay: true, playsinline: true, hidden: true });
  const self = el('video', { class: 'call-self', autoplay: true, playsinline: true, muted: true, hidden: true });
  const stateLine = el('div', { class: 'call-state', text: call.outgoing ? 'Klingelt …' : 'Verbinde …' });
  const timer = el('div', { class: 'call-timer' });
  const topClock = el('span', { class: 'clock' });
  const idle = el('div', { class: 'call-idle' }, [
    avatarEl({ name: peerName, color: peerColor }, 'avatar-xl'),
    el('div', { class: 'call-name', text: peerName }),
    stateLine,
    timer
  ]);

  const micBtn = callButton(ICONS.mute, 'Mikrofon', '', () => {
    const track = call.local?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    micBtn.classList.toggle('off', !track.enabled);
  });
  const camBtn = callButton(ICONS.videocam, 'Kamera', '', () => {
    const track = call.local?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    camBtn.classList.toggle('off', !track.enabled);
    self.hidden = !track.enabled;
  });
  const hangBtn = callButton(ICONS.hangup, 'Auflegen', 'hang', () => endCall(true));

  const node = el('div', { class: 'call' }, [
    el('div', { class: 'call-stage' }, [
      remote, idle, self,
      el('div', { class: 'call-top' }, [
        el('span', { class: 'peer', text: peerName }),
        topClock,
        el('span', { class: 'lock', html: svg(ICONS.lock, 14) + '<span>Direktverbindung</span>' })
      ])
    ]),
    el('div', { class: 'call-bar' }, call.kind === 'video' ? [micBtn, camBtn, hangBtn] : [micBtn, hangBtn])
  ]);
  document.body.append(node);
  return { node, remote, self, stateLine, timer, topClock, idle };
}

const setState = (text) => { if (call.ui) call.ui.stateLine.textContent = text; };

function startTimer() {
  call.startedAt = Date.now();
  clearInterval(call.timer);
  call.timer = setInterval(() => {
    if (!call.ui) return;
    const text = duration((Date.now() - call.startedAt) / 1000);
    call.ui.timer.textContent = text;
    call.ui.topClock.textContent = text;
  }, 500);
}

/* -------------------------------- Medien -------------------------------- */
async function getMedia(kind) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('keine Medien'), { name: 'NotSupportedError' });
  }
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false
  });
}

function mediaError(err) {
  if (err?.name === 'NotAllowedError') return 'Kamera und Mikrofon wurden nicht freigegeben.';
  if (err?.name === 'NotFoundError') return 'Es ist keine Kamera oder kein Mikrofon angeschlossen.';
  if (err?.name === 'NotSupportedError') return 'Dieser Browser gibt hier keine Medien frei. Über HTTPS oder localhost aufrufen.';
  return 'Der Anruf ließ sich nicht starten.';
}

function newPeerConnection() {
  const pc = new RTCPeerConnection(RTC_CONF);
  pc.onicecandidate = (event) => {
    if (!event.candidate || !call.id) return;
    sendCall({ sub: 'ice', to: call.peerId, callId: call.id, candidate: event.candidate.toJSON() });
  };
  pc.ontrack = (event) => {
    if (!call.ui) return;
    call.ui.remote.srcObject = event.streams[0];
    const hasVideo = event.streams[0].getVideoTracks().length > 0;
    call.ui.remote.hidden = !hasVideo;
    call.ui.idle.style.opacity = hasVideo ? '0' : '1';
    call.ui.idle.style.pointerEvents = 'none';
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      setState('Verbunden');
      if (!call.startedAt) startTimer();
    } else if (pc.connectionState === 'failed') {
      setState('Verbindung fehlgeschlagen');
      toast('Die direkte Verbindung kam nicht zustande — meist blockiert ein Netzwerk das.', 'error');
      setTimeout(() => endCall(true), 1200);
    }
  };
  return pc;
}

/* ------------------------------ Anruf starten --------------------------- */
export async function startCall(kind) {
  const chat = getChat(state.activeChatId);
  if (!chat || chat.type !== 'private') return;
  if (call.id) { toast('Es läuft schon ein Anruf.'); return; }
  const peer = chat.peer;
  if (!peer) return;
  if (!peer.online) { toast(`${chat.title} ist gerade nicht online.`, 'error'); return; }

  let stream;
  try { stream = await getMedia(kind); }
  catch (err) { toast(mediaError(err), 'error'); return; }

  Object.assign(call, {
    id: 'call_' + Math.random().toString(36).slice(2, 12),
    kind, peerId: peer.id, chatId: chat.id, outgoing: true,
    local: stream, pendingIce: [], ended: false, startedAt: 0
  });
  call.ui = buildUi(chat.title, chat.color);
  if (kind === 'video') { call.ui.self.srcObject = stream; call.ui.self.hidden = false; }

  call.pc = newPeerConnection();
  stream.getTracks().forEach((track) => call.pc.addTrack(track, stream));
  const offer = await call.pc.createOffer();
  await call.pc.setLocalDescription(offer);
  sendCall({
    sub: 'offer', to: peer.id, callId: call.id, chatId: chat.id, kind,
    sdp: { type: offer.type, sdp: offer.sdp }
  });

  call.ringTimer = setTimeout(() => {
    if (call.id && !call.startedAt) { toast('Keine Antwort.'); endCall(true, true); }
  }, RING_TIMEOUT);
}

/* ------------------------- Eingehender Anruf ---------------------------- */
function showRing(msg) {
  if (call.id || call.ringEl) {
    sendCall({ sub: 'end', to: msg.from, callId: msg.callId, reason: 'busy' });
    return;
  }
  const name = getUser(msg.from)?.name || msg.fromName || 'Unbekannt';
  const color = getUser(msg.from)?.color;

  const node = el('div', { class: 'ring' }, [
    avatarEl({ name, color }),
    el('div', {}, [
      el('div', { class: 'who', text: name }),
      el('div', { class: 'what', text: (msg.kind === 'video' ? 'Videoanruf' : 'Sprachanruf') + ' …' })
    ]),
    el('button', {
      class: 'ring-btn yes', type: 'button', 'aria-label': 'Annehmen',
      html: svg(msg.kind === 'video' ? ICONS.videocam : ICONS.phone, 22),
      onclick: () => { closeRing(); answer(msg); }
    }),
    el('button', {
      class: 'ring-btn no', type: 'button', 'aria-label': 'Ablehnen',
      html: svg(ICONS.close, 22),
      onclick: () => {
        closeRing();
        sendCall({ sub: 'end', to: msg.from, callId: msg.callId, reason: 'declined' });
      }
    })
  ]);
  document.body.append(node);
  call.ringEl = node;
  call.pendingOffer = msg;
  clearTimeout(call.ringTimer);
  call.ringTimer = setTimeout(closeRing, RING_TIMEOUT);
}

function closeRing() {
  clearTimeout(call.ringTimer);
  call.ringEl?.remove();
  call.ringEl = null;
  call.pendingOffer = null;
}

async function answer(msg) {
  let stream;
  try { stream = await getMedia(msg.kind); }
  catch (err) {
    toast(mediaError(err), 'error');
    sendCall({ sub: 'end', to: msg.from, callId: msg.callId, reason: 'nomedia' });
    return;
  }

  Object.assign(call, {
    id: msg.callId, kind: msg.kind, peerId: msg.from, chatId: msg.chatId,
    outgoing: false, local: stream, pendingIce: [], ended: false, startedAt: 0
  });
  const name = getUser(msg.from)?.name || msg.fromName || 'Unbekannt';
  call.ui = buildUi(name, getUser(msg.from)?.color);
  if (msg.kind === 'video') { call.ui.self.srcObject = stream; call.ui.self.hidden = false; }

  call.pc = newPeerConnection();
  stream.getTracks().forEach((track) => call.pc.addTrack(track, stream));
  await call.pc.setRemoteDescription(msg.sdp);
  for (const cand of call.pendingIce) await call.pc.addIceCandidate(cand).catch(() => {});
  call.pendingIce = [];
  const answerSdp = await call.pc.createAnswer();
  await call.pc.setLocalDescription(answerSdp);
  sendCall({
    sub: 'answer', to: msg.from, callId: msg.callId,
    sdp: { type: answerSdp.type, sdp: answerSdp.sdp }
  });
  startTimer();
}

/* ------------------------------ Auflegen -------------------------------- */
export async function endCall(announce, missed = false) {
  if (!call.id || call.ended) return;
  call.ended = true;
  const { id, peerId, outgoing, chatId, kind, startedAt } = call;
  const seconds = startedAt ? (Date.now() - startedAt) / 1000 : 0;

  clearInterval(call.timer);
  clearTimeout(call.ringTimer);
  call.pc?.close();
  call.local?.getTracks().forEach((track) => track.stop());
  call.ui?.node.remove();
  Object.assign(call, {
    id: null, pc: null, local: null, ui: null, timer: null,
    startedAt: 0, ended: false, pendingIce: []
  });

  if (announce) sendCall({ sub: 'end', to: peerId, callId: id });

  // Nur die anrufende Seite schreibt den Eintrag in den Verlauf.
  if (outgoing && chatId) {
    const wasMissed = missed || !startedAt;
    try {
      if (await chatKey(chatId)) {
        const body = { c: { kind, sec: Math.round(seconds), missed: wasMissed } };
        sendMessage({ chatId, enc: await seal(chatId, body) });
      }
    } catch { /* der Verlaufseintrag ist zweitrangig */ }
  }
}

/* --------------------------- Signale empfangen -------------------------- */
async function onSignal(msg) {
  if (msg.sub === 'offer') { showRing(msg); return; }

  if (msg.sub === 'answer') {
    if (msg.callId !== call.id || !call.pc) return;
    setState('Verbunden');
    await call.pc.setRemoteDescription(msg.sdp).catch(() => {});
    for (const cand of call.pendingIce) await call.pc.addIceCandidate(cand).catch(() => {});
    call.pendingIce = [];
    return;
  }

  if (msg.sub === 'ice') {
    if (msg.callId !== call.id && msg.callId !== call.pendingOffer?.callId) return;
    if (!call.pc || !call.pc.remoteDescription) { call.pendingIce.push(msg.candidate); return; }
    await call.pc.addIceCandidate(msg.candidate).catch(() => {});
    return;
  }

  if (msg.sub === 'end') {
    if (call.ringEl && msg.callId === call.pendingOffer?.callId) { closeRing(); return; }
    if (msg.callId !== call.id) return;
    if (msg.reason === 'declined') toast('Anruf abgelehnt.');
    if (msg.reason === 'busy') toast('Die andere Seite telefoniert gerade.');
    endCall(false, msg.reason === 'declined' || msg.reason === 'busy');
  }
}

export function initCalls() {
  on('call:signal', onSignal);
  $('#audioCallBtn')?.addEventListener('click', () => startCall('audio'));
  $('#videoCallBtn')?.addEventListener('click', () => startCall('video'));
  window.addEventListener('beforeunload', () => { if (call.id) endCall(true); });

  // Anrufknöpfe nur in Einzelchats zeigen
  on('active', updateButtons);
  on('chats', updateButtons);
}

function updateButtons() {
  const chat = getChat(state.activeChatId);
  const show = !!chat && chat.type === 'private';
  const audio = $('#audioCallBtn');
  const video = $('#videoCallBtn');
  if (audio) audio.hidden = !show;
  if (video) video.hidden = !show;
}
