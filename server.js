import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

const HEARTBEAT_SECRET = process.env.BOT_HEARTBEAT_SECRET || process.env.HEARTBEAT_SECRET || '';
const HEARTBEAT_TIMEOUT_SECONDS = Number(process.env.HEARTBEAT_TIMEOUT_SECONDS || 120);
const HEARTBEAT_FILE = path.join(__dirname, 'data', 'heartbeat-state.json');

const SESSION_SECRET = process.env.SESSION_SECRET || HEARTBEAT_SECRET || crypto.randomBytes(32).toString('hex');
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || '1321889022380871681';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || process.env.WEBSITE_PUBLIC_URL || '').replace(/\/$/, '');
const UNBAN_API_SECRET = process.env.UNBAN_API_SECRET || HEARTBEAT_SECRET || '';
const UNBAN_APPLICATIONS_FILE = path.join(__dirname, 'data', 'unban-applications.json');
const UNBAN_BAN_CACHE_FILE = path.join(__dirname, 'data', 'unban-ban-cache.json');
const UNBAN_LOOKUP_FILE = path.join(__dirname, 'data', 'unban-lookup-requests.json');

let lastHeartbeat = loadHeartbeatFromDisk();

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '128kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'blue.sid',
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 1000 * 60 * 60 * 24 * 7
  }
}));
app.use(express.static(__dirname, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

function loadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadHeartbeatFromDisk() {
  return loadJson(HEARTBEAT_FILE, null);
}

function saveHeartbeatToDisk(data) {
  try {
    saveJson(HEARTBEAT_FILE, data);
  } catch (error) {
    console.warn('Heartbeat konnte nicht gespeichert werden:', error.message);
  }
}

function readSecret(req, header = 'x-blue-heartbeat-secret') {
  const headerSecret = req.get(header) || '';
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

function publicBaseUrl(req) {
  if (PUBLIC_SITE_URL) return PUBLIC_SITE_URL;
  return `${req.protocol}://${req.get('host')}`;
}

function discordRedirectUri(req) {
  return process.env.DISCORD_REDIRECT_URI || `${publicBaseUrl(req)}/auth/discord/callback`;
}

function requireUser(req, res, next) {
  if (!req.session.discordUser) return res.status(401).json({ ok: false, error: 'Nicht eingeloggt.' });
  return next();
}

function requireBot(req, res, next) {
  if (!UNBAN_API_SECRET) return res.status(500).json({ ok: false, error: 'UNBAN_API_SECRET oder BOT_HEARTBEAT_SECRET fehlt im Website-Service.' });
  if (readSecret(req, 'x-blue-unban-secret') !== UNBAN_API_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return next();
}

function cleanReturnPath(value) {
  const raw = String(value || '/unban.html');
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/unban.html';
  return raw;
}

app.get('/auth/discord', (req, res) => {
  if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
    return res.status(500).send('Discord OAuth ist nicht konfiguriert. DISCORD_CLIENT_ID und DISCORD_CLIENT_SECRET fehlen.');
  }
  const state = crypto.randomUUID();
  req.session.oauthState = state;
  req.session.returnTo = cleanReturnPath(req.query.return);

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', discordRedirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    if (!req.query.code || req.query.state !== req.session.oauthState) {
      return res.status(400).send('Discord Login ungültig oder abgelaufen.');
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: discordRedirectUri(req)
      })
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.warn('Discord OAuth Token Fehler:', text.slice(0, 240));
      return res.status(502).send('Discord Login fehlgeschlagen. Prüfe Redirect URL und Client Secret.');
    }

    const token = await tokenResponse.json();
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });

    if (!userResponse.ok) return res.status(502).send('Discord User konnte nicht geladen werden.');
    const user = await userResponse.json();

    req.session.discordUser = {
      id: user.id,
      username: user.username,
      global_name: user.global_name || user.username,
      avatar: user.avatar || null,
      discriminator: user.discriminator || '0'
    };
    delete req.session.oauthState;
    res.redirect(cleanReturnPath(req.session.returnTo));
  } catch (error) {
    console.error('Discord Login Fehler:', error);
    res.status(500).send('Discord Login Fehler.');
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  res.json({ ok: true, loggedIn: Boolean(req.session.discordUser), user: req.session.discordUser || null });
});

function loadApplications() {
  const data = loadJson(UNBAN_APPLICATIONS_FILE, { applications: [] });
  if (!Array.isArray(data.applications)) data.applications = [];
  return data;
}

function saveApplications(data) {
  saveJson(UNBAN_APPLICATIONS_FILE, data);
}

function loadBanCache() {
  return loadJson(UNBAN_BAN_CACHE_FILE, { users: {} });
}

function saveBanCache(data) {
  if (!data.users || typeof data.users !== 'object') data.users = {};
  saveJson(UNBAN_BAN_CACHE_FILE, data);
}

function loadLookupRequests() {
  const data = loadJson(UNBAN_LOOKUP_FILE, { requests: {} });
  if (!data.requests || typeof data.requests !== 'object') data.requests = {};
  return data;
}

function saveLookupRequests(data) {
  if (!data.requests || typeof data.requests !== 'object') data.requests = {};
  saveJson(UNBAN_LOOKUP_FILE, data);
}

function getPendingForUser(applications, userId, type) {
  return applications.find((app) => app.user?.id === userId && app.type === type && ['pending', 'in_review'].includes(app.status));
}

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function userBanCache(userId) {
  const cache = loadBanCache();
  return cache.users[String(userId)] || {
    discord: { checked: false, banned: false, reason: 'Noch nicht vom Bot geprüft.', duration: 'Unbekannt', until: null },
    global: { checked: false, banned: false, reason: 'Noch nicht vom Bot geprüft.', duration: 'Unbekannt', until: null }
  };
}

