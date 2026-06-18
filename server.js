import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

// Runtime-Daten (Dashboard-Einstellungen, Tickets, OAuth-Session-Cache, Uploads) gehören nicht in den Build-Ordner.
// Auf Render am besten einen Persistent Disk mounten und BLUE_DATA_DIR=/var/data setzen.
// Fallback bleibt ./data, damit lokale Entwicklung und bestehende Setups weiter funktionieren.
const DATA_DIR = path.resolve(process.env.BLUE_DATA_DIR || path.join(__dirname, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

const HEARTBEAT_SECRET = process.env.BOT_HEARTBEAT_SECRET || process.env.HEARTBEAT_SECRET || '';
const HEARTBEAT_TIMEOUT_SECONDS = Number(process.env.HEARTBEAT_TIMEOUT_SECONDS || 120);
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat-state.json');

const SESSION_SECRET = process.env.SESSION_SECRET || HEARTBEAT_SECRET || crypto.randomBytes(32).toString('hex');
const DISCORD_CLIENT_ID = String(process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || '1321889022380871681').trim();
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || process.env.WEBSITE_PUBLIC_URL || '').trim().replace(/\/$/, '');
const DISCORD_OAUTH_RATE_LIMIT_FILE = path.join(DATA_DIR, 'discord-oauth-rate-limit.json');
const DISCORD_OAUTH_MIN_RETRY_SECONDS = Number(process.env.DISCORD_OAUTH_MIN_RETRY_SECONDS || 5);
// Nur kurzer lokaler Schutz gegen Doppelklicks/Callback-Refresh.
// Keine lange gespeicherte Sperre mehr, damit Logout -> späterer Login nicht fälschlich 30-60 Minuten blockiert.
const DISCORD_OAUTH_FALLBACK_RETRY_SECONDS = Number(process.env.DISCORD_OAUTH_FALLBACK_RETRY_SECONDS || 60);
const DISCORD_OAUTH_MAX_LOCAL_BLOCK_SECONDS = Number(process.env.DISCORD_OAUTH_MAX_LOCAL_BLOCK_SECONDS || 10);
// Release-sicher: erfolgreiche Discord-Logins werden länger erinnert.
// Dadurch müssen viele Member beim Release nicht bei jedem Reload/Logout wieder durch Discord OAuth.
const DISCORD_RELOGIN_CACHE_MS = Number(process.env.DISCORD_RELOGIN_CACHE_MS || (1000 * 60 * 60 * 24 * 30));
const UNBAN_API_SECRET = process.env.UNBAN_API_SECRET || HEARTBEAT_SECRET || '';
const UNBAN_APPLICATIONS_FILE = path.join(DATA_DIR, 'unban-applications.json');
const UNBAN_BAN_CACHE_FILE = path.join(DATA_DIR, 'unban-ban-cache.json');
const UNBAN_LOOKUP_FILE = path.join(DATA_DIR, 'unban-lookup-requests.json');

const TICKET_API_SECRET = process.env.TICKET_API_SECRET || UNBAN_API_SECRET || HEARTBEAT_SECRET || '';
const TICKETS_FILE = path.join(DATA_DIR, 'tickets.json');
const TICKET_ELIGIBILITY_FILE = path.join(DATA_DIR, 'ticket-eligibility.json');
const TICKET_ELIGIBILITY_LOOKUP_FILE = path.join(DATA_DIR, 'ticket-eligibility-requests.json');
const TICKET_DELETE_AFTER_DAYS = Number(process.env.TICKET_DELETE_AFTER_DAYS || 30);
const TICKET_UPLOAD_DIR = path.join(DATA_DIR, 'ticket-uploads');

const DASHBOARD_API_SECRET = process.env.DASHBOARD_API_SECRET || TICKET_API_SECRET || UNBAN_API_SECRET || HEARTBEAT_SECRET || '';
const DASHBOARD_GUILDS_FILE = path.join(DATA_DIR, 'dashboard-guilds.json');
const DASHBOARD_ACCESS_FILE = path.join(DATA_DIR, 'dashboard-access-cache.json');
const DASHBOARD_ACCESS_LOOKUP_FILE = path.join(DATA_DIR, 'dashboard-access-requests.json');
const DASHBOARD_VERIFY_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-verify-configs.json');
const DASHBOARD_VERIFY_ACTION_FILE = path.join(DATA_DIR, 'dashboard-verify-actions.json');
const DASHBOARD_GLOBALCHAT_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-globalchat-configs.json');
const DASHBOARD_GLOBALCHAT_ACTION_FILE = path.join(DATA_DIR, 'dashboard-globalchat-actions.json');
const DASHBOARD_MESSAGES_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-messages-configs.json');
const DASHBOARD_MESSAGES_ACTION_FILE = path.join(DATA_DIR, 'dashboard-messages-actions.json');
const DASHBOARD_TICKET_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-ticket-configs.json');
const DASHBOARD_TICKET_ACTION_FILE = path.join(DATA_DIR, 'dashboard-ticket-actions.json');
const DASHBOARD_MODERATION_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-moderation-configs.json');
const DASHBOARD_MODERATION_ACTION_FILE = path.join(DATA_DIR, 'dashboard-moderation-actions.json');
const DASHBOARD_FUN_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-fun-configs.json');
const DASHBOARD_FUN_ACTION_FILE = path.join(DATA_DIR, 'dashboard-fun-actions.json');
const DASHBOARD_COMMUNITY_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-community-configs.json');
const DASHBOARD_COMMUNITY_ACTION_FILE = path.join(DATA_DIR, 'dashboard-community-actions.json');
const DASHBOARD_SECURITY_CONFIG_FILE = path.join(DATA_DIR, 'dashboard-security-configs.json');
const DASHBOARD_SECURITY_ACTION_FILE = path.join(DATA_DIR, 'dashboard-security-actions.json');
fs.mkdirSync(TICKET_UPLOAD_DIR, { recursive: true });

const ticketUploadStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, TICKET_UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname || '').slice(0, 16).replace(/[^a-zA-Z0-9.]/g, '') || '.bin';
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});
const ticketUpload = multer({
  storage: ticketUploadStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }
});

let lastHeartbeat = loadHeartbeatFromDisk();
let discordOAuthBlockedUntil = 0;
try {
  // Alte gespeicherte Rate-Limit-Datei aus vorherigen Fixes entfernen.
  // Diese Datei konnte nach Logout/erneutem Login falsche Wartezeiten anzeigen.
  if (fs.existsSync(DISCORD_OAUTH_RATE_LIMIT_FILE)) fs.rmSync(DISCORD_OAUTH_RATE_LIMIT_FILE, { force: true });
} catch (error) {
  console.warn('Alte Discord OAuth Rate-Limit-Datei konnte nicht entfernt werden:', error.message);
}
const recentlyProcessedOAuthCodes = new Map();

function loadDiscordOAuthBlockedUntil() {
  try {
    const data = loadJson(DISCORD_OAUTH_RATE_LIMIT_FILE, { blockedUntil: 0 });
    const value = Number(data?.blockedUntil || 0);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveDiscordOAuthBlockedUntil(_value) {
  // Absichtlich kein Persistieren mehr. Discord OAuth-429 darf nicht dauerhaft in data/*.json
  // hängen bleiben, sonst sieht ein normaler Logout/Login später fälschlich wie Rate-Limit aus.
  try {
    if (fs.existsSync(DISCORD_OAUTH_RATE_LIMIT_FILE)) fs.rmSync(DISCORD_OAUTH_RATE_LIMIT_FILE, { force: true });
  } catch (error) {
    console.warn('Discord OAuth Rate-Limit-Datei konnte nicht bereinigt werden:', error.message);
  }
}

function rememberProcessedOAuthCode(code) {
  const key = crypto.createHash('sha256').update(String(code || '')).digest('hex');
  const expiresAt = Date.now() + 10 * 60 * 1000;
  recentlyProcessedOAuthCodes.set(key, expiresAt);
  for (const [storedKey, storedExpiresAt] of recentlyProcessedOAuthCodes.entries()) {
    if (storedExpiresAt <= Date.now()) recentlyProcessedOAuthCodes.delete(storedKey);
  }
  return key;
}

function hasProcessedOAuthCode(code) {
  const key = crypto.createHash('sha256').update(String(code || '')).digest('hex');
  const expiresAt = recentlyProcessedOAuthCodes.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    recentlyProcessedOAuthCodes.delete(key);
    return false;
  }
  return true;
}

function discordOAuthRateLimitMessage() {
  const waitSeconds = Math.max(1, Math.ceil((discordOAuthBlockedUntil - Date.now()) / 1000));
  const waitText = waitSeconds >= 60 ? `${Math.ceil(waitSeconds / 60)} Minute(n)` : `${waitSeconds} Sekunde(n)`;
  return `Discord Login wurde gerade kurz geschützt, damit kein Doppelklick/Callback-Refresh ausgelöst wird. Bitte warte ca. ${waitText} und versuche es dann erneut.`;
}

function discordOAuthSetRateLimit(response, bodyText = '') {
  let retryAfter = Number(response.headers.get('retry-after') || 0);
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
    try {
      const parsed = JSON.parse(bodyText || '{}');
      retryAfter = Number(parsed.retry_after || parsed.retryAfter || 0);
    } catch {}
  }
  if (!Number.isFinite(retryAfter) || retryAfter <= 0) retryAfter = DISCORD_OAUTH_FALLBACK_RETRY_SECONDS;
  retryAfter = Math.min(Math.max(retryAfter, 10), Math.max(10, DISCORD_OAUTH_MAX_LOCAL_BLOCK_SECONDS));
  discordOAuthBlockedUntil = Date.now() + retryAfter * 1000;
  saveDiscordOAuthBlockedUntil(discordOAuthBlockedUntil);
  return retryAfter;
}

