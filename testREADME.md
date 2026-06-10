# Blue ⚡ Website

Professionelle mehrseitige Website für deinen Community Server / Discord Bot **Blue ⚡**.

## Enthalten

- `testindex.html` — Startseite mit Hero, Features, Stats, CTA und Animationen
- `teststatus.html` — Bot Status Seite mit Komponenten, Incidents und Live-Stats
- `testimpressum.html` — Impressum-Vorlage
- `testtos.html` — Terms of Service Vorlage
- `testprivacy.html` — Privacy Policy Vorlage
- `testsupport.html` — Weiterleitung zu `https://dsc.blue-lol.de`
- `assets/teststyles.css` — komplettes modernes Design
- `assets/testapp.js` — Animationen, Mobile Menü, Status-/Stats-Ladefunktion
- `data/teststats.json` und `data/teststatus.json` — statische Fallback-Daten
- `backend-example/` — optionales Node.js Beispiel für echte Live-Daten

## Wichtige Anpassungen vor dem Upload

1. In `testindex.html` die Bot Invite URL ersetzen:

```html
https://discord.com/oauth2/authorize?client_id=DEINE_CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

Ersetze `DEINE_CLIENT_ID` durch die Client-ID deines Discord Bots.

2. In `testimpressum.html`, `testprivacy.html` und ggf. `testtos.html` alle Platzhalter ersetzen:

```txt
[Dein Name / Unternehmen]
[deine E-Mail]
[Straße und Hausnummer]
[PLZ Ort]
```

3. Support-Link ist bereits korrigiert auf:

```txt
https://dsc.blue-lol.de
```

## Live User / Server Stats

Eine reine statische Website kann die echten Discord-Zahlen nicht sicher direkt abrufen, weil der Bot Token niemals im Frontend stehen darf. Deshalb lädt die Website zuerst:

```txt
/api/stats
/api/status
```

Wenn diese Endpunkte nicht existieren, nutzt sie automatisch:

```txt
data/teststats.json
data/teststatus.json
```

Du kannst also sofort hosten und später eine API dazuschalten.

## Optional: Backend starten

```bash
cd backend-example
npm install
cp test.env.example .env
# .env öffnen und DISCORD_TOKEN eintragen
npm start
```

Danach ist die Website lokal unter `http://localhost:3000` erreichbar.

Wichtig: Für echte Online-User-Zahlen brauchst du im Discord Developer Portal die passenden Privileged Intents, besonders Presence Intent. Je nach Cache/Shard-Setup können Online-Zahlen trotzdem nur näherungsweise sein.

## Hosting

Für statisches Hosting kannst du den kompletten Ordner ohne `backend-example` auf deinen Webspace hochladen. Für Live-Stats brauchst du zusätzlich einen Node.js Host, VPS, Pterodactyl, Render, Railway oder ähnliches.

## Copyright Footer

Der Footer enthält bereits:

```txt
© 2026 Alle Rechte vorbehalten
```


## Render-ready Version

Diese Version kann direkt als Render Web Service genutzt werden.

Wichtige Dateien:

- `server.js` startet Website + API.
- `package.json` enthält die Node.js-Abhängigkeiten.
- `render.yaml` ist optional für Render Blueprint Deployments.
- `test.env.example` zeigt, welche Environment Variables du in Render eintragen musst.

Start lokal:

```bash
npm install
npm start
```

Render Einstellungen, falls du manuell deployest:

```txt
Language: Node
Build Command: npm install
Start Command: npm start
```

Environment Variable in Render:

```env
DISCORD_TOKEN=dein_bot_token
COMMANDS_TODAY_DEMO=0
```

Token niemals in GitHub hochladen.