app.post('/api/unban/request-lookup', requireUser, (req, res) => {
  const data = loadLookupRequests();
  const userId = req.session.discordUser.id;
  data.requests[userId] = { userId, requestedAt: new Date().toISOString() };
  saveLookupRequests(data);
  res.json({ ok: true });
});

app.get('/api/unban/me', requireUser, (req, res) => {
  const user = req.session.discordUser;
  const applications = loadApplications().applications;
  const pending = {
    discord: getPendingForUser(applications, user.id, 'discord') || null,
    global: getPendingForUser(applications, user.id, 'global') || null
  };
  const history = applications
    .filter((app) => app.user?.id === user.id)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
    .slice(0, 10);
  res.json({ ok: true, user, banInfo: userBanCache(user.id), pending, history });
});

app.post('/api/unban/apply', requireUser, (req, res) => {
  const user = req.session.discordUser;
  const type = String(req.body?.type || '').toLowerCase();
  if (!['discord', 'global'].includes(type)) return res.status(400).json({ ok: false, error: 'Ungültiger Antrag-Typ.' });

  const bannedAt = sanitizeText(req.body.bannedAt, 120);
  const banReason = sanitizeText(req.body.banReason, 1000);
  const whyUnban = sanitizeText(req.body.whyUnban, 1600);
  const notifyDm = Boolean(req.body.notifyDm);

  if (!bannedAt || !banReason || !whyUnban) {
    return res.status(400).json({ ok: false, error: 'Bitte fülle alle Pflichtfelder aus.' });
  }

  const data = loadApplications();
  const existing = getPendingForUser(data.applications, user.id, type);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'Du hast bereits einen Antrag in Bearbeitung.', application: existing });
  }

  const cache = userBanCache(user.id);
  const application = {
    id: `unban_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type,
    user,
    answers: { bannedAt, banReason, whyUnban },
    notifyDm,
    knownBanInfo: cache[type] || null,
    status: 'pending',
    sentToDiscord: false,
    submittedAt: new Date().toISOString(),
    handledAt: null,
    handledBy: null,
    decisionReason: null
  };

  data.applications.push(application);
  saveApplications(data);
  res.json({ ok: true, application });
});

app.get('/api/unban/bot/lookup-requests', requireBot, (_req, res) => {
  const data = loadLookupRequests();
  const now = Date.now();
  const requests = Object.values(data.requests)
    .filter((item) => item?.userId && now - Date.parse(item.requestedAt || 0) < 1000 * 60 * 60)
    .map((item) => ({ userId: String(item.userId), requestedAt: item.requestedAt }));
  res.json({ ok: true, requests });
});

app.post('/api/unban/bot/ban-cache', requireBot, (req, res) => {
  const userId = String(req.body?.userId || '').replace(/\D/g, '');
  if (!userId) return res.status(400).json({ ok: false, error: 'userId fehlt.' });
  const data = loadBanCache();
  data.users[userId] = {
    discord: req.body.discord || { checked: true, banned: false, reason: 'Kein Discord-Ban gefunden.', duration: 'Nicht gebannt', until: null },
    global: req.body.global || { checked: true, banned: false, reason: 'Kein Blue Security Global-Ban gefunden.', duration: 'Nicht gebannt', until: null },
    updatedAt: new Date().toISOString()
  };
  saveBanCache(data);

  const lookup = loadLookupRequests();
  delete lookup.requests[userId];
  saveLookupRequests(lookup);

  res.json({ ok: true });
});

app.get('/api/unban/bot/pending', requireBot, (_req, res) => {
  const data = loadApplications();
  const applications = data.applications.filter((app) => app.status === 'pending' && !app.sentToDiscord);
  res.json({ ok: true, applications });
});

app.post('/api/unban/bot/sent', requireBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadApplications();
  const appItem = data.applications.find((app) => app.id === id);
  if (!appItem) return res.status(404).json({ ok: false, error: 'Antrag nicht gefunden.' });
  appItem.sentToDiscord = true;
  appItem.status = 'in_review';
  appItem.discordLog = {
    channelId: String(req.body.channelId || ''),
    messageId: String(req.body.messageId || ''),
    sentAt: new Date().toISOString()
  };
  saveApplications(data);
  res.json({ ok: true });
});

app.post('/api/unban/bot/status', requireBot, (req, res) => {
  const id = String(req.body?.id || '');
  const status = String(req.body?.status || '');
  if (!['accepted', 'rejected', 'error'].includes(status)) return res.status(400).json({ ok: false, error: 'Ungültiger Status.' });
  const data = loadApplications();
  const appItem = data.applications.find((app) => app.id === id);
  if (!appItem) return res.status(404).json({ ok: false, error: 'Antrag nicht gefunden.' });
  appItem.status = status;
  appItem.handledAt = new Date().toISOString();
  appItem.handledBy = req.body.handledBy || null;
  appItem.decisionReason = sanitizeText(req.body.reason, 1000) || null;
  saveApplications(data);
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Blue Website läuft auf Port ${port}`);
  console.log(`Heartbeat Timeout: ${HEARTBEAT_TIMEOUT_SECONDS}s`);
  if (!HEARTBEAT_SECRET) console.warn('BOT_HEARTBEAT_SECRET fehlt. /api/heartbeat nimmt keine Heartbeats an.');
  if (!DISCORD_CLIENT_SECRET) console.warn('DISCORD_CLIENT_SECRET fehlt. Discord Login für Unban-Anträge ist deaktiviert.');
  if (!UNBAN_API_SECRET) console.warn('UNBAN_API_SECRET/BOT_HEARTBEAT_SECRET fehlt. Bot kann Unban-Anträge nicht abrufen.');
});