app.set('trust proxy', 1);
app.use(cors());
// Dashboard sync can contain role/channel lists from multiple guilds.
// 128kb caused Render/Express to reject larger bots with HTTP 413.
app.use(express.json({ limit: process.env.BLUE_JSON_LIMIT || '8mb' }));
app.use(express.urlencoded({ extended: false, limit: process.env.BLUE_JSON_LIMIT || '8mb' }));
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
app.use('/ticket-uploads', express.static(TICKET_UPLOAD_DIR, {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
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

app.get('/updates', (_req, res) => {
  res.sendFile(path.join(__dirname, 'updates.html'));
});

// Eigene Dashboard-Serverseiten: /dashboard/123456789 oder /dashboard.123456789
// Dadurch landet ein Nutzer nach dem Klick auf einen Server direkt in der Modul-Ansicht.
app.get(/^\/dashboard(?:\/|\.)(\d+)\/?$/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'dashboard.html'));
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

function parseCookieHeader(req) {
  const raw = String(req.get('cookie') || '');
  const out = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function signRememberPayload(payload) {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyRememberToken(token) {
  try {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const given = Buffer.from(signature);
    const want = Buffer.from(expected);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || Number(payload.expiresAt || 0) <= Date.now()) return null;
    if (!payload.user || !payload.user.id) return null;
    return payload;
  } catch {
    return null;
  }
}

function rememberCookieOptions(req, maxAgeMs = DISCORD_RELOGIN_CACHE_MS) {
  const isSecure = String(req.get('x-forwarded-proto') || req.protocol || '').includes('https');
  return [
    `Max-Age=${Math.max(1, Math.floor(maxAgeMs / 1000))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isSecure ? 'Secure' : ''
  ].filter(Boolean).join('; ');
}

function setRememberLoginCookie(req, res) {
  if (!req.session?.discordUser) return;
  const payload = {
    user: req.session.discordUser,
    guilds: Array.isArray(req.session.discordGuilds) ? req.session.discordGuilds : [],
    createdAt: Date.now(),
    expiresAt: Date.now() + DISCORD_RELOGIN_CACHE_MS,
  };
  res.setHeader('Set-Cookie', `blue.remember=${encodeURIComponent(signRememberPayload(payload))}; ${rememberCookieOptions(req)}`);
}

function clearRememberLoginCookie(req, res) {
  const isSecure = String(req.get('x-forwarded-proto') || req.protocol || '').includes('https');
  res.setHeader('Set-Cookie', `blue.remember=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`);
}

function restoreRememberLogin(req) {
  if (req.session?.discordUser) return true;
  const token = parseCookieHeader(req)['blue.remember'];
  const payload = verifyRememberToken(token);
  if (!payload) return false;
  req.session.discordUser = payload.user;
  req.session.discordGuilds = Array.isArray(payload.guilds) ? payload.guilds : [];
  req.session.cachedDiscordUser = payload.user;
  req.session.cachedDiscordGuilds = req.session.discordGuilds;
  req.session.cachedDiscordUserAt = Date.now();
  req.session.loggedOutAt = null;
  delete req.session.oauthState;
  delete req.session.discordRedirectUri;
  delete req.session.oauthStartedAt;
  return true;
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
  const forwardedProto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${forwardedProto || 'https'}://${forwardedHost}`;
}

function discordRedirectUri(req) {
  const explicitRedirect = String(process.env.DISCORD_REDIRECT_URI || '').trim();
  return explicitRedirect || `${publicBaseUrl(req)}/auth/discord/callback`;
}

function requireUser(req, res, next) {
  if (!req.session.discordUser) restoreRememberLogin(req);
  if (!req.session.discordUser) return res.status(401).json({ ok: false, error: 'Nicht eingeloggt.' });
  return next();
}

function requireBot(req, res, next) {
  if (!UNBAN_API_SECRET) return res.status(500).json({ ok: false, error: 'UNBAN_API_SECRET oder BOT_HEARTBEAT_SECRET fehlt im Website-Service.' });
  if (readSecret(req, 'x-blue-unban-secret') !== UNBAN_API_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return next();
}


function requireTicketBot(req, res, next) {
  if (!TICKET_API_SECRET) return res.status(500).json({ ok: false, error: 'TICKET_API_SECRET, UNBAN_API_SECRET oder BOT_HEARTBEAT_SECRET fehlt im Website-Service.' });
  if (readSecret(req, 'x-blue-ticket-secret') !== TICKET_API_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  return next();
}

function requireDashboardBot(req, res, next) {
  if (!DASHBOARD_API_SECRET) return res.status(500).json({ ok: false, error: 'DASHBOARD_API_SECRET, TICKET_API_SECRET oder BOT_HEARTBEAT_SECRET fehlt im Website-Service.' });
  if (readSecret(req, 'x-blue-dashboard-secret') !== DASHBOARD_API_SECRET) return res.status(401).json({ ok: false, error: 'Unauthorized' });
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

  const returnTo = cleanReturnPath(req.query.return);

  const forceFreshOAuth = String(req.query.force || '') === '1';

  // Wenn die Session schon aktiv ist, niemals erneut Discord OAuth starten.
  if (req.session.discordUser) {
    return res.redirect(returnTo);
  }

  // Re-Login ohne Discord-Request: zuerst signierten Remember-Cookie wiederherstellen.
  // Das überlebt auch Render-Neustarts und verhindert OAuth-429 nach normalem Logout/Login.
  if (!forceFreshOAuth && restoreRememberLogin(req)) {
    return res.redirect(returnTo);
  }

  // Fallback innerhalb derselben Server-Session. Für Account-Wechsel: /auth/discord?force=1
  const cachedUser = req.session.cachedDiscordUser || null;
  const cachedAt = Number(req.session.cachedDiscordUserAt || 0);
  if (!forceFreshOAuth && cachedUser && cachedAt && Date.now() - cachedAt < DISCORD_RELOGIN_CACHE_MS) {
    req.session.discordUser = cachedUser;
    req.session.discordGuilds = Array.isArray(req.session.cachedDiscordGuilds) ? req.session.cachedDiscordGuilds : [];
    req.session.loggedOutAt = null;
    delete req.session.oauthState;
    delete req.session.discordRedirectUri;
    delete req.session.oauthStartedAt;
    return res.redirect(returnTo);
  }

  const now = Date.now();
  const sessionOAuthBlockedUntil = Number(req.session.oauthBlockedUntil || 0);
  if (sessionOAuthBlockedUntil && now < sessionOAuthBlockedUntil) {
    if (!forceFreshOAuth && restoreRememberLogin(req)) return res.redirect(returnTo);
    const waitSeconds = Math.max(1, Math.ceil((sessionOAuthBlockedUntil - now) / 1000));
    const waitText = waitSeconds >= 60 ? `${Math.ceil(waitSeconds / 60)} Minute(n)` : `${waitSeconds} Sekunde(n)`;
    return res.status(429).send(`Discord OAuth ist für diese Browser-Session kurz geschützt. Bitte warte ca. ${waitText} und versuche es danach erneut.`);
  }

  const lastStart = Number(req.session.oauthStartedAt || 0);
  if (lastStart && now - lastStart < DISCORD_OAUTH_MIN_RETRY_SECONDS * 1000) {
    return res.status(429).send('Discord Login wurde gerade erst gestartet. Bitte klicke nicht mehrfach auf Login.');
  }

  const state = crypto.randomUUID();
  req.session.oauthState = state;
  req.session.oauthStartedAt = now;
  req.session.returnTo = returnTo;

  const redirectUri = discordRedirectUri(req);
  req.session.discordRedirectUri = redirectUri;

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
  url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    const returnTo = req.session.returnTo || '/dashboard.html';

    // Wenn der Callback nach einem erfolgreichen Login refreshed wird, nicht nochmal Discord kontaktieren.
    if (req.session.discordUser) {
      return res.redirect(returnTo);
    }

    if (!req.query.code || req.query.state !== req.session.oauthState) {
      return res.status(400).send('Discord Login ungültig oder abgelaufen.');
    }

    const code = String(req.query.code);
    if (hasProcessedOAuthCode(code)) {
      return res.status(429).send('Dieser Discord Login-Code wurde bereits verarbeitet. Bitte öffne die Seite neu, statt den Callback zu aktualisieren.');
    }
    rememberProcessedOAuthCode(code);

    const redirectUri = req.session.discordRedirectUri || discordRedirectUri(req);

    // State direkt verbrauchen, damit derselbe Callback nicht mehrfach Token-Anfragen sendet.
    delete req.session.oauthState;

    const sessionOAuthBlockedUntil = Number(req.session.oauthBlockedUntil || 0);
    if (sessionOAuthBlockedUntil && Date.now() < sessionOAuthBlockedUntil) {
      // Nur diese Browser-Session wird kurz geschützt, niemals alle Website-User global.
      if (restoreRememberLogin(req)) return res.redirect(returnTo);
      const waitSeconds = Math.max(1, Math.ceil((sessionOAuthBlockedUntil - Date.now()) / 1000));
      const waitText = waitSeconds >= 60 ? `${Math.ceil(waitSeconds / 60)} Minute(n)` : `${waitSeconds} Sekunde(n)`;
      return res.status(429).send(`Discord OAuth ist für diese Browser-Session kurz geschützt. Bitte warte ca. ${waitText} und versuche es dann erneut.`);
    }

    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.warn('Discord OAuth Token Fehler:', {
        status: tokenResponse.status,
        redirectUri,
        retryAfter: tokenResponse.headers.get('retry-after') || null,
        body: text.slice(0, 500)
      });

      if (tokenResponse.status === 429) {
        let retryAfter = Number(tokenResponse.headers.get('retry-after') || 0);
        try {
          const parsed = JSON.parse(text || '{}');
          retryAfter = Number(parsed.retry_after || parsed.retryAfter || retryAfter || 0);
        } catch {}

        // Wenn ein gültiger Remember-Cookie existiert, loggen wir den User lokal ein
        // statt ihn wegen Discords temporärem Token-Limit auszusperren.
        if (restoreRememberLogin(req)) {
          return res.redirect(returnTo);
        }

        // Release-sicher: Kein globaler Block für alle Website-Besucher.
        // Nur die aktuelle Browser-Session wird geschützt, damit ein User Discord nicht weiter spammt.
        const sessionRetry = Math.min(Math.max(retryAfter || 60, 10), 60 * 60);
        req.session.oauthBlockedUntil = Date.now() + sessionRetry * 1000;
        const retryText = retryAfter ? ` Discord retry_after: ${Math.ceil(retryAfter)} Sekunde(n).` : '';
        return res.status(429).send(
          'Discord OAuth ist für diese Browser-Session gerade temporär limitiert.' + retryText +
          ' Andere User werden dadurch nicht lokal blockiert. Bitte nicht mehrfach klicken und später erneut versuchen.'
        );
      }

      return res.status(502).send(
        'Discord Login fehlgeschlagen. Prüfe in Render DISCORD_CLIENT_SECRET und DISCORD_REDIRECT_URI. ' +
        'Benutzte Redirect URL: ' + redirectUri
      );
    }

    // Erfolgreicher Token-Tausch = kein lokaler OAuth-Block mehr nötig.
    discordOAuthBlockedUntil = 0;
    delete req.session.oauthBlockedUntil;
    saveDiscordOAuthBlockedUntil(0);

    const token = await tokenResponse.json();
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });

    if (!userResponse.ok) return res.status(502).send('Discord User konnte nicht geladen werden.');
    const user = await userResponse.json();

    let guilds = [];
    try {
      const guildsResponse = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      if (guildsResponse.ok) guilds = await guildsResponse.json();
    } catch (guildError) {
      console.warn('Discord Guilds konnten nicht geladen werden:', guildError.message);
    }

    req.session.discordGuilds = Array.isArray(guilds) ? guilds.map((guild) => ({
      id: String(guild.id),
      name: guild.name,
      icon: guild.icon || null,
      owner: Boolean(guild.owner),
      permissions: String(guild.permissions || '0')
    })) : [];

    req.session.discordUser = {
      id: user.id,
      username: user.username,
      global_name: user.global_name || user.username,
      avatar: user.avatar || null,
      discriminator: user.discriminator || '0'
    };
    req.session.cachedDiscordUser = req.session.discordUser;
    req.session.cachedDiscordGuilds = req.session.discordGuilds;
    req.session.cachedDiscordUserAt = Date.now();
    req.session.loggedOutAt = null;
    delete req.session.oauthState;
    delete req.session.discordRedirectUri;
    delete req.session.oauthStartedAt;
    setRememberLoginCookie(req, res);
    res.redirect(cleanReturnPath(req.session.returnTo));
  } catch (error) {
    console.error('Discord Login Fehler:', error);
    res.status(500).send('Discord Login Fehler.');
  }
});

app.post('/auth/logout', (req, res) => {
  const fullLogout = req.query.full === '1' || req.body?.full === true || req.body?.full === '1';
  if (fullLogout) {
    clearRememberLoginCookie(req, res);
    return req.session.destroy(() => res.json({ ok: true, fullLogout: true }));
  }

  // Soft-Logout: Der User wirkt auf der Website ausgeloggt, aber ein signierter
  // HttpOnly-Remember-Cookie bleibt erhalten. Login danach fragt Discord nicht neu an.
  if (req.session.discordUser) {
    req.session.cachedDiscordUser = req.session.discordUser;
    req.session.cachedDiscordGuilds = req.session.discordGuilds || [];
    req.session.cachedDiscordUserAt = Date.now();
    setRememberLoginCookie(req, res);
  }
  delete req.session.discordUser;
  delete req.session.discordGuilds;
  delete req.session.oauthState;
  delete req.session.discordRedirectUri;
  delete req.session.oauthStartedAt;
  delete req.session.oauthBlockedUntil;
  req.session.loggedOutAt = Date.now();
  return res.json({ ok: true, softLogout: true });
});

app.get('/api/auth/me', (req, res) => {
  const rememberPayload = verifyRememberToken(parseCookieHeader(req)['blue.remember']);
  res.json({
    ok: true,
    loggedIn: Boolean(req.session.discordUser),
    user: req.session.discordUser || null,
    hasCachedLogin: Boolean(
      (req.session.cachedDiscordUser && Number(req.session.cachedDiscordUserAt || 0) && Date.now() - Number(req.session.cachedDiscordUserAt || 0) < DISCORD_RELOGIN_CACHE_MS)
      || rememberPayload
    )
  });
});


// ------------------------------------------------------------
// Blue Dashboard System
// ------------------------------------------------------------
function loadDashboardGuilds() {
  const data = loadJson(DASHBOARD_GUILDS_FILE, { guilds: {} });
  if (!data.guilds || typeof data.guilds !== 'object') data.guilds = {};
  return data;
}

function saveDashboardGuilds(data) {
  if (!data.guilds || typeof data.guilds !== 'object') data.guilds = {};
  saveJson(DASHBOARD_GUILDS_FILE, data);
}

function loadDashboardAccess() {
  const data = loadJson(DASHBOARD_ACCESS_FILE, { users: {} });
  if (!data.users || typeof data.users !== 'object') data.users = {};
  return data;
}

function saveDashboardAccess(data) {
  if (!data.users || typeof data.users !== 'object') data.users = {};
  saveJson(DASHBOARD_ACCESS_FILE, data);
}

function loadDashboardAccessRequests() {
  const data = loadJson(DASHBOARD_ACCESS_LOOKUP_FILE, { requests: {} });
  if (!data.requests || typeof data.requests !== 'object') data.requests = {};
  return data;
}

function saveDashboardAccessRequests(data) {
  if (!data.requests || typeof data.requests !== 'object') data.requests = {};
  saveJson(DASHBOARD_ACCESS_LOOKUP_FILE, data);
}

function loadDashboardVerifyConfigs() {
  const data = loadJson(DASHBOARD_VERIFY_CONFIG_FILE, { configs: {} });
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  return data;
}

function saveDashboardVerifyConfigs(data) {
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  saveJson(DASHBOARD_VERIFY_CONFIG_FILE, data);
}

function loadDashboardVerifyActions() {
  const data = loadJson(DASHBOARD_VERIFY_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardVerifyActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_VERIFY_ACTION_FILE, data);
}

function loadDashboardGlobalchatConfigs() {
  const data = loadJson(DASHBOARD_GLOBALCHAT_CONFIG_FILE, { configs: {} });
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  return data;
}

function saveDashboardGlobalchatConfigs(data) {
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  saveJson(DASHBOARD_GLOBALCHAT_CONFIG_FILE, data);
}

function loadDashboardGlobalchatActions() {
  const data = loadJson(DASHBOARD_GLOBALCHAT_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardGlobalchatActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_GLOBALCHAT_ACTION_FILE, data);
}


function loadDashboardMessagesConfigs() {
  const data = loadJson(DASHBOARD_MESSAGES_CONFIG_FILE, { guilds: {}, deletedMessageIds: {} });
  if (!data.guilds || typeof data.guilds !== 'object') data.guilds = {};
  if (!data.deletedMessageIds || typeof data.deletedMessageIds !== 'object') data.deletedMessageIds = {};
  return data;
}

function saveDashboardMessagesConfigs(data) {
  if (!data.guilds || typeof data.guilds !== 'object') data.guilds = {};
  if (!data.deletedMessageIds || typeof data.deletedMessageIds !== 'object') data.deletedMessageIds = {};
  saveJson(DASHBOARD_MESSAGES_CONFIG_FILE, data);
}

function dashboardMessageWasDeleted(data, guildId, messageId) {
  const deleted = data?.deletedMessageIds?.[String(guildId)];
  return Boolean(deleted && Object.prototype.hasOwnProperty.call(deleted, String(messageId)));
}

function dashboardMarkMessageDeleted(data, guildId, messageId) {
  data.deletedMessageIds ||= {};
  data.deletedMessageIds[String(guildId)] ||= {};
  data.deletedMessageIds[String(guildId)][String(messageId)] = new Date().toISOString();
}

function dashboardUnmarkMessageDeleted(data, guildId, messageId) {
  const deleted = data?.deletedMessageIds?.[String(guildId)];
  if (deleted) delete deleted[String(messageId)];
}

function loadDashboardMessagesActions() {
  const data = loadJson(DASHBOARD_MESSAGES_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardMessagesActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_MESSAGES_ACTION_FILE, data);
}

function loadDashboardTicketConfigs() {
  const data = loadJson(DASHBOARD_TICKET_CONFIG_FILE, { configs: {} });
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  return data;
}

function saveDashboardTicketConfigs(data) {
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  saveJson(DASHBOARD_TICKET_CONFIG_FILE, data);
}

function loadDashboardTicketActions() {
  const data = loadJson(DASHBOARD_TICKET_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardTicketActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_TICKET_ACTION_FILE, data);
}

function loadDashboardModerationConfigs() {
  const data = loadJson(DASHBOARD_MODERATION_CONFIG_FILE, { configs: {} });
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  return data;
}

function saveDashboardModerationConfigs(data) {
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  saveJson(DASHBOARD_MODERATION_CONFIG_FILE, data);
}

function loadDashboardModerationActions() {
  const data = loadJson(DASHBOARD_MODERATION_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardModerationActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_MODERATION_ACTION_FILE, data);
}



function loadDashboardSecurityConfigs() {
  const data = loadJson(DASHBOARD_SECURITY_CONFIG_FILE, { configs: {} });
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  return data;
}

function saveDashboardSecurityConfigs(data) {
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  saveJson(DASHBOARD_SECURITY_CONFIG_FILE, data);
}

function loadDashboardSecurityActions() {
  const data = loadJson(DASHBOARD_SECURITY_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardSecurityActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_SECURITY_ACTION_FILE, data);
}

const DASHBOARD_SECURITY_LANGUAGES = new Set(['de', 'en', 'tr', 'pl', 'fr', 'es', 'it', 'nl']);

function normalizeDashboardSecurityLanguage(value) {
  const lang = String(value || 'de').toLowerCase().replace(/[^a-z]/g, '').slice(0, 2);
  return DASHBOARD_SECURITY_LANGUAGES.has(lang) ? lang : 'de';
}

function dashboardPublicSecurityConfig(config) {
  if (!config || typeof config !== 'object') return null;
  const links = config.links || {};
  const language = config.language || config.languages || {};
  const unban = config.unban || config.unbanSystem || {};
  return {
    guildId: String(config.guildId || ''),
    links: {
      enabled: Boolean(links.enabled),
      ignoredRoleIds: Array.isArray(links.ignoredRoleIds || links.ignored_role_ids) ? (links.ignoredRoleIds || links.ignored_role_ids).map((id) => String(id || '').replace(/\D/g, '')).filter(Boolean) : [],
      ignoredChannelIds: Array.isArray(links.ignoredChannelIds || links.ignored_channel_ids) ? (links.ignoredChannelIds || links.ignored_channel_ids).map((id) => String(id || '').replace(/\D/g, '')).filter(Boolean) : [],
    },
    language: {
      enabled: Boolean(language.enabled),
      preferred: normalizeDashboardSecurityLanguage(language.preferred || language.preferredLanguage || language.language || 'de'),
      ignoredRoleIds: Array.isArray(language.ignoredRoleIds || language.ignored_role_ids) ? (language.ignoredRoleIds || language.ignored_role_ids).map((id) => String(id || '').replace(/\D/g, '')).filter(Boolean) : [],
      ignoredChannelIds: Array.isArray(language.ignoredChannelIds || language.ignored_channel_ids) ? (language.ignoredChannelIds || language.ignored_channel_ids).map((id) => String(id || '').replace(/\D/g, '')).filter(Boolean) : [],
    },
    unban: {
      enabled: Boolean(unban.enabled),
      logChannelId: String(unban.logChannelId || unban.log_channel_id || '').replace(/\D/g, ''),
      teamRoleIds: Array.isArray(unban.teamRoleIds || unban.team_role_ids) ? (unban.teamRoleIds || unban.team_role_ids).map((id) => String(id || '').replace(/\D/g, '')).filter(Boolean).slice(0, 5) : [],
    },
    status: config.status || 'saved',
    lastResult: config.lastResult || null,
    updatedAt: config.updatedAt || null,
  };
}

function publicUnbanSystems() {
  const guilds = loadDashboardGuilds().guilds || {};
  const securityConfigs = loadDashboardSecurityConfigs().configs || {};
  const systems = [
    {
      id: 'global',
      type: 'global',
      label: 'Blue Security Global Unban',
      description: 'Für einen Ban aus dem Blue Security Global-Ban-System.',
      always: true,
      banKey: 'global'
    },
    {
      id: 'globalchat',
      type: 'globalchat',
      label: 'Globalchat Unban',
      description: 'Für einen Ban aus dem normalen Blue Globalchat.',
      always: true,
      banKey: 'globalchat'
    }
  ];

  for (const [guildId, configRaw] of Object.entries(securityConfigs)) {
    const guildIdClean = String(guildId || '').replace(/\D/g, '');
    if (!guildIdClean || !configRaw || typeof configRaw !== 'object') continue;
    const config = dashboardPublicSecurityConfig(configRaw);
    if (!config?.unban?.enabled || !config.unban.logChannelId) continue;
    const guild = guilds[guildIdClean] || {};
    systems.push({
      id: `discord:${guildIdClean}`,
      type: 'discord',
      guildId: guildIdClean,
      label: `${guild.name || 'Discord Server'} Unban`,
      serverName: guild.name || 'Discord Server',
      description: `Für einen Ban auf ${guild.name || 'diesem Server'}.`,
      banKey: `discord:${guildIdClean}`
    });
  }

  return systems;
}

function findPublicUnbanSystem(type, guildId) {
  const typeClean = String(type || '').toLowerCase();
  if (typeClean === 'global' || typeClean === 'globalchat') return publicUnbanSystems().find((system) => system.type === typeClean) || null;
  if (typeClean !== 'discord') return null;
  const guildIdClean = String(guildId || '').replace(/\D/g, '');
  if (!guildIdClean) return null;
  return publicUnbanSystems().find((system) => system.type === 'discord' && String(system.guildId) === guildIdClean) || null;
}

function pendingKey(type, guildId) {
  return type === 'discord' && guildId ? `discord:${guildId}` : String(type || 'discord');
}

function applicationMatchesSystem(app, userId, type, guildId = null) {
  if (app.user?.id !== userId || !['pending', 'in_review'].includes(app.status) || app.type !== type) return false;
  if (type === 'discord') return String(app.guildId || '') === String(guildId || '');
  return true;
}

function loadDashboardFunConfigs() {
  const data = loadJson(DASHBOARD_FUN_CONFIG_FILE, { configs: {} });
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  return data;
}

function saveDashboardFunConfigs(data) {
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  saveJson(DASHBOARD_FUN_CONFIG_FILE, data);
}

function loadDashboardFunActions() {
  const data = loadJson(DASHBOARD_FUN_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardFunActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_FUN_ACTION_FILE, data);
}

function dashboardPublicFunConfig(config) {
  if (!config || typeof config !== 'object') return null;
  const counting = config.counting || {};
  const errate = config.errate || {};
  const anonym = config.anonym || {};
  return {
    guildId: String(config.guildId || ''),
    counting: {
      enabled: Boolean(counting.enabled),
      channelId: counting.channelId ? String(counting.channelId) : '',
      currentNumber: Number.isFinite(Number(counting.currentNumber)) ? Number(counting.currentNumber) : 1,
    },
    errate: {
      enabled: Boolean(errate.enabled),
      channelId: errate.channelId ? String(errate.channelId) : '',
    },
    anonym: {
      enabled: Boolean(anonym.enabled),
      channelId: anonym.channelId ? String(anonym.channelId) : '',
      logChannelId: anonym.logChannelId ? String(anonym.logChannelId) : '',
    },
    status: config.status || 'saved',
    lastResult: config.lastResult || null,
    updatedAt: config.updatedAt || null,
  };
}


function loadDashboardCommunityConfigs() {
  const data = loadJson(DASHBOARD_COMMUNITY_CONFIG_FILE, { configs: {} });
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  return data;
}

function saveDashboardCommunityConfigs(data) {
  if (!data.configs || typeof data.configs !== 'object') data.configs = {};
  saveJson(DASHBOARD_COMMUNITY_CONFIG_FILE, data);
}

function loadDashboardCommunityActions() {
  const data = loadJson(DASHBOARD_COMMUNITY_ACTION_FILE, { actions: [] });
  if (!Array.isArray(data.actions)) data.actions = [];
  return data;
}

function saveDashboardCommunityActions(data) {
  if (!Array.isArray(data.actions)) data.actions = [];
  saveJson(DASHBOARD_COMMUNITY_ACTION_FILE, data);
}

function dashboardPublicCommunityConfig(config) {
  if (!config || typeof config !== 'object') return null;
  const roleIds = Array.isArray(config.roleIds || config.roles)
    ? (config.roleIds || config.roles).map((roleId) => String(roleId || '').replace(/\D/g, '')).filter(Boolean).slice(0, 10)
    : [];
  return {
    guildId: String(config.guildId || config.guild_id || ''),
    teamlist: {
      enabled: Boolean(config.enabled ?? config.teamlist?.enabled ?? roleIds.length),
      channelId: String(config.channelId || config.channel_id || config.teamlist?.channelId || '').replace(/\D/g, ''),
      messageId: config.messageId || config.message_id || config.teamlist?.messageId || null,
      roleIds,
    },
    status: config.status || 'saved',
    lastResult: config.lastResult || null,
    updatedAt: config.updatedAt || config.updated_at || null,
  };
}

const DASHBOARD_MODERATION_COMMANDS = ['ban', 'unban', 'kick', 'mute', 'unmute', 'warn', 'unwarn', 'warnings'];

function dashboardPublicModerationConfig(config) {
  if (!config || typeof config !== 'object') return null;
  return {
    guildId: String(config.guildId || ''),
    logChannelId: config.logChannelId ? String(config.logChannelId) : '',
    rolePermissions: Array.isArray(config.rolePermissions) ? config.rolePermissions.map((entry) => ({
      roleId: String(entry.roleId || ''),
      commands: Array.isArray(entry.commands) ? entry.commands.filter((cmd) => DASHBOARD_MODERATION_COMMANDS.includes(String(cmd))).map(String) : []
    })).filter((entry) => entry.roleId && entry.commands.length) : [],
    status: config.status || 'saved',
    lastResult: config.lastResult || null,
    updatedAt: config.updatedAt || null,
  };
}

function dashboardPublicTicketConfig(config) {
  if (!config || typeof config !== 'object') return null;
  return {
    guildId: String(config.guildId || ''),
    panelChannelId: config.panelChannelId ? String(config.panelChannelId) : '',
    ticketCategoryId: config.ticketCategoryId ? String(config.ticketCategoryId) : '',
    logChannelId: config.logChannelId ? String(config.logChannelId) : '',
    categories: Array.isArray(config.categories) ? config.categories.map((category, index) => ({
      id: String(category.id || `cat_${index + 1}`),
      name: String(category.name || '').slice(0, 50),
      description: String(category.description || '').slice(0, 100),
      roleIds: Array.isArray(category.roleIds || category.role_ids) ? (category.roleIds || category.role_ids).map(String) : [],
    })).filter((category) => category.name) : [],
    panelMessageId: config.panelMessageId ? String(config.panelMessageId) : null,
    panelEmbed: config.panelEmbed || config.panel_embed || null,
    status: config.status || 'saved',
    lastResult: config.lastResult || null,
    updatedAt: config.updatedAt || null,
  };
}

function dashboardPublicMessage(message) {
  if (!message || typeof message !== 'object') return null;
  return {
    id: String(message.id || ''),
    guildId: String(message.guildId || ''),
    name: String(message.name || 'Message'),
    channelId: message.channelId ? String(message.channelId) : null,
    embed: message.embed || {},
    status: message.status || 'saved',
    lastResult: message.lastResult || null,
    discordMessageId: message.discordMessageId || null,
    updatedAt: message.updatedAt || null,
    createdAt: message.createdAt || null,
  };
}

function dashboardSanitizeText(value, maxLength = 1000) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function dashboardHasAdministratorPermission(guild) {
  if (!guild) return false;
  if (guild.owner) return true;
  try {
    const perms = BigInt(guild.permissions || '0');
    // Discord Permission Bit 8 = Administrator.
    // Manage Server reicht bewusst nicht aus, weil das Dashboard Server-Systeme verändert.
    return Boolean((perms & 8n) === 8n);
  } catch {
    return false;
  }
}

// Backwards-compatible alias for older route code.
function dashboardHasManagePermission(guild) {
  return dashboardHasAdministratorPermission(guild);
}

function dashboardUserGuilds(req) {
  return Array.isArray(req.session.discordGuilds) ? req.session.discordGuilds : [];
}

function dashboardCommonGuild(req, guildId) {
  const botGuild = loadDashboardGuilds().guilds[String(guildId)];
  const userGuild = dashboardUserGuilds(req).find((guild) => String(guild.id) === String(guildId));
  if (!botGuild) return null;

  // Wichtig: Wegen Remember-Login / Discord OAuth Cache kann die OAuth-Guildliste
  // zeitweise veraltet sein. Deshalb akzeptieren wir zusätzlich die Bot-bestätigte
  // Access-Cache-Prüfung als Quelle, wenn der Bot den User auf dem Server als
  // Administrator/Owner bestätigt hat.
  const access = dashboardAccessFor(req.session.discordUser?.id, guildId);
  const hasOAuthAdmin = userGuild && dashboardHasAdministratorPermission(userGuild);
  const hasBotConfirmedAdmin = Boolean(access.checked && access.canManage);

  if (!hasOAuthAdmin && !hasBotConfirmedAdmin) return null;
  return { botGuild, userGuild: userGuild || null };
}

function queueDashboardAccess(userId, guildId) {
  const requests = loadDashboardAccessRequests();
  const key = `${userId}:${guildId}`;
  requests.requests[key] = { userId: String(userId), guildId: String(guildId), requestedAt: new Date().toISOString() };
  saveDashboardAccessRequests(requests);
}

function dashboardAccessFor(userId, guildId) {
  const cache = loadDashboardAccess();
  return cache.users?.[String(userId)]?.[String(guildId)] || {
    checked: false,
    canManage: false,
    hasPremiumFooter: false,
    memberFound: null,
    member: null,
  };
}

function dashboardPublicGuildList(req) {
  const userId = String(req.session.discordUser?.id || '');
  const botGuilds = loadDashboardGuilds().guilds;
  const userGuilds = dashboardUserGuilds(req);
  const userGuildMap = new Map(userGuilds.map((guild) => [String(guild.id), guild]));
  const guildEntries = Object.entries(botGuilds || {});

  // Früher wurden nur OAuth-Guilds geprüft. Wenn Discord/Remember-Session eine alte
  // oder unvollständige Guildliste hatte, fehlten neue Server. Jetzt fragt die Website
  // den Bot für ALLE Bot-Server: "Ist dieser User dort Mitglied/Admin?"
  for (const [guildId] of guildEntries) {
    if (userId && guildId) queueDashboardAccess(userId, guildId);
  }

  let pendingChecks = 0;
  const guilds = [];

  for (const [guildId, botGuild] of guildEntries) {
    const userGuild = userGuildMap.get(String(guildId));
    const access = dashboardAccessFor(userId, guildId);
    const accessChecked = Boolean(access.checked);
    const botConfirmedMember = Boolean(access.memberFound || access.member);
    const isMember = Boolean(userGuild || botConfirmedMember);

    // Ohne OAuth-Treffer und ohne Bot-Bestätigung zeigen wir den Server nicht, damit
    // keine fremden Bot-Server geleakt werden. Der Bot prüft ihn aber im Hintergrund.
    if (!isMember) {
      if (!accessChecked) pendingChecks += 1;
      continue;
    }

    const hasAdmin = userGuild ? dashboardHasAdministratorPermission(userGuild) : Boolean(access.canManage);
    const available = Boolean(hasAdmin || (accessChecked && access.canManage));

    guilds.push({
      id: String(guildId),
      name: botGuild.name || userGuild?.name || 'Server',
      icon: botGuild.icon || userGuild?.icon || null,
      memberCount: botGuild.memberCount || 0,
      botAvatar: botGuild.botAvatar || null,
      owner: Boolean(userGuild?.owner || (accessChecked && access.canManage && String(botGuild.ownerId || '') === userId)),
      available,
      unavailableReason: available ? null : 'Nicht verfügbar - Administrator benötigt',
      access,
    });
  }

  guilds.sort((a, b) => Number(b.available) - Number(a.available) || String(a.name).localeCompare(String(b.name)));
  return { guilds, pendingChecks, totalBotGuilds: guildEntries.length };
}

app.get('/api/dashboard/me', requireUser, (req, res) => {
  const result = dashboardPublicGuildList(req);
  res.json({
    ok: true,
    user: req.session.discordUser,
    guilds: result.guilds,
    pendingChecks: result.pendingChecks,
    checkingServers: result.pendingChecks > 0,
    totalBotGuilds: result.totalBotGuilds,
  });
});

app.get('/api/dashboard/guild/:guildId', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });
  queueDashboardAccess(req.session.discordUser.id, guildId);
  const verifyConfigs = loadDashboardVerifyConfigs().configs;
  const globalchatConfigs = loadDashboardGlobalchatConfigs().configs;
  const messagesConfigs = loadDashboardMessagesConfigs().guilds;
  const ticketConfigs = loadDashboardTicketConfigs().configs;
  const moderationConfigs = loadDashboardModerationConfigs().configs;
  const funConfigs = loadDashboardFunConfigs().configs;
  const communityConfigs = loadDashboardCommunityConfigs().configs;
  const securityConfigs = loadDashboardSecurityConfigs().configs;
  res.json({
    ok: true,
    guild: common.botGuild,
    access: dashboardAccessFor(req.session.discordUser.id, guildId),
    verification: verifyConfigs[guildId] || null,
    globalchat: globalchatConfigs[guildId] || common.botGuild.globalchat || null,
    ticket: dashboardPublicTicketConfig(ticketConfigs[guildId] || common.botGuild.ticket || null),
    moderation: dashboardPublicModerationConfig(moderationConfigs[guildId] || common.botGuild.moderation || null),
    security: dashboardPublicSecurityConfig(securityConfigs[guildId] || common.botGuild.security || null),
    fun: dashboardPublicFunConfig(funConfigs[guildId] || common.botGuild.fun || null),
    community: dashboardPublicCommunityConfig(communityConfigs[guildId] || common.botGuild.community || null),
    messages: { messages: (messagesConfigs[guildId]?.messages || []).map(dashboardPublicMessage).filter(Boolean) }
  });
});






