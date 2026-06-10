BLUE ⚡ Heartbeat-System

Diese ZIP enthält nur die Dateien, die für echten Bot-Status nötig sind.

Website / GitHub ersetzen:
- server.js
- package.json
- data/status.json
- data/stats.json

Bot:
- app.py ist deine hochgeladene Bot-Datei mit eingebautem Heartbeat und ohne hardcoded Bot-Token.
- Alternativ kannst du bot-heartbeat-snippet.txt manuell in deine aktuelle Bot-Datei einfügen.

Render Environment Variables im Website-Service:
BOT_HEARTBEAT_SECRET=ein-langes-geheimes-passwort
HEARTBEAT_TIMEOUT_SECONDS=120

Beim Python-Bot als Environment Variables oder in .env:
DISCORD_TOKEN=dein_neuer_bot_token
BLUE_WEBSITE_HEARTBEAT_URL=https://DEINE-DOMAIN.de/api/heartbeat
BOT_HEARTBEAT_SECRET=das-gleiche-geheime-passwort-wie-bei-render
BOT_VERSION=3.2.1

Wichtig:
- DISCORD_TOKEN gehört NICHT mehr in Render Website-Service.
- Der Website-Service braucht nur BOT_HEARTBEAT_SECRET.
- Der Bot sendet alle 30 Sekunden einen Heartbeat.
- Wenn 120 Sekunden nichts kommt, zeigt die Website offline.
