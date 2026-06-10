# Blue ⚡ Website + Render API

Professionelle Website für deinen Discord Bot **Blue ⚡** mit Live-Stats über Render.

## Hochladen

Den Inhalt dieses Ordners direkt in dein GitHub Repository hochladen. Wichtig: `package.json`, `server.js`, `render.yaml` und `index.html` müssen direkt im Hauptordner liegen.

## Render Einstellungen

Render → New → Web Service → GitHub Repo auswählen

- Build Command: `npm install`
- Start Command: `npm start`

Environment Variables in Render:

```env
DISCORD_TOKEN=dein_discord_bot_token
COMMANDS_TODAY_DEMO=0
```

Der Bot Token gehört nur in Render, niemals in GitHub.

## Discord Developer Portal

Für Online-User/Member-Daten aktiviere unter Bot → Privileged Gateway Intents:

- SERVER MEMBERS INTENT
- PRESENCE INTENT

## Anpassen

- In `index.html` `DEINE_CLIENT_ID` durch deine echte Discord Application Client ID ersetzen.
- In `impressum.html`, `privacy.html`, `tos.html` die Platzhalter prüfen und ersetzen.
- Support Link ist bereits `https://dsc.blue-lol.de`.

## Dateien

- `index.html` — Startseite
- `status.html` — Bot Status
- `impressum.html` — Impressum
- `tos.html` — Terms of Service
- `privacy.html` — Privacy Policy
- `support.html` — Support Weiterleitung
- `assets/styles.css` — Design
- `assets/app.js` — Animationen + Live-Daten
- `server.js` — Express + Discord API