app.post('/api/dashboard/guild/:guildId/security', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const availableRoleIds = new Set((botGuild.roles || []).filter((role) => !role.default && !role.managed).map((role) => String(role.id)));
  const availableChannelIds = new Set((botGuild.channels || []).filter((channel) => ['text', 'news', 'forum'].includes(String(channel.type).toLowerCase())).map((channel) => String(channel.id)));
  const availableTextChannelIds = new Set((botGuild.channels || []).filter((channel) => ['text', 'news'].includes(String(channel.type).toLowerCase())).map((channel) => String(channel.id)));
  const links = req.body?.links || {};
  const language = req.body?.language || {};
  const unban = req.body?.unban || {};
  const ignoredRoleIds = Array.isArray(links.ignoredRoleIds) ? links.ignoredRoleIds.map((id) => String(id || '').replace(/\D/g, '')).filter((id) => id && availableRoleIds.has(id)) : [];
  const ignoredChannelIds = Array.isArray(links.ignoredChannelIds) ? links.ignoredChannelIds.map((id) => String(id || '').replace(/\D/g, '')).filter((id) => id && availableChannelIds.has(id)) : [];
  const languageIgnoredRoleIds = Array.isArray(language.ignoredRoleIds) ? language.ignoredRoleIds.map((id) => String(id || '').replace(/\D/g, '')).filter((id) => id && availableRoleIds.has(id)) : [];
  const languageIgnoredChannelIds = Array.isArray(language.ignoredChannelIds) ? language.ignoredChannelIds.map((id) => String(id || '').replace(/\D/g, '')).filter((id) => id && availableChannelIds.has(id)) : [];
  const unbanEnabled = Boolean(unban.enabled);
  const unbanLogChannelId = String(unban.logChannelId || '').replace(/\D/g, '');
  if (unbanEnabled && !availableTextChannelIds.has(unbanLogChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Textkanal für das Unban-System.' });
  const unbanTeamRoleIds = Array.isArray(unban.teamRoleIds) ? unban.teamRoleIds.map((id) => String(id || '').replace(/\D/g, '')).filter((id) => id && availableRoleIds.has(id)).slice(0, 5) : [];
  const config = {
    guildId,
    links: {
      enabled: Boolean(links.enabled),
      ignoredRoleIds: Array.from(new Set(ignoredRoleIds)),
      ignoredChannelIds: Array.from(new Set(ignoredChannelIds)),
    },
    language: {
      enabled: Boolean(language.enabled),
      preferred: normalizeDashboardSecurityLanguage(language.preferred),
      ignoredRoleIds: Array.from(new Set(languageIgnoredRoleIds)),
      ignoredChannelIds: Array.from(new Set(languageIgnoredChannelIds)),
    },
    unban: {
      enabled: unbanEnabled,
      logChannelId: unbanEnabled ? unbanLogChannelId : '',
      teamRoleIds: Array.from(new Set(unbanTeamRoleIds)).slice(0, 5),
    },
    updatedBy: { id: req.session.discordUser.id, username: req.session.discordUser.username },
    updatedAt: new Date().toISOString(),
    status: 'pending',
  };

  const configs = loadDashboardSecurityConfigs();
  configs.configs[guildId] = config;
  saveDashboardSecurityConfigs(configs);

  const actions = loadDashboardSecurityActions();
  actions.actions.push({
    id: crypto.randomUUID(),
    type: 'apply_security_setup',
    guildId,
    config,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  saveDashboardSecurityActions(actions);
  res.json({ ok: true, config: dashboardPublicSecurityConfig(config), message: 'Security-System wird vom Bot eingerichtet.' });
});

app.post('/api/dashboard/guild/:guildId/fun', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const availableChannelIds = new Set((botGuild.channels || []).filter((channel) => ['text', 'news'].includes(channel.type)).map((channel) => String(channel.id)));
  const body = req.body || {};

  function cleanChannel(value) {
    return String(value || '').replace(/\D/g, '');
  }

  const countingEnabled = Boolean(body.counting?.enabled ?? body.countingEnabled);
  const errateEnabled = Boolean(body.errate?.enabled ?? body.errateEnabled);
  const anonymEnabled = Boolean(body.anonym?.enabled ?? body.anonymEnabled);

  const countingChannelId = cleanChannel(body.counting?.channelId ?? body.countingChannelId);
  const errateChannelId = cleanChannel(body.errate?.channelId ?? body.errateChannelId);
  const anonymChannelId = cleanChannel(body.anonym?.channelId ?? body.anonymChannelId);
  const anonymLogChannelId = cleanChannel(body.anonym?.logChannelId ?? body.anonymLogChannelId);

  if (countingEnabled && !availableChannelIds.has(countingChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Counting-Kanal.' });
  if (errateEnabled && !availableChannelIds.has(errateChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Errate-Zahl-Kanal.' });
  if (anonymEnabled && !availableChannelIds.has(anonymChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Anonym-Chat-Kanal.' });
  if (anonymLogChannelId && !availableChannelIds.has(anonymLogChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Anonym-Log-Kanal oder lasse ihn leer.' });

  const config = {
    guildId,
    counting: { enabled: countingEnabled, channelId: countingEnabled ? countingChannelId : null },
    errate: { enabled: errateEnabled, channelId: errateEnabled ? errateChannelId : null },
    anonym: { enabled: anonymEnabled, channelId: anonymEnabled ? anonymChannelId : null, logChannelId: anonymEnabled && anonymLogChannelId ? anonymLogChannelId : null },
    updatedBy: req.session.discordUser,
    updatedAt: new Date().toISOString(),
    status: 'pending_apply',
  };

  const configs = loadDashboardFunConfigs();
  configs.configs[guildId] = config;
  saveDashboardFunConfigs(configs);

  const actions = loadDashboardFunActions();
  actions.actions.push({
    id: `fun_${Date.now()}_${crypto.randomUUID()}`,
    type: 'apply_fun_setup',
    guildId,
    config,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  saveDashboardFunActions(actions);

  res.json({ ok: true, config: dashboardPublicFunConfig(config) });
});


app.post('/api/dashboard/guild/:guildId/community', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const availableChannelIds = new Set((botGuild.channels || []).filter((channel) => ['text', 'news'].includes(channel.type)).map((channel) => String(channel.id)));
  const availableRoleIds = new Set((botGuild.roles || []).filter((role) => !role.managed && !role.default).map((role) => String(role.id)));
  const body = req.body || {};

  const channelId = String(body.channelId || body.teamlist?.channelId || '').replace(/\D/g, '');
  const enabled = Boolean(body.enabled ?? body.teamlist?.enabled ?? true);
  const roleIds = Array.from(new Set((Array.isArray(body.roleIds || body.roles || body.teamlist?.roleIds) ? (body.roleIds || body.roles || body.teamlist?.roleIds) : [])
    .map((roleId) => String(roleId || '').replace(/\D/g, ''))
    .filter((roleId) => availableRoleIds.has(roleId))))
    .slice(0, 10);

  if (enabled && !availableChannelIds.has(channelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Teamlist-Kanal.' });
  if (enabled && !roleIds.length) return res.status(400).json({ ok: false, error: 'Bitte wähle mindestens eine Team-Rolle für die Teamliste.' });

  const configs = loadDashboardCommunityConfigs();
  const oldConfig = configs.configs[guildId] || {};
  const now = new Date().toISOString();
  const config = {
    ...oldConfig,
    guildId,
    enabled,
    channelId: enabled ? channelId : null,
    roleIds: enabled ? roleIds : [],
    updatedBy: req.session.discordUser,
    updatedAt: now,
    status: 'pending_apply',
  };
  configs.configs[guildId] = config;
  saveDashboardCommunityConfigs(configs);

  const actions = loadDashboardCommunityActions();
  actions.actions.push({
    id: `community_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'apply_community_setup',
    guildId,
    config,
    status: 'pending',
    createdAt: now,
  });
  saveDashboardCommunityActions(actions);

  res.json({ ok: true, config: dashboardPublicCommunityConfig(config), message: 'Community-System wird vom Bot eingerichtet.' });
});

app.post('/api/dashboard/guild/:guildId/moderation', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const availableRoleIds = new Set((botGuild.roles || []).filter((role) => !role.managed && !role.default).map((role) => String(role.id)));
  const availableChannelIds = new Set((botGuild.channels || []).filter((channel) => ['text', 'news'].includes(channel.type)).map((channel) => String(channel.id)));
  const body = req.body || {};
  const logChannelId = String(body.logChannelId || '').replace(/\D/g, '');

  if (logChannelId && !availableChannelIds.has(logChannelId)) {
    return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Moderations-Log-Kanal.' });
  }

  const seenRoles = new Set();
  const rolePermissions = [];
  for (const raw of Array.isArray(body.rolePermissions) ? body.rolePermissions.slice(0, 5) : []) {
    const roleId = String(raw?.roleId || '').replace(/\D/g, '');
    if (!roleId || seenRoles.has(roleId) || !availableRoleIds.has(roleId)) continue;
    const commands = Array.from(new Set((Array.isArray(raw?.commands) ? raw.commands : []).map(String).filter((cmd) => DASHBOARD_MODERATION_COMMANDS.includes(cmd))));
    if (!commands.length) continue;
    rolePermissions.push({ roleId, commands });
    seenRoles.add(roleId);
  }

  const config = {
    guildId,
    logChannelId: logChannelId || null,
    rolePermissions,
    updatedBy: req.session.discordUser,
    updatedAt: new Date().toISOString(),
    status: 'pending_apply'
  };

  const configs = loadDashboardModerationConfigs();
  configs.configs[guildId] = config;
  saveDashboardModerationConfigs(configs);

  const actions = loadDashboardModerationActions();
  actions.actions.push({
    id: `moderation_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'apply_moderation_setup',
    guildId,
    config,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  saveDashboardModerationActions(actions);

  res.json({ ok: true, config: dashboardPublicModerationConfig(config), message: 'Moderation-System wird vom Bot eingerichtet.' });
});

app.post('/api/dashboard/guild/:guildId/ticket', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const textChannelIds = new Set((botGuild.channels || []).filter((channel) => ['text', 'news'].includes(channel.type)).map((channel) => String(channel.id)));
  const categoryChannelIds = new Set((botGuild.channels || []).filter((channel) => channel.type === 'category').map((channel) => String(channel.id)));
  const roleIds = new Set((botGuild.roles || []).filter((role) => !role.managed && !role.default).map((role) => String(role.id)));
  const body = req.body || {};

  const panelChannelId = String(body.panelChannelId || '').replace(/\D/g, '');
  const ticketCategoryId = String(body.ticketCategoryId || '').replace(/\D/g, '');
  const logChannelId = String(body.logChannelId || '').replace(/\D/g, '');

  if (!textChannelIds.has(panelChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Panel-Textkanal.' });
  if (!categoryChannelIds.has(ticketCategoryId)) return res.status(400).json({ ok: false, error: 'Bitte wähle eine gültige Discord-Kategorie für neue Ticket-Kanäle.' });
  if (!textChannelIds.has(logChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Ticket-Log-Kanal.' });

  const rawCategories = Array.isArray(body.categories) ? body.categories : [];
  const categories = [];
  rawCategories.slice(0, 5).forEach((category) => {
    const name = dashboardSanitizeText(category?.name, 50);
    const description = dashboardSanitizeText(category?.description, 100);
    if (!name) return;
    const categoryRoleIds = Array.isArray(category?.roleIds || category?.role_ids) ? (category.roleIds || category.role_ids) : [];
    const cleanedRoleIds = [...new Set(categoryRoleIds.map((roleId) => String(roleId || '').replace(/\D/g, '')).filter((roleId) => roleIds.has(roleId)))];
    categories.push({
      id: `cat_${categories.length + 1}`,
      name,
      description,
      roleIds: cleanedRoleIds,
    });
  });

  if (!categories.length) return res.status(400).json({ ok: false, error: 'Bitte erstelle mindestens eine Ticket-Kategorie.' });
  if (categories.some((category) => !category.roleIds.length)) return res.status(400).json({ ok: false, error: 'Jede Ticket-Kategorie braucht mindestens eine Team-Rolle.' });

  const rawPanelEmbed = body.panelEmbed && typeof body.panelEmbed === 'object' ? body.panelEmbed : null;
  const canEditTicketFooter = Boolean(access.hasPremiumFooter);
  const panelEmbed = rawPanelEmbed ? {
    author: dashboardSanitizeText(rawPanelEmbed.author, 256),
    authorImage: dashboardSanitizeText(rawPanelEmbed.authorImage || rawPanelEmbed.author_image, 400),
    title: dashboardSanitizeText(rawPanelEmbed.title, 256),
    description: dashboardSanitizeText(rawPanelEmbed.description, 1800),
    footer: canEditTicketFooter ? (dashboardSanitizeText(rawPanelEmbed.footer, 120) || 'Powered by Blue ⚡') : 'Powered by Blue ⚡'
  } : null;

  const configs = loadDashboardTicketConfigs();
  const oldConfig = configs.configs[guildId] || {};
  const now = new Date().toISOString();
  const config = {
    ...oldConfig,
    guildId,
    panelChannelId,
    ticketCategoryId,
    logChannelId,
    categories,
    panelEmbed,
    updatedBy: req.session.discordUser,
    updatedAt: now,
    status: 'pending_apply'
  };
  configs.configs[guildId] = config;
  saveDashboardTicketConfigs(configs);

  const actions = loadDashboardTicketActions();
  actions.actions.push({
    id: `ticket_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'apply_ticket_setup',
    guildId,
    config,
    status: 'pending',
    createdAt: now
  });
  saveDashboardTicketActions(actions);

  res.json({ ok: true, config: dashboardPublicTicketConfig(config), message: 'Ticket-System wird vom Bot eingerichtet und das Panel wird gesendet/aktualisiert.' });
});

app.post('/api/dashboard/guild/:guildId/messages', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const textChannels = (botGuild.channels || []).filter((channel) => ['text', 'news'].includes(channel.type));
  const availableChannelIds = new Set(textChannels.map((channel) => String(channel.id)));
  const body = req.body || {};
  const id = String(body.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const name = dashboardSanitizeText(body.name, 80);
  const channelId = String(body.channelId || '').replace(/\D/g, '');

  if (!name) return res.status(400).json({ ok: false, error: 'Bitte gib der Message einen Namen, z. B. Regeln oder Information.' });
  if (!availableChannelIds.has(channelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Textkanal.' });

  const canEditFooter = Boolean(access.hasPremiumFooter);
  const embed = {
    author: dashboardSanitizeText(body.embed?.author, 256),
    authorImage: dashboardSanitizeText(body.embed?.authorImage, 400),
    title: dashboardSanitizeText(body.embed?.title, 256),
    titleUrl: dashboardSanitizeText(body.embed?.titleUrl, 400),
    description: dashboardSanitizeText(body.embed?.description, 4000),
    image: dashboardSanitizeText(body.embed?.image, 400),
    thumbnail: dashboardSanitizeText(body.embed?.thumbnail, 400),
    color: /^#[0-9a-fA-F]{6}$/.test(String(body.embed?.color || '')) ? String(body.embed.color) : '#38bdf8',
    footer: canEditFooter ? (dashboardSanitizeText(body.embed?.footer, 2048) || 'Powered by Blue ⚡') : 'Powered by Blue ⚡'
  };

  if (!embed.title && !embed.description && !embed.image && !embed.thumbnail) {
    return res.status(400).json({ ok: false, error: 'Bitte fülle mindestens Titel, Beschreibung, Bild oder Thumbnail aus.' });
  }

  const data = loadDashboardMessagesConfigs();
  // Wenn ein Admin ein Template mit derselben ID bewusst erneut speichert, darf es wieder aktiv werden.
  dashboardUnmarkMessageDeleted(data, guildId, id);
  data.guilds[guildId] ||= { guildId, messages: [] };
  if (!Array.isArray(data.guilds[guildId].messages)) data.guilds[guildId].messages = [];

  const now = new Date().toISOString();
  let message = data.guilds[guildId].messages.find((item) => String(item.id) === id);
  if (!message) {
    message = { id, guildId, createdAt: now };
    data.guilds[guildId].messages.push(message);
  }
  Object.assign(message, {
    id,
    guildId,
    name,
    channelId,
    embed,
    canEditFooter,
    updatedBy: req.session.discordUser,
    updatedAt: now,
    status: 'pending_send'
  });
  saveDashboardMessagesConfigs(data);

  const actions = loadDashboardMessagesActions();
  actions.actions.push({
    id: `message_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'send_dashboard_message',
    guildId,
    messageId: id,
    config: message,
    status: 'pending',
    createdAt: now
  });
  saveDashboardMessagesActions(actions);

  res.json({ ok: true, message: dashboardPublicMessage(message), info: 'Message wird vom Bot gesendet.' });
});

app.delete('/api/dashboard/guild/:guildId/messages/:messageId', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const messageId = String(req.params.messageId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });
  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const data = loadDashboardMessagesConfigs();
  data.guilds[guildId] ||= { guildId, messages: [] };
  const guildData = data.guilds[guildId];
  if (!Array.isArray(guildData.messages)) guildData.messages = [];

  const before = guildData.messages.length;
  const removedMessage = guildData.messages.find((item) => String(item.id) === messageId) || null;
  guildData.messages = guildData.messages.filter((item) => String(item.id) !== messageId);
  dashboardMarkMessageDeleted(data, guildId, messageId);
  guildData.updatedAt = new Date().toISOString();
  saveDashboardMessagesConfigs(data);

  const actions = loadDashboardMessagesActions();
  actions.actions.push({
    id: `message_delete_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'delete_dashboard_message',
    guildId,
    messageId,
    config: removedMessage ? { id: messageId, guildId, channelId: removedMessage.channelId || null } : { id: messageId, guildId },
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  saveDashboardMessagesActions(actions);

  res.json({ ok: true, deleted: before !== guildData.messages.length, permanentlyHidden: true });
});

app.post('/api/dashboard/guild/:guildId/globalchat', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Administratorrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const availableChannelIds = new Set((botGuild.channels || []).filter((channel) => ['text', 'news'].includes(channel.type)).map((channel) => String(channel.id)));
  const body = req.body || {};
  const enabled = Boolean(body.enabled);
  const channelId = String(body.channelId || '').replace(/\D/g, '');

  if (enabled && !availableChannelIds.has(channelId)) {
    return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Textkanal für den Globalchat.' });
  }

  const config = {
    guildId,
    enabled,
    channelId: enabled ? channelId : null,
    updatedBy: req.session.discordUser,
    updatedAt: new Date().toISOString(),
    status: 'pending_apply'
  };

  const configs = loadDashboardGlobalchatConfigs();
  configs.configs[guildId] = config;
  saveDashboardGlobalchatConfigs(configs);

  const actions = loadDashboardGlobalchatActions();
  actions.actions.push({
    id: `globalchat_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'apply_globalchat_setup',
    guildId,
    config,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  saveDashboardGlobalchatActions(actions);
  res.json({ ok: true, config, message: enabled ? 'Globalchat wird vom Bot eingerichtet.' : 'Globalchat wird vom Bot deaktiviert.' });
});

app.post('/api/dashboard/guild/:guildId/verification', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });

  const access = dashboardAccessFor(req.session.discordUser.id, guildId);
  if (access.checked && access.canManage === false) return res.status(403).json({ ok: false, error: 'Der Bot konnte deine Verwaltungsrechte auf diesem Server nicht bestätigen.' });

  const botGuild = common.botGuild;
  const availableRoleIds = new Set((botGuild.roles || []).map((role) => String(role.id)));
  const availableChannelIds = new Set((botGuild.channels || []).map((channel) => String(channel.id)));
  const body = req.body || {};
  const mode = String(body.mode || 'manual') === 'auto' ? 'auto' : 'manual';
  const addRoleIds = Array.isArray(body.addRoleIds) ? body.addRoleIds.map(String).filter((id) => availableRoleIds.has(id)) : [];
  const removeRoleIds = Array.isArray(body.removeRoleIds) ? body.removeRoleIds.map(String).filter((id) => availableRoleIds.has(id)) : [];
  const channelId = String(body.channelId || '').replace(/\D/g, '');
  const logChannelId = String(body.logChannelId || '').replace(/\D/g, '');
  if (!addRoleIds.length) return res.status(400).json({ ok: false, error: 'Bitte wähle mindestens eine Rolle, die hinzugefügt werden soll.' });
  if (!availableChannelIds.has(channelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Textkanal für das Verify Panel.' });
  if (logChannelId && !availableChannelIds.has(logChannelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Textkanal für Verify Logs oder lasse das Feld leer.' });

  const canEditFooter = Boolean(access.hasPremiumFooter);
  const embed = {
    title: dashboardSanitizeText(body.embed?.title, 180) || '✅ Verifizierung erforderlich',
    description: dashboardSanitizeText(body.embed?.description, 1800) || 'Klicke auf den Button und verifiziere dich, um Zugriff auf den Server zu erhalten.',
    thumbnail: dashboardSanitizeText(body.embed?.thumbnail, 400),
    image: dashboardSanitizeText(body.embed?.image, 400),
    color: /^#[0-9a-fA-F]{6}$/.test(String(body.embed?.color || '')) ? String(body.embed.color) : '#22c55e',
    footer: canEditFooter ? (dashboardSanitizeText(body.embed?.footer, 120) || 'Powered by Blue ⚡') : 'Powered by Blue ⚡'
  };

  const minAccountAgeEnabled = Boolean(body.minAccountAgeEnabled);
  const minAccountAgeDays = Math.max(0, Math.min(3650, Number.parseInt(body.minAccountAgeDays, 10) || 0));

  const config = {
    guildId,
    mode,
    addRoleIds,
    removeRoleIds,
    channelId,
    logChannelId: logChannelId || null,
    minAccountAgeEnabled,
    minAccountAgeDays,
    embed,
    canEditFooter,
    updatedBy: req.session.discordUser,
    updatedAt: new Date().toISOString(),
    status: 'pending_send'
  };

  const configs = loadDashboardVerifyConfigs();
  configs.configs[guildId] = config;
  saveDashboardVerifyConfigs(configs);

  const actions = loadDashboardVerifyActions();
  actions.actions.push({
    id: `verify_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type: 'send_verification_panel',
    guildId,
    config,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
  saveDashboardVerifyActions(actions);
  res.json({ ok: true, config, message: 'Verify Panel wird vom Bot gesendet.' });
});

app.post('/api/dashboard/bot/guilds', requireDashboardBot, (req, res) => {
  const guilds = Array.isArray(req.body?.guilds) ? req.body.guilds : [];
  const data = loadDashboardGuilds();
  for (const guild of guilds) {
    if (!guild?.id) continue;
    data.guilds[String(guild.id)] = { ...guild, id: String(guild.id), updatedAt: new Date().toISOString() };
  }
  saveDashboardGuilds(data);
  res.json({ ok: true, count: guilds.length });
});

app.get('/api/dashboard/bot/access-requests', requireDashboardBot, (_req, res) => {
  const data = loadDashboardAccessRequests();
  const now = Date.now();
  const requests = Object.values(data.requests)
    .filter((item) => item?.userId && item?.guildId && now - Date.parse(item.requestedAt || 0) < 1000 * 60 * 60)
    .map((item) => ({ userId: String(item.userId), guildId: String(item.guildId), requestedAt: item.requestedAt }));
  res.json({ ok: true, requests });
});

app.post('/api/dashboard/bot/access-cache', requireDashboardBot, (req, res) => {
  const userId = String(req.body?.userId || '').replace(/\D/g, '');
  const guildId = String(req.body?.guildId || '').replace(/\D/g, '');
  if (!userId || !guildId) return res.status(400).json({ ok: false, error: 'userId oder guildId fehlt.' });
  const data = loadDashboardAccess();
  data.users[userId] ||= {};
  data.users[userId][guildId] = {
    checked: true,
    canManage: Boolean(req.body.canManage),
    hasPremiumFooter: Boolean(req.body.hasPremiumFooter),
    memberFound: Boolean(req.body.memberFound || req.body.member),
    member: req.body.member || null,
    updatedAt: new Date().toISOString()
  };
  saveDashboardAccess(data);
  const requests = loadDashboardAccessRequests();
  delete requests.requests[`${userId}:${guildId}`];
  saveDashboardAccessRequests(requests);
  res.json({ ok: true });
});






app.get('/api/dashboard/bot/community-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardCommunityActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/community-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardCommunityActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardCommunityActions(data);

  if (action.type === 'apply_community_setup' && action.guildId) {
    const configs = loadDashboardCommunityConfigs();
    if (configs.configs[action.guildId]) {
      configs.configs[action.guildId].status = action.status;
      configs.configs[action.guildId].lastResult = req.body;
      if (req.body.community) {
        configs.configs[action.guildId] = { ...configs.configs[action.guildId], ...req.body.community, status: action.status, lastResult: req.body };
      }
      configs.configs[action.guildId].messageId = req.body.messageId || configs.configs[action.guildId].messageId || null;
      configs.configs[action.guildId].updatedAt = new Date().toISOString();
      saveDashboardCommunityConfigs(configs);
    }
  }
  res.json({ ok: true });
});


app.get('/api/dashboard/bot/security-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardSecurityActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/security-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardSecurityActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardSecurityActions(data);

  if (action.type === 'apply_security_setup' && action.guildId) {
    const configs = loadDashboardSecurityConfigs();
    if (configs.configs[action.guildId]) {
      configs.configs[action.guildId].status = action.status;
      configs.configs[action.guildId].lastResult = req.body;
      if (req.body.security) configs.configs[action.guildId] = { ...configs.configs[action.guildId], ...req.body.security, status: action.status, lastResult: req.body };
      configs.configs[action.guildId].updatedAt = new Date().toISOString();
      saveDashboardSecurityConfigs(configs);
    }
  }
  res.json({ ok: true });
});

app.get('/api/dashboard/bot/fun-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardFunActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/fun-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardFunActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardFunActions(data);

  if (action.type === 'apply_fun_setup' && action.guildId) {
    const configs = loadDashboardFunConfigs();
    if (configs.configs[action.guildId]) {
      configs.configs[action.guildId].status = action.status;
      configs.configs[action.guildId].lastResult = req.body;
      if (req.body.fun) {
        configs.configs[action.guildId] = { ...configs.configs[action.guildId], ...req.body.fun, status: action.status, lastResult: req.body };
      }
      configs.configs[action.guildId].updatedAt = new Date().toISOString();
      saveDashboardFunConfigs(configs);
    }
  }
  res.json({ ok: true });
});

app.get('/api/dashboard/bot/moderation-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardModerationActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/moderation-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardModerationActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardModerationActions(data);

  if (action.type === 'apply_moderation_setup' && action.guildId) {
    const configs = loadDashboardModerationConfigs();
    if (configs.configs[action.guildId]) {
      configs.configs[action.guildId].status = action.status;
      configs.configs[action.guildId].lastResult = req.body;
      configs.configs[action.guildId].logChannelId = req.body.logChannelId || configs.configs[action.guildId].logChannelId || null;
      configs.configs[action.guildId].updatedAt = new Date().toISOString();
      saveDashboardModerationConfigs(configs);
    }
  }
  res.json({ ok: true });
});

app.get('/api/dashboard/bot/ticket-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardTicketActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/ticket-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardTicketActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardTicketActions(data);

  if (action.type === 'apply_ticket_setup' && action.guildId) {
    const configs = loadDashboardTicketConfigs();
    if (configs.configs[action.guildId]) {
      configs.configs[action.guildId].status = action.status;
      configs.configs[action.guildId].lastResult = req.body;
      configs.configs[action.guildId].panelMessageId = req.body.panelMessageId || configs.configs[action.guildId].panelMessageId || null;
      configs.configs[action.guildId].updatedAt = new Date().toISOString();
      saveDashboardTicketConfigs(configs);
    }
  }
  res.json({ ok: true });
});

app.get('/api/dashboard/bot/message-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardMessagesActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/message-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardMessagesActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardMessagesActions(data);

  if (action.type === 'send_dashboard_message' && action.guildId && action.messageId) {
    const configs = loadDashboardMessagesConfigs();
    const guildData = configs.guilds[action.guildId];
    const message = guildData?.messages?.find((item) => String(item.id) === String(action.messageId));
    if (message) {
      message.status = action.status;
      message.lastResult = req.body || {};
      message.discordMessageId = req.body.discordMessageId || message.discordMessageId || null;
      message.channelId = req.body.channelId || message.channelId;
      message.updatedAt = new Date().toISOString();
      saveDashboardMessagesConfigs(configs);
    }
  }
  res.json({ ok: true });
});

app.get('/api/dashboard/bot/globalchat-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardGlobalchatActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/globalchat-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardGlobalchatActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardGlobalchatActions(data);

  if (action.type === 'apply_globalchat_setup' && action.guildId) {
    const configs = loadDashboardGlobalchatConfigs();
    if (configs.configs[action.guildId]) {
      configs.configs[action.guildId].status = action.status;
      configs.configs[action.guildId].lastResult = req.body;
      configs.configs[action.guildId].channelId = req.body.channelId || configs.configs[action.guildId].channelId;
      configs.configs[action.guildId].updatedAt = new Date().toISOString();
      saveDashboardGlobalchatConfigs(configs);
    }
  }
  res.json({ ok: true });
});

app.get('/api/dashboard/bot/verify-actions', requireDashboardBot, (_req, res) => {
  const data = loadDashboardVerifyActions();
  const actions = data.actions.filter((action) => action.status === 'pending');
  res.json({ ok: true, actions });
});

app.post('/api/dashboard/bot/verify-action-result', requireDashboardBot, (req, res) => {
  const id = String(req.body?.id || '');
  const data = loadDashboardVerifyActions();
  const action = data.actions.find((item) => item.id === id);
  if (!action) return res.status(404).json({ ok: false, error: 'Action nicht gefunden.' });
  action.status = req.body?.ok ? 'done' : 'error';
  action.result = req.body || {};
  action.finishedAt = new Date().toISOString();
  saveDashboardVerifyActions(data);

  if (action.type === 'send_verification_panel' && action.guildId) {
    const configs = loadDashboardVerifyConfigs();
    if (configs.configs[action.guildId]) {
      configs.configs[action.guildId].status = action.status;
      configs.configs[action.guildId].messageId = req.body.messageId || configs.configs[action.guildId].messageId || null;
      configs.configs[action.guildId].channelId = req.body.channelId || configs.configs[action.guildId].channelId;
      configs.configs[action.guildId].lastResult = req.body;
      configs.configs[action.guildId].updatedAt = new Date().toISOString();
      saveDashboardVerifyConfigs(configs);
    }
  }
  res.json({ ok: true });
});


app.post('/api/dashboard/bot/saved-configs', requireDashboardBot, (req, res) => {
  const verifyConfigs = req.body?.verifyConfigs && typeof req.body.verifyConfigs === 'object' ? req.body.verifyConfigs : {};
  const globalchatConfigs = req.body?.globalchatConfigs && typeof req.body.globalchatConfigs === 'object' ? req.body.globalchatConfigs : {};
  const messagesConfigs = req.body?.messagesConfigs && typeof req.body.messagesConfigs === 'object' ? req.body.messagesConfigs : {};
  const ticketConfigs = req.body?.ticketConfigs && typeof req.body.ticketConfigs === 'object' ? req.body.ticketConfigs : {};
  const moderationConfigs = req.body?.moderationConfigs && typeof req.body.moderationConfigs === 'object' ? req.body.moderationConfigs : {};
  const funConfigs = req.body?.funConfigs && typeof req.body.funConfigs === 'object' ? req.body.funConfigs : {};
  const communityConfigs = req.body?.communityConfigs && typeof req.body.communityConfigs === 'object' ? req.body.communityConfigs : {};
  const securityConfigs = req.body?.securityConfigs && typeof req.body.securityConfigs === 'object' ? req.body.securityConfigs : {};

  let verifyCount = 0;
  let globalchatCount = 0;
  let messagesCount = 0;
  let ticketCount = 0;
  let moderationCount = 0;
  let funCount = 0;
  let communityCount = 0;
  let securityCount = 0;

  if (Object.keys(verifyConfigs).length) {
    const data = loadDashboardVerifyConfigs();
    for (const [guildIdRaw, configRaw] of Object.entries(verifyConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !configRaw || typeof configRaw !== 'object') continue;
      data.configs[guildId] = {
        ...(data.configs[guildId] || {}),
        ...configRaw,
        guildId,
        restoredFromBot: true,
        status: configRaw.status || data.configs[guildId]?.status || 'done',
        updatedAt: configRaw.updatedAt || data.configs[guildId]?.updatedAt || new Date().toISOString()
      };
      verifyCount += 1;
    }
    saveDashboardVerifyConfigs(data);
  }

  if (Object.keys(globalchatConfigs).length) {
    const data = loadDashboardGlobalchatConfigs();
    for (const [guildIdRaw, configRaw] of Object.entries(globalchatConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !configRaw || typeof configRaw !== 'object') continue;
      if (configRaw.enabled === false) {
        data.configs[guildId] = {
          ...(data.configs[guildId] || {}),
          guildId,
          enabled: false,
          channelId: null,
          restoredFromBot: true,
          status: configRaw.status || 'done',
          updatedAt: configRaw.updatedAt || new Date().toISOString()
        };
      } else {
        data.configs[guildId] = {
          ...(data.configs[guildId] || {}),
          ...configRaw,
          guildId,
          enabled: true,
          restoredFromBot: true,
          status: configRaw.status || data.configs[guildId]?.status || 'done',
          updatedAt: configRaw.updatedAt || data.configs[guildId]?.updatedAt || new Date().toISOString()
        };
      }
      globalchatCount += 1;
    }
    saveDashboardGlobalchatConfigs(data);
  }


  if (Object.keys(ticketConfigs).length) {
    const data = loadDashboardTicketConfigs();
    for (const [guildIdRaw, configRaw] of Object.entries(ticketConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !configRaw || typeof configRaw !== 'object') continue;
      data.configs[guildId] = {
        ...(data.configs[guildId] || {}),
        ...configRaw,
        guildId,
        restoredFromBot: true,
        status: configRaw.status || data.configs[guildId]?.status || 'done',
        updatedAt: configRaw.updatedAt || data.configs[guildId]?.updatedAt || new Date().toISOString()
      };
      ticketCount += 1;
    }
    saveDashboardTicketConfigs(data);
  }


  if (Object.keys(messagesConfigs).length) {
    const data = loadDashboardMessagesConfigs();
    for (const [guildIdRaw, guildRaw] of Object.entries(messagesConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !guildRaw || typeof guildRaw !== 'object') continue;
      const incomingMessages = Array.isArray(guildRaw.messages) ? guildRaw.messages : [];
      data.guilds[guildId] ||= { guildId, messages: [] };
      if (!Array.isArray(data.guilds[guildId].messages)) data.guilds[guildId].messages = [];

      const incomingDeleted = guildRaw.deletedMessageIds && typeof guildRaw.deletedMessageIds === 'object' ? guildRaw.deletedMessageIds : {};
      for (const deletedIdRaw of Object.keys(incomingDeleted)) {
        const deletedId = String(deletedIdRaw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        if (!deletedId) continue;
        dashboardMarkMessageDeleted(data, guildId, deletedId);
        data.guilds[guildId].messages = data.guilds[guildId].messages.filter((item) => String(item.id) !== deletedId);
      }

      for (const messageRaw of incomingMessages) {
        if (!messageRaw || typeof messageRaw !== 'object') continue;
        const id = String(messageRaw.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        if (!id) continue;
        // Gelöschte Templates dürfen durch den Bot-Backup-Sync nicht wieder auftauchen.
        if (dashboardMessageWasDeleted(data, guildId, id)) continue;
        let message = data.guilds[guildId].messages.find((item) => String(item.id) === id);
        if (!message) {
          message = { id, guildId, createdAt: messageRaw.createdAt || new Date().toISOString() };
          data.guilds[guildId].messages.push(message);
        }
        Object.assign(message, messageRaw, {
          id,
          guildId,
          restoredFromBot: true,
          status: messageRaw.status || message.status || 'done',
          updatedAt: messageRaw.updatedAt || message.updatedAt || new Date().toISOString()
        });
        messagesCount += 1;
      }
    }
    saveDashboardMessagesConfigs(data);
  }


  if (Object.keys(moderationConfigs).length) {
    const data = loadDashboardModerationConfigs();
    for (const [guildIdRaw, configRaw] of Object.entries(moderationConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !configRaw || typeof configRaw !== 'object') continue;
      data.configs[guildId] = {
        ...(data.configs[guildId] || {}),
        ...configRaw,
        guildId,
        restoredFromBot: true,
        status: configRaw.status || data.configs[guildId]?.status || 'done',
        updatedAt: configRaw.updatedAt || data.configs[guildId]?.updatedAt || new Date().toISOString()
      };
      moderationCount += 1;
    }
    saveDashboardModerationConfigs(data);
  }


  if (Object.keys(funConfigs).length) {
    const data = loadDashboardFunConfigs();
    for (const [guildIdRaw, configRaw] of Object.entries(funConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !configRaw || typeof configRaw !== 'object') continue;
      data.configs[guildId] = {
        ...(data.configs[guildId] || {}),
        ...configRaw,
        guildId,
        restoredFromBot: true,
        status: configRaw.status || data.configs[guildId]?.status || 'done',
        updatedAt: configRaw.updatedAt || data.configs[guildId]?.updatedAt || new Date().toISOString(),
      };
      funCount += 1;
    }
    saveDashboardFunConfigs(data);
  }



  if (Object.keys(communityConfigs).length) {
    const data = loadDashboardCommunityConfigs();
    for (const [guildIdRaw, configRaw] of Object.entries(communityConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !configRaw || typeof configRaw !== 'object') continue;
      data.configs[guildId] = {
        ...(data.configs[guildId] || {}),
        ...configRaw,
        guildId,
        restoredFromBot: true,
        status: configRaw.status || data.configs[guildId]?.status || 'done',
        updatedAt: configRaw.updatedAt || data.configs[guildId]?.updatedAt || new Date().toISOString(),
      };
      communityCount += 1;
    }
    saveDashboardCommunityConfigs(data);
  }



  if (Object.keys(securityConfigs).length) {
    const data = loadDashboardSecurityConfigs();
    for (const [guildIdRaw, configRaw] of Object.entries(securityConfigs)) {
      const guildId = String(guildIdRaw || '').replace(/\D/g, '');
      if (!guildId || !configRaw || typeof configRaw !== 'object') continue;
      data.configs[guildId] = {
        ...(data.configs[guildId] || {}),
        ...configRaw,
        guildId,
        restoredFromBot: true,
        status: configRaw.status || data.configs[guildId]?.status || 'done',
        updatedAt: configRaw.updatedAt || data.configs[guildId]?.updatedAt || new Date().toISOString(),
      };
      securityCount += 1;
    }
    saveDashboardSecurityConfigs(data);
  }

  res.json({ ok: true, verifyCount, globalchatCount, messagesCount, ticketCount, moderationCount, funCount, communityCount, securityCount });
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

function getPendingForUser(applications, userId, type, guildId = null) {
  return applications.find((app) => applicationMatchesSystem(app, userId, type, guildId));
}

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/\r/g, '').trim().slice(0, maxLength);
}

function userBanCache(userId) {
  const cache = loadBanCache();
  return cache.users[String(userId)] || {
    discord: { checked: false, banned: false, reason: 'Noch nicht vom Bot geprüft.', duration: 'Unbekannt', until: null },
    discordServers: {},
    global: { checked: false, banned: false, reason: 'Noch nicht vom Bot geprüft.', duration: 'Unbekannt', until: null },
    globalchat: { checked: false, banned: false, reason: 'Noch nicht vom Bot geprüft.', duration: 'Unbekannt', until: null }
  };
}

app.get('/api/unban/systems', (_req, res) => {
  res.json({ ok: true, systems: publicUnbanSystems() });
});

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
  const systems = publicUnbanSystems();
  const pending = {
    global: getPendingForUser(applications, user.id, 'global') || null,
    globalchat: getPendingForUser(applications, user.id, 'globalchat') || null,
    discord: null,
    discordServers: {},
    byKey: {}
  };
  for (const system of systems) {
    const found = getPendingForUser(applications, user.id, system.type, system.guildId || null) || null;
    if (found) pending.byKey[pendingKey(system.type, system.guildId)] = found;
    if (system.type === 'discord' && system.guildId) pending.discordServers[system.guildId] = found;
  }
  pending.discord = getPendingForUser(applications, user.id, 'discord', null) || null;
  const history = applications
    .filter((app) => app.user?.id === user.id)
    .sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)))
    .slice(0, 10);
  res.json({ ok: true, user, banInfo: userBanCache(user.id), pending, history, systems });
});

app.post('/api/unban/apply', requireUser, (req, res) => {
  const user = req.session.discordUser;
  const type = String(req.body?.type || '').toLowerCase();
  if (!['discord', 'global', 'globalchat'].includes(type)) return res.status(400).json({ ok: false, error: 'Ungültiger Antrag-Typ.' });
  const guildId = type === 'discord' ? String(req.body?.guildId || '').replace(/\D/g, '') : '';
  const selectedSystem = findPublicUnbanSystem(type, guildId);
  if (!selectedSystem) return res.status(400).json({ ok: false, error: 'Dieses Unban-System ist aktuell nicht aktiviert.' });

  const bannedAt = sanitizeText(req.body.bannedAt, 120);
  const banReason = sanitizeText(req.body.banReason, 1000);
  const whyUnban = sanitizeText(req.body.whyUnban, 1600);
  const notifyDm = Boolean(req.body.notifyDm);

  if (!bannedAt || !banReason || !whyUnban) {
    return res.status(400).json({ ok: false, error: 'Bitte fülle alle Pflichtfelder aus.' });
  }

  const data = loadApplications();
  const existing = getPendingForUser(data.applications, user.id, type, guildId || null);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'Du hast bereits einen Antrag in Bearbeitung.', application: existing });
  }

  const cache = userBanCache(user.id);
  const banInfo = type === 'discord' && guildId ? (cache?.discordServers || {})[guildId] : (cache?.[type] || null);
  if (!banInfo?.checked) {
    const lookup = loadLookupRequests();
    lookup.requests[user.id] = { userId: user.id, requestedAt: new Date().toISOString() };
    saveLookupRequests(lookup);
    return res.status(409).json({ ok: false, error: 'Dein Ban-Status wird noch vom Bot geprüft. Bitte warte kurz und versuche es erneut.' });
  }
  if (!banInfo?.banned) {
    const errorText = type === 'global'
      ? 'Für dich wurde kein aktiver Blue Security Global-Ban gefunden. Ein Antrag ist deshalb nicht möglich.'
      : (type === 'globalchat'
        ? 'Für dich wurde kein aktiver Globalchat-Ban gefunden. Ein Antrag ist deshalb nicht möglich.'
        : 'Für dich wurde kein aktiver Discord-Ban gefunden. Ein Antrag ist deshalb nicht möglich.');
    return res.status(403).json({ ok: false, error: errorText });
  }

  const application = {
    id: `unban_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type,
    guildId: guildId || null,
    guildName: selectedSystem.serverName || selectedSystem.label || null,
    user,
    answers: { bannedAt, banReason, whyUnban },
    notifyDm,
    knownBanInfo: banInfo || null,
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
    discordServers: req.body.discordServers && typeof req.body.discordServers === 'object' ? req.body.discordServers : {},
    global: req.body.global || { checked: true, banned: false, reason: 'Kein Blue Security Global-Ban gefunden.', duration: 'Nicht gebannt', until: null },
    globalchat: req.body.globalchat || { checked: true, banned: false, reason: 'Kein Globalchat-Ban gefunden.', duration: 'Nicht gebannt', until: null },
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


// ------------------------------------------------------------
// Blue Website Ticket Support API
// ------------------------------------------------------------
function loadTickets() {
  const data = loadJson(TICKETS_FILE, { tickets: [] });
  if (!Array.isArray(data.tickets)) data.tickets = [];
  return data;
}

function saveTickets(data) {
  if (!Array.isArray(data.tickets)) data.tickets = [];
  saveJson(TICKETS_FILE, data);
}

function ticketTypeName(type) {
  return type === 'head' ? 'Leitung' : 'Allgemeiner Support';
}

function ticketPrefix(type) {
  return type === 'head' ? 'head' : 'general';
}

function ticketDeleteAtFromNow() {
  return new Date(Date.now() + Math.max(1, TICKET_DELETE_AFTER_DAYS) * 24 * 60 * 60 * 1000).toISOString();
}

function loadTicketEligibility() {
  const data = loadJson(TICKET_ELIGIBILITY_FILE, { users: {} });
  if (!data.users || typeof data.users !== 'object') data.users = {};
  return data;
}

function saveTicketEligibility(data) {
  if (!data.users || typeof data.users !== 'object') data.users = {};
  saveJson(TICKET_ELIGIBILITY_FILE, data);
}

function loadTicketEligibilityRequests() {
  const data = loadJson(TICKET_ELIGIBILITY_LOOKUP_FILE, { requests: [] });
  if (!Array.isArray(data.requests)) data.requests = [];
  return data;
}

function saveTicketEligibilityRequests(data) {
  if (!Array.isArray(data.requests)) data.requests = [];
  saveJson(TICKET_ELIGIBILITY_LOOKUP_FILE, data);
}

function queueTicketEligibilityCheck(user) {
  if (!user?.id) return;
  const data = loadTicketEligibilityRequests();
  const now = Date.now();
  const existing = data.requests.find((item) => item.user?.id === user.id && !item.done);
  if (existing) {
    existing.updatedAt = new Date().toISOString();
    existing.lastRequestedAt = now;
  } else {
    data.requests.push({
      id: `ticket_access_${now}_${crypto.randomUUID().slice(0, 8)}`,
      user,
      done: false,
      createdAt: new Date().toISOString(),
      lastRequestedAt: now
    });
  }
  saveTicketEligibilityRequests(data);
}

function getTicketAccessForUser(user) {
  if (!user?.id) return { ready: false, hasPremium: false, message: 'Bitte melde dich mit Discord an.' };

  // Ticket Support ist für alle eingeloggten Discord-User freigeschaltet.
  // Die alte Eligibility/Premium-Prüfung bleibt nur für Abwärtskompatibilität der Bot-API bestehen.
  return {
    ready: true,
    hasPremium: true,
    memberFound: true,
    highestRank: null,
    checkedAt: new Date().toISOString(),
    checking: false,
    nextCheckInSeconds: 0,
    message: 'Ticket Support ist für alle User freigeschaltet.'
  };
}

function findTicketById(data, ticketId) {
  return data.tickets.find((ticket) => ticket.id === ticketId);
}

function userCanAccessTicket(req, ticket) {
  return Boolean(req.session.discordUser && ticket?.user?.id === req.session.discordUser.id);
}

function publicTicket(ticket) {
  return {
    id: ticket.id,
    type: ticket.type,
    typeName: ticketTypeName(ticket.type),
    reason: ticket.reason,
    status: ticket.status,
    channelId: ticket.channelId || null,
    channelName: ticket.channelName || null,
    claimedBy: ticket.claimedBy || null,
    createdAt: ticket.createdAt,
    closedAt: ticket.closedAt || null,
    deleteAt: ticket.deleteAt || null,
    messages: Array.isArray(ticket.messages) ? ticket.messages : []
  };
}

function mapTicketFiles(req, files) {
  return (files || []).map((file) => ({
    id: `file_${crypto.randomUUID().slice(0, 10)}`,
    originalName: sanitizeText(file.originalname || 'Datei', 160),
    fileName: file.filename,
    mimeType: file.mimetype || 'application/octet-stream',
    size: file.size || 0,
    url: `${publicBaseUrl(req)}/ticket-uploads/${encodeURIComponent(file.filename)}`
  }));
}

function addTicketMessage(ticket, message) {
  if (!Array.isArray(ticket.messages)) ticket.messages = [];
  const item = {
    id: message.id || `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    authorType: message.authorType || 'system',
    author: message.author || null,
    text: sanitizeText(message.text, 2000),
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    sentToDiscord: Boolean(message.sentToDiscord),
    discordMessageId: message.discordMessageId || null,
    createdAt: message.createdAt || new Date().toISOString()
  };
  ticket.messages.push(item);
  return item;
}

app.get('/api/tickets/me', requireUser, (req, res) => {
  const data = loadTickets();
  const tickets = data.tickets
    .filter((ticket) => ticket.user?.id === req.session.discordUser.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .map(publicTicket);
  const ticketAccess = getTicketAccessForUser(req.session.discordUser);
  res.json({ ok: true, user: req.session.discordUser, ticketAccess, tickets });
});

app.post('/api/tickets/create', requireUser, (req, res) => {
  const type = String(req.body?.type || '').toLowerCase();
  if (!['general', 'head'].includes(type)) return res.status(400).json({ ok: false, error: 'Ungültige Ticket-Kategorie.' });

  const reason = sanitizeText(req.body.reason, 1200);
  if (!reason) return res.status(400).json({ ok: false, error: 'Bitte gib einen Grund an.' });

  const data = loadTickets();
  const openTicket = data.tickets.find((ticket) => ticket.user?.id === req.session.discordUser.id && ticket.status !== 'closed');
  if (openTicket) {
    return res.status(409).json({ ok: false, error: 'Du hast bereits ein offenes Ticket.', ticket: publicTicket(openTicket) });
  }

  const ticket = {
    id: `ticket_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    type,
    user: req.session.discordUser,
    reason,
    status: 'pending_channel',
    channelId: null,
    channelName: null,
    claimedBy: null,
    createdAt: new Date().toISOString(),
    closedAt: null,
    deleteAt: null,
    messages: []
  };

  addTicketMessage(ticket, {
    authorType: 'system',
    text: `Ticket erstellt: ${ticketTypeName(type)}. Der Bot erstellt gleich den Discord-Kanal.`,
    sentToDiscord: true
  });
  addTicketMessage(ticket, {
    authorType: 'user',
    author: req.session.discordUser,
    text: reason,
    sentToDiscord: false
  });

  data.tickets.push(ticket);
  saveTickets(data);
  res.json({ ok: true, ticket: publicTicket(ticket) });
});

app.get('/api/tickets/:ticketId', requireUser, (req, res) => {
  const data = loadTickets();
  const ticket = findTicketById(data, req.params.ticketId);
  if (!ticket || !userCanAccessTicket(req, ticket)) return res.status(404).json({ ok: false, error: 'Ticket nicht gefunden.' });
  res.json({ ok: true, ticket: publicTicket(ticket) });
});

app.post('/api/tickets/:ticketId/messages', requireUser, ticketUpload.array('files', 5), (req, res) => {
  const data = loadTickets();
  const ticket = findTicketById(data, req.params.ticketId);
  if (!ticket || !userCanAccessTicket(req, ticket)) return res.status(404).json({ ok: false, error: 'Ticket nicht gefunden.' });
  if (ticket.status === 'closed') return res.status(409).json({ ok: false, error: 'Dieses Ticket ist geschlossen.' });

  const text = sanitizeText(req.body.message, 2000);
  const attachments = mapTicketFiles(req, req.files);
  if (!text && !attachments.length) return res.status(400).json({ ok: false, error: 'Bitte schreibe eine Nachricht oder hänge eine Datei an.' });

  const message = addTicketMessage(ticket, {
    authorType: 'user',
    author: req.session.discordUser,
    text,
    attachments,
    sentToDiscord: false
  });
  saveTickets(data);
  res.json({ ok: true, message, ticket: publicTicket(ticket) });
});

app.get('/api/tickets/bot/pending', requireTicketBot, (_req, res) => {
  const data = loadTickets();
  const tickets = data.tickets
    .filter((ticket) => ticket.status !== 'closed')
    .map((ticket) => ({
      ...ticket,
      typeName: ticketTypeName(ticket.type),
      channelPrefix: ticketPrefix(ticket.type),
      unsentUserMessages: (ticket.messages || []).filter((msg) => msg.authorType === 'user' && !msg.sentToDiscord)
    }))
    .filter((ticket) => ticket.status === 'pending_channel' || ticket.unsentUserMessages.length);
  res.json({ ok: true, tickets });
});

app.post('/api/tickets/bot/channel-created', requireTicketBot, (req, res) => {
  const data = loadTickets();
  const ticket = findTicketById(data, String(req.body?.ticketId || ''));
  if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket nicht gefunden.' });
  ticket.status = 'open';
  ticket.channelId = String(req.body.channelId || '');
  ticket.channelName = String(req.body.channelName || '');
  ticket.panelMessageId = String(req.body.panelMessageId || '');
  addTicketMessage(ticket, {
    authorType: 'system',
    text: `Dein Ticket-Kanal wurde erstellt: #${ticket.channelName || ticket.channelId}. Das Team kann dir jetzt antworten.`,
    sentToDiscord: true
  });
  saveTickets(data);
  res.json({ ok: true });
});

app.post('/api/tickets/bot/message-sent', requireTicketBot, (req, res) => {
  const data = loadTickets();
  const ticket = findTicketById(data, String(req.body?.ticketId || ''));
  if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket nicht gefunden.' });
  const ids = Array.isArray(req.body.messageIds) ? req.body.messageIds.map(String) : [String(req.body.messageId || '')];
  for (const message of ticket.messages || []) {
    if (ids.includes(message.id)) {
      message.sentToDiscord = true;
      message.discordMessageId = String(req.body.discordMessageId || message.discordMessageId || '');
    }
  }
  saveTickets(data);
  res.json({ ok: true });
});

app.post('/api/tickets/bot/staff-message', requireTicketBot, (req, res) => {
  const data = loadTickets();
  const ticket = findTicketById(data, String(req.body?.ticketId || ''));
  if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket nicht gefunden.' });
  if (ticket.status === 'closed' && req.body.authorType !== 'system') return res.status(409).json({ ok: false, error: 'Ticket ist geschlossen.' });
  const message = addTicketMessage(ticket, {
    authorType: req.body.authorType === 'system' ? 'system' : 'staff',
    author: req.body.author || null,
    text: req.body.text || '',
    attachments: Array.isArray(req.body.attachments) ? req.body.attachments : [],
    sentToDiscord: true,
    discordMessageId: String(req.body.discordMessageId || '')
  });
  saveTickets(data);
  res.json({ ok: true, message });
});

app.post('/api/tickets/bot/claim', requireTicketBot, (req, res) => {
  const data = loadTickets();
  const ticket = findTicketById(data, String(req.body?.ticketId || ''));
  if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket nicht gefunden.' });
  const claimed = Boolean(req.body.claimed);
  ticket.claimedBy = claimed ? (req.body.staff || null) : null;
  addTicketMessage(ticket, {
    authorType: 'system',
    text: claimed
      ? `${req.body.staff?.name || 'Ein Teammitglied'} hat dein Ticket beansprucht und kümmert sich nun um dich.`
      : `${req.body.staff?.name || 'Ein Teammitglied'} hat das Ticket wieder freigegeben.`,
    sentToDiscord: true
  });
  saveTickets(data);
  res.json({ ok: true });
});

app.post('/api/tickets/bot/closed', requireTicketBot, (req, res) => {
  const data = loadTickets();
  const ticket = findTicketById(data, String(req.body?.ticketId || ''));
  if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket nicht gefunden.' });
  ticket.status = 'closed';
  ticket.closedAt = new Date().toISOString();
  ticket.deleteAt = req.body.deleteAt || ticketDeleteAtFromNow();
  ticket.closedChannelId = String(req.body.closedChannelId || ticket.channelId || '');
  addTicketMessage(ticket, {
    authorType: 'system',
    text: `${req.body.staff?.name || 'Ein Teammitglied'} hat dein Ticket geschlossen.`,
    sentToDiscord: true
  });
  saveTickets(data);
  res.json({ ok: true });
});

app.get('/api/tickets/bot/eligibility-requests', requireTicketBot, (_req, res) => {
  const data = loadTicketEligibilityRequests();
  const pending = [];
  const seen = new Set();
  for (const request of data.requests) {
    if (request.done || !request.user?.id || seen.has(String(request.user.id))) continue;
    seen.add(String(request.user.id));
    pending.push(request);
  }
  res.json({ ok: true, requests: pending.slice(0, 50) });
});

app.post('/api/tickets/bot/eligibility-status', requireTicketBot, (req, res) => {
  const userId = String(req.body?.userId || '');
  if (!userId) return res.status(400).json({ ok: false, error: 'User ID fehlt.' });
  const access = loadTicketEligibility();
  access.users[userId] = {
    userId,
    hasPremium: true,
    memberFound: Boolean(req.body.memberFound),
    highestRank: req.body.highestRank || null,
    checkedAt: new Date().toISOString(),
    checkedAtMs: Date.now()
  };
  saveTicketEligibility(access);

  const requests = loadTicketEligibilityRequests();
  requests.requests = requests.requests.map((item) => {
    if (String(item.user?.id || '') === userId) return { ...item, done: true, doneAt: new Date().toISOString() };
    return item;
  }).slice(-200);
  saveTicketEligibilityRequests(requests);
  res.json({ ok: true });
});

app.get('/api/tickets/bot/cleanup-due', requireTicketBot, (_req, res) => {
  const data = loadTickets();
  const now = Date.now();
  const due = data.tickets
    .filter((ticket) => ticket.status === 'closed' && ticket.deleteAt && Date.parse(ticket.deleteAt) <= now)
    .map((ticket) => ({ id: ticket.id, channelId: ticket.channelId || ticket.closedChannelId || null, channelName: ticket.channelName || null }));
  res.json({ ok: true, tickets: due });
});

app.post('/api/tickets/bot/channel-deleted', requireTicketBot, (req, res) => {
  const ticketId = String(req.body?.ticketId || '');
  const channelId = String(req.body?.channelId || '');
  const data = loadTickets();
  const before = data.tickets.length;
  data.tickets = data.tickets.filter((ticket) => {
    if (ticketId && ticket.id === ticketId) return false;
    if (channelId && String(ticket.channelId || ticket.closedChannelId || '') === channelId) return false;
    return true;
  });
  saveTickets(data);
  res.json({ ok: true, removed: before - data.tickets.length });
});

app.listen(port, () => {
  console.log(`Blue Website läuft auf Port ${port}`);
  console.log(`Heartbeat Timeout: ${HEARTBEAT_TIMEOUT_SECONDS}s`);
  if (!HEARTBEAT_SECRET) console.warn('BOT_HEARTBEAT_SECRET fehlt. /api/heartbeat nimmt keine Heartbeats an.');
  if (!DISCORD_CLIENT_SECRET) console.warn('DISCORD_CLIENT_SECRET fehlt. Discord Login für Unban-Anträge ist deaktiviert.');
  if (!UNBAN_API_SECRET) console.warn('UNBAN_API_SECRET/BOT_HEARTBEAT_SECRET fehlt. Bot kann Unban-Anträge nicht abrufen.');
  if (!TICKET_API_SECRET) console.warn('TICKET_API_SECRET/UNBAN_API_SECRET/BOT_HEARTBEAT_SECRET fehlt. Bot kann Website-Tickets nicht abrufen.');
});
