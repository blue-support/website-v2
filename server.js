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

const TICKET_API_SECRET = process.env.TICKET_API_SECRET || UNBAN_API_SECRET || HEARTBEAT_SECRET || '';
const TICKETS_FILE = path.join(__dirname, 'data', 'tickets.json');
const TICKET_ELIGIBILITY_FILE = path.join(__dirname, 'data', 'ticket-eligibility.json');
const TICKET_ELIGIBILITY_LOOKUP_FILE = path.join(__dirname, 'data', 'ticket-eligibility-requests.json');
const TICKET_DELETE_AFTER_DAYS = Number(process.env.TICKET_DELETE_AFTER_DAYS || 30);
const TICKET_UPLOAD_DIR = path.join(__dirname, 'data', 'ticket-uploads');

const DASHBOARD_API_SECRET = process.env.DASHBOARD_API_SECRET || TICKET_API_SECRET || UNBAN_API_SECRET || HEARTBEAT_SECRET || '';
const DASHBOARD_GUILDS_FILE = path.join(__dirname, 'data', 'dashboard-guilds.json');
const DASHBOARD_ACCESS_FILE = path.join(__dirname, 'data', 'dashboard-access-cache.json');
const DASHBOARD_ACCESS_LOOKUP_FILE = path.join(__dirname, 'data', 'dashboard-access-requests.json');
const DASHBOARD_VERIFY_CONFIG_FILE = path.join(__dirname, 'data', 'dashboard-verify-configs.json');
const DASHBOARD_VERIFY_ACTION_FILE = path.join(__dirname, 'data', 'dashboard-verify-actions.json');
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
  const state = crypto.randomUUID();
  req.session.oauthState = state;
  req.session.returnTo = cleanReturnPath(req.query.return);

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', DISCORD_CLIENT_ID);
  url.searchParams.set('redirect_uri', discordRedirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds');
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
  if (!botGuild || !userGuild) return null;
  if (!dashboardHasAdministratorPermission(userGuild)) return null;
  return { botGuild, userGuild };
}

function queueDashboardAccess(userId, guildId) {
  const requests = loadDashboardAccessRequests();
  const key = `${userId}:${guildId}`;
  requests.requests[key] = { userId: String(userId), guildId: String(guildId), requestedAt: new Date().toISOString() };
  saveDashboardAccessRequests(requests);
}

function dashboardAccessFor(userId, guildId) {
  const cache = loadDashboardAccess();
  return cache.users?.[String(userId)]?.[String(guildId)] || { checked: false, canManage: false, hasPremiumFooter: false };
}

function dashboardPublicGuildList(req) {
  const botGuilds = loadDashboardGuilds().guilds;
  return dashboardUserGuilds(req)
    .filter((guild) => botGuilds[String(guild.id)])
    .map((guild) => {
      const botGuild = botGuilds[String(guild.id)];
      const hasAdmin = dashboardHasAdministratorPermission(guild);
      queueDashboardAccess(req.session.discordUser.id, guild.id);
      return {
        id: String(guild.id),
        name: botGuild.name || guild.name,
        icon: botGuild.icon || guild.icon || null,
        memberCount: botGuild.memberCount || 0,
        botAvatar: botGuild.botAvatar || null,
        owner: guild.owner,
        available: hasAdmin,
        unavailableReason: hasAdmin ? null : 'Nicht verfügbar - Administrator benötigt',
        access: dashboardAccessFor(req.session.discordUser.id, guild.id)
      };
    });
}

app.get('/api/dashboard/me', requireUser, (req, res) => {
  res.json({ ok: true, user: req.session.discordUser, guilds: dashboardPublicGuildList(req) });
});

app.get('/api/dashboard/guild/:guildId', requireUser, (req, res) => {
  const guildId = String(req.params.guildId || '').replace(/\D/g, '');
  const common = dashboardCommonGuild(req, guildId);
  if (!common) return res.status(403).json({ ok: false, error: 'Nicht verfügbar - Administrator benötigt. Du brauchst Administratorrechte auf diesem Server.' });
  queueDashboardAccess(req.session.discordUser.id, guildId);
  const configs = loadDashboardVerifyConfigs().configs;
  res.json({
    ok: true,
    guild: common.botGuild,
    access: dashboardAccessFor(req.session.discordUser.id, guildId),
    verification: configs[guildId] || null
  });
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
  if (!addRoleIds.length) return res.status(400).json({ ok: false, error: 'Bitte wähle mindestens eine Rolle, die hinzugefügt werden soll.' });
  if (!availableChannelIds.has(channelId)) return res.status(400).json({ ok: false, error: 'Bitte wähle einen gültigen Textkanal.' });

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
    member: req.body.member || null,
    updatedAt: new Date().toISOString()
  };
  saveDashboardAccess(data);
  const requests = loadDashboardAccessRequests();
  delete requests.requests[`${userId}:${guildId}`];
  saveDashboardAccessRequests(requests);
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
  const banInfo = cache?.[type] || null;
  if (!banInfo?.checked) {
    const lookup = loadLookupRequests();
    lookup.requests[user.id] = { userId: user.id, requestedAt: new Date().toISOString() };
    saveLookupRequests(lookup);
    return res.status(409).json({ ok: false, error: 'Dein Ban-Status wird noch vom Bot geprüft. Bitte warte kurz und versuche es erneut.' });
  }
  if (!banInfo?.banned) {
    return res.status(403).json({ ok: false, error: type === 'global' ? 'Für dich wurde kein aktiver Blue Security Global-Ban gefunden. Ein Antrag ist deshalb nicht möglich.' : 'Für dich wurde kein aktiver Discord-Ban gefunden. Ein Antrag ist deshalb nicht möglich.' });
  }

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
  const data = loadTicketEligibility();
  const entry = data.users[String(user.id)] || null;
  const maxAge = 1000 * 60; // Premium-Rolle wird spätestens alle 60 Sekunden neu geprüft.

  if (!entry) {
    queueTicketEligibilityCheck(user);
    return {
      ready: false,
      hasPremium: false,
      checking: true,
      message: 'Premium-Rolle wird geprüft. Bitte warte kurz.'
    };
  }

  const checkedAtMs = Number(entry.checkedAtMs || 0);
  const isStale = !checkedAtMs || Date.now() - checkedAtMs > maxAge;
  if (isStale) {
    queueTicketEligibilityCheck(user);
  }

  return {
    ready: true,
    hasPremium: Boolean(entry.hasPremium),
    memberFound: Boolean(entry.memberFound),
    highestRank: entry.highestRank || null,
    checkedAt: entry.checkedAt || null,
    checking: isStale,
    nextCheckInSeconds: 60,
    message: entry.hasPremium
      ? (isStale ? 'Premium-Zugriff bestätigt. Blue prüft deine Rolle erneut.' : 'Premium-Zugriff bestätigt.')
      : (isStale ? 'Blue Premium benötigt. Blue prüft deine Rolle erneut.' : 'Blue Premium benötigt: Du brauchst die Premium-Rolle auf dem Support Server, um Website-Tickets zu öffnen.')
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

  const ticketAccess = getTicketAccessForUser(req.session.discordUser);
  if (!ticketAccess.ready) {
    return res.status(423).json({ ok: false, error: ticketAccess.message || 'Premium-Status wird noch geprüft.' });
  }
  if (!ticketAccess.hasPremium) {
    return res.status(403).json({ ok: false, error: ticketAccess.message || 'Blue Premium benötigt: Du brauchst die Premium-Rolle, um ein Website-Ticket zu öffnen.' });
  }

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
    hasPremium: Boolean(req.body.hasPremium),
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
