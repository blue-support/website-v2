import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, GatewayIntentBits } from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname, {
  extensions: ['html'],
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

const bootStarted = Date.now();
let lastGatewayState = 'offline';
let lastError = null;

function uptimeLabel() {
  if (!client.isReady()) return '—';
  const diff = Date.now() - bootStarted;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function countGuildMembers() {
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    total += guild.memberCount || 0;
  }
  return total;
}

function countOnlineUsers() {
  const users = new Set();
  for (const guild of client.guilds.cache.values()) {
    for (const presence of guild.presences.cache.values()) {
      if (['online', 'idle', 'dnd'].includes(presence.status)) users.add(presence.userId);
    }
  }
  return users.size;
}

function botOnline() {
  return Boolean(process.env.DISCORD_TOKEN && client.isReady());
}

app.get('/api/stats', (_req, res) => {
  const online = botOnline();
  res.json({
    onlineUsers: online ? countOnlineUsers() : 0,
    guilds: online ? client.guilds.cache.size : 0,
    totalUsers: online ? countGuildMembers() : 0,
    commandsToday: Number(process.env.COMMANDS_TODAY_DEMO || 0),
    latency: online ? Math.round(client.ws.ping || 0) : null,
    uptime: online ? uptimeLabel() : '—',
    botReady: online,
    bootedAt: new Date(bootStarted).toISOString()
  });
});

app.get('/api/status', (_req, res) => {
  const online = botOnline();
  const latency = online ? Math.round(client.ws.ping || 0) : null;
  const degraded = online && latency !== null && latency > 250;
  const overall = online ? (degraded ? 'degraded' : 'online') : 'offline';

  res.json({
    overall,
    title: online ? (degraded ? 'Erhöhte Latenz' : 'Alle Systeme operational') : 'Bot offline',
    message: online
      ? (degraded ? `Blue ⚡ ist verbunden, aber der Ping liegt bei ${latency}ms.` : 'Blue ⚡ ist verbunden und läuft stabil.')
      : 'Blue ⚡ ist aktuell nicht mit Discord verbunden. Prüfe DISCORD_TOKEN, Intents und Hosting-Logs.',
    components: [
      { name: 'Discord Gateway', status: overall, description: online ? `${latency}ms Ping` : 'Nicht verbunden' },
      { name: 'Slash Commands', status: online ? 'online' : 'offline', description: 'Command Handling' },
      { name: 'Ticket System', status: online ? 'online' : 'offline', description: 'Support Module' },
      { name: 'Website', status: 'online', description: 'Frontend & API' },
      { name: 'Render Service', status: 'online', description: 'Hosting läuft' }
    ],
    incidents: [
      online
        ? { title: 'Keine aktiven Incidents', date: new Date().toISOString().slice(0, 10), text: 'Alle Systeme laufen normal.' }
        : { title: 'Bot Verbindung offline', date: new Date().toISOString().slice(0, 10), text: lastError || 'Der Bot ist nicht eingeloggt. Wahrscheinlich fehlt der Token oder ein Intent ist nicht aktiviert.' }
    ]
  });
});

client.once('ready', async () => {
  lastGatewayState = 'online';
  console.log(`Blue Website API läuft als ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.members.fetch({ withPresences: true });
    } catch (error) {
      console.warn(`Members/Presences konnten für ${guild.name} nicht vollständig geladen werden.`);
    }
  }
});

client.on('shardDisconnect', () => { lastGatewayState = 'offline'; });
client.on('error', (error) => { lastError = error.message; console.error(error); });
client.on('warn', (message) => console.warn(message));

if (!process.env.DISCORD_TOKEN) {
  lastError = 'DISCORD_TOKEN fehlt in den Environment Variables.';
  console.warn(lastError);
} else {
  client.login(process.env.DISCORD_TOKEN).catch((error) => {
    lastError = error.message;
    console.error('Discord Login fehlgeschlagen:', error);
  });
}

app.listen(port, () => {
  console.log(`Blue Website läuft auf Port ${port}`);
});
