'use strict';
// Osmanli: Son Kusatma - 4 oyunculu ortak sefer sunucusu
// Yerel: npm install && npm start
// Render: PORT otomatik verilir; /health saglik kontrolu icindir.
const http = require('node:http');
const { randomBytes, randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 8080);
const HOST = '0.0.0.0';
const MAX_PLAYERS = 4;
const rooms = new Map();
const clients = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    const body = JSON.stringify({ ok: true, service: 'osmanli-son-kusatma-coop', rooms: rooms.size });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server, maxPayload: 4096, perMessageDeflate: false });
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  const bytes = randomBytes(6);
  return [...bytes].map(b => alphabet[b % alphabet.length]).join('');
}
function cleanName(value) {
  return String(value || 'Osmanli Askeri').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 18) || 'Osmanli Askeri';
}
function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function roomPlayers(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, chapter: p.chapter
  }));
}
function leave(ws) {
  const client = clients.get(ws);
  if (!client) return;
  const room = rooms.get(client.room);
  if (room) {
    room.players.delete(client.id);
    if (room.players.size === 0) rooms.delete(client.room);
    else {
      const list = roomPlayers(room);
      for (const p of room.players.values()) send(p.ws, { type: 'player_left', id: client.id, players: list });
    }
  }
  clients.delete(ws);
}
function join(ws, room, name) {
  if (!room) return send(ws, { type: 'error', message: 'Oda bulunamadi.' });
  if (room.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'Bu oda dolu. En fazla 4 oyuncu katilabilir.' });
  const id = randomUUID();
  const player = { id, name: cleanName(name), ws, x: 0, y: 0, z: 0, yaw: 0, chapter: 1 };
  room.players.set(id, player);
  clients.set(ws, { id, room: room.code });
  send(ws, { type: 'room', room: room.code, id, players: roomPlayers(room) });
  const list = roomPlayers(room);
  for (const other of room.players.values()) if (other.id !== id) send(other.ws, { type: 'players', players: list });
}

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return send(ws, { type: 'error', message: 'Gecersiz mesaj.' }); }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'create_room') {
      leave(ws);
      let code;
      do { code = makeCode(); } while (rooms.has(code));
      const room = { code, players: new Map() };
      rooms.set(code, room);
      return join(ws, room, msg.name);
    }
    if (msg.type === 'join_room') {
      leave(ws);
      const code = String(msg.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      return join(ws, rooms.get(code), msg.name);
    }

    const client = clients.get(ws);
    if (!client) return;
    const room = rooms.get(client.room);
    if (!room) return;
    if (msg.type === 'leave_room') return leave(ws);
    if (msg.type === 'move') {
      const player = room.players.get(client.id);
      if (!player) return;
      player.name = cleanName(msg.name || player.name);
      for (const key of ['x', 'y', 'z', 'yaw']) {
        const value = Number(msg[key]);
        if (Number.isFinite(value) && Math.abs(value) < 10000) player[key] = value;
      }
      const chapter = Number(msg.chapter);
      if (Number.isInteger(chapter) && chapter >= 1 && chapter <= 100) player.chapter = chapter;
      const packet = { type: 'player_moved', id: player.id, name: player.name, x: player.x, y: player.y, z: player.z, yaw: player.yaw, chapter: player.chapter };
      for (const other of room.players.values()) if (other.id !== player.id) send(other.ws, packet);
    }
  });
  ws.on('close', () => leave(ws));
  ws.on('error', () => leave(ws));
});

// Heartbeat: kopmus veya yanit vermeyen baglantilari temizle.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 25000);

server.listen(PORT, HOST, () => {
  console.log(`Osmanli co-op sunucusu ${HOST}:${PORT} adresinde hazir.`);
});
function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'Sunucu yeniden baslatiliyor');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
