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

// Statische Website aus dem Hauptordner ausliefern.
app.use(express.static(__dirname));

// Da die Startdatei testindex.html heißt, öffnen wir sie auch unter /.
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'testindex.html'));
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    // Für echte Online-Zahlen brauchst du im Discord Developer Portal das Presence Intent.
    GatewayIntentBits.GuildPresences
  ]
});

const bootStarted = Date.now();
let lastLatency = 0;

function getUptimePercent() {
  // Simpler Demo-Wert. Für Produktion besser echte Monitoring-Daten nutzen.
  return '99.98%';
}

function countOnlineUsers() {
  // Hinweis: Discord liefert Presence-Daten nur mit aktiviertem Privileged Intent
  // und nicht immer vollständig, wenn nicht alles gecached ist.
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    const uniqueUsers = new Set();
    for (const presence of guild.presences.cache.values()) {
      if (['online', 'idle', 'dnd'].includes(presence.status)) {
        uniqueUsers.add(presence.userId);
      }
    }
    total += uniqueUsers.size;
  }
  return total;
}

app.get('/api/stats', (_req, res) => {
  const guilds = client.guilds.cache.size || 0;
  lastLatency = Math.round(client.ws.ping || 0);

  res.json({
    onlineUsers: countOnlineUsers(),
    guilds,
    commandsToday: Number(process.env.COMMANDS_TODAY_DEMO || 0),
    latency: lastLatency,
    uptime: getUptimePercent(),
    bootedAt: new Date(bootStarted).toISOString()
  });
});

app.get('/api/status', (_req, res) => {
  const online = client.isReady();
  const degraded = online && lastLatency > 250;

  res.json({
    overall: online ? (degraded ? 'degraded' : 'online') : 'offline',
    title: online ? (degraded ? 'Teilweise erhöhte Latenz' : 'Alle Systeme operational') : 'Bot offline',
    message: online ? 'Blue ⚡ ist mit Discord verbunden.' : 'Blue ⚡ ist aktuell nicht mit Discord verbunden.',
    components: [
      { name: 'Discord Gateway', status: online ? (degraded ? 'degraded' : 'online') : 'offline' },
      { name: 'Slash Commands', status: online ? 'online' : 'offline' },
      { name: 'Ticket System', status: online ? 'online' : 'offline' },
      { name: 'Website', status: 'online' },
      { name: 'Database', status: 'online' }
    ],
    incidents: [
      {
        title: online ? 'Keine aktiven Incidents' : 'Bot Verbindung unterbrochen',
        date: new Date().toISOString().slice(0, 10),
        text: online ? 'Alle Systeme laufen normal.' : 'Bitte prüfe Hosting, Bot Token und Discord Gateway.'
      }
    ]
  });
});

client.once('ready', () => {
  console.log(`Blue status API läuft als ${client.user.tag}`);
});

if (!process.env.DISCORD_TOKEN) {
  console.warn('DISCORD_TOKEN fehlt. API läuft, aber Bot-Daten bleiben leer/offline.');
} else {
  client.login(process.env.DISCORD_TOKEN);
}

app.listen(port, () => {
  console.log(`Website/API läuft auf http://localhost:${port}`);
});
