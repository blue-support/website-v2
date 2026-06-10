import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

const HEARTBEAT_SECRET = process.env.BOT_HEARTBEAT_SECRET || process.env.HEARTBEAT_SECRET || '';
const HEARTBEAT_TIMEOUT_SECONDS = Number(process.env.HEARTBEAT_TIMEOUT_SECONDS || 120);
const HEARTBEAT_FILE = path.join(__dirname, 'data', 'heartbeat-state.json');

let lastHeartbeat = loadHeartbeatFromDisk();

app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.static(__dirname, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function loadHeartbeatFromDisk() {
  try {
    if (!fs.existsSync(HEARTBEAT_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveHeartbeatToDisk(data) {
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT_FILE), { recursive: true });
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn('Heartbeat konnte nicht gespeichert werden:', error.message);
  }
}

function readSecret(req) {
  const headerSecret = req.get('x-blue-heartbeat-secret') || '';
  const auth = req.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  return headerSecret || bearer;
}

function heartbeatAgeSeconds() {
  if (!lastHeartbeat?.receivedAt) return null;
  return Math.max(0, Math.round((Date.now() - Number(lastHeartbeat.receivedAt)) / 1000));
}

function heartbeatFresh() {
  const age = heartbeatAgeSeconds();
  return age !== null && age <= HEARTBEAT_TIMEOUT_SECONDS;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function botOnline() {
  return heartbeatFresh() && Boolean(lastHeartbeat?.botReady);
}

function currentStats() {
  const online = botOnline();
  return {
    onlineUsers: online ? safeNumber(lastHeartbeat.onlineUsers) : 0,
    guilds: online ? safeNumber(lastHeartbeat.guilds) : 0,
    totalUsers: online ? safeNumber(lastHeartbeat.totalUsers) : 0,
    commandsToday: online ? safeNumber(lastHeartbeat.commandsToday) : 0,
    latency: online && lastHeartbeat.latency !== null && lastHeartbeat.latency !== undefined ? safeNumber(lastHeartbeat.latency, null) : null,
    uptime: online ? (lastHeartbeat.uptime || '—') : '—',
    botReady: online,
    version: online ? (lastHeartbeat.version || 'Unbekannt') : '—',
    lastHeartbeatAt: lastHeartbeat?.receivedAtIso || null,
    heartbeatAgeSeconds: heartbeatAgeSeconds(),
    heartbeatTimeoutSeconds: HEARTBEAT_TIMEOUT_SECONDS
  };
}

app.post('/api/heartbeat', (req, res) => {
  if (!HEARTBEAT_SECRET) {
    return res.status(500).json({ ok: false, error: 'BOT_HEARTBEAT_SECRET fehlt im Website-Service.' });
  }

  if (readSecret(req) !== HEARTBEAT_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const body = req.body || {};
  const now = Date.now();

  lastHeartbeat = {
    botReady: body.botReady !== false,
    guilds: safeNumber(body.guilds),
    totalUsers: safeNumber(body.totalUsers),
    onlineUsers: safeNumber(body.onlineUsers),
    commandsToday: safeNumber(body.commandsToday),
    latency: body.latency === null || body.latency === undefined ? null : safeNumber(body.latency, null),
    uptime: String(body.uptime || '—'),
    version: String(body.version || 'Unbekannt'),
    source: String(body.source || 'Blue Python Bot'),
    receivedAt: now,
    receivedAtIso: new Date(now).toISOString()
  };

  saveHeartbeatToDisk(lastHeartbeat);
  res.json({ ok: true, receivedAt: lastHeartbeat.receivedAtIso });
});

app.get('/api/heartbeat', (_req, res) => {
  res.json({
    configured: Boolean(HEARTBEAT_SECRET),
    fresh: heartbeatFresh(),
    online: botOnline(),
    ageSeconds: heartbeatAgeSeconds(),
    timeoutSeconds: HEARTBEAT_TIMEOUT_SECONDS,
    lastHeartbeatAt: lastHeartbeat?.receivedAtIso || null
  });
});

app.get('/api/stats', (_req, res) => {
  res.json(currentStats());
});

app.get('/api/status', (_req, res) => {
  const stats = currentStats();
  const online = stats.botReady;
  const degraded = online && stats.latency !== null && stats.latency > 250;
  const overall = online ? (degraded ? 'degraded' : 'online') : 'offline';
  const ageText = stats.heartbeatAgeSeconds === null ? 'Noch kein Heartbeat empfangen' : `Letzter Heartbeat vor ${stats.heartbeatAgeSeconds}s`;

  res.json({
    overall,
    title: online ? (degraded ? 'Erhöhte Latenz' : 'Alle Systeme operational') : 'Bot offline',
    message: online
      ? (degraded ? `Blue ⚡ läuft, aber der Ping liegt bei ${stats.latency}ms. ${ageText}.` : `Blue ⚡ läuft stabil. ${ageText}.`)
      : `Blue ⚡ sendet aktuell keinen frischen Heartbeat. ${ageText}.`,
    components: [
      { name: 'Bot Heartbeat', status: online ? 'online' : 'offline', description: online ? ageText : `Timeout: ${HEARTBEAT_TIMEOUT_SECONDS}s` },
      { name: 'Discord Gateway', status: overall, description: online && stats.latency !== null ? `${stats.latency}ms Ping` : 'Keine frischen Bot-Daten' },
      { name: 'Slash Commands', status: online ? 'online' : 'offline', description: 'Command Handling' },
      { name: 'Ticket System', status: online ? 'online' : 'offline', description: 'Support Module' },
      { name: 'Website', status: 'online', description: 'Frontend & API erreichbar' },
      { name: 'Render Service', status: 'online', description: 'Hosting läuft' }
    ],
    incidents: [
      online
        ? { title: 'Keine aktiven Incidents', date: new Date().toISOString().slice(0, 10), text: 'Der echte Python-Bot sendet frische Heartbeats.' }
        : { title: 'Kein frischer Bot-Heartbeat', date: new Date().toISOString().slice(0, 10), text: 'Wenn der Bot läuft, prüfe BLUE_WEBSITE_HEARTBEAT_URL und BOT_HEARTBEAT_SECRET beim Bot.' }
    ]
  });
});

app.listen(port, () => {
  console.log(`Blue Website läuft auf Port ${port}`);
  console.log(`Heartbeat Timeout: ${HEARTBEAT_TIMEOUT_SECONDS}s`);
  if (!HEARTBEAT_SECRET) console.warn('BOT_HEARTBEAT_SECRET fehlt. /api/heartbeat nimmt keine Heartbeats an.');
});
