<p align="center"><img src="assets/branding/banner.png" alt="BCPP Aktenverwaltung" width="680"></p>

# 🚔 BCPP Aktenverwaltung

Discord-Bot für die **Ingame-Personalakten des Berlin City Polizeipräsidiums**.
Jeder Beamte bekommt einen eigenen Post in einem Forum. Das Highteam verwaltet alles über ein Panel mit Dropdown-Menü.

Der Bot funktioniert auf **jedem Server**, auf den er eingeladen wird. Jeder Server richtet sich mit `/aufbau` selbst ein.

## ⚡ Installation (Debian / Ubuntu, als root)

```bash
curl -fsSL https://raw.githubusercontent.com/nikesieg4/Polis-Verwaltungs-Application/main/scripts/setup.sh | bash
```

Das Skript fragt nur nach dem **Bot-Token** (und optional nach Cloudflare-D1-Daten) und erledigt den Rest:
Node.js installieren, Code nach `/opt/bcpp-bot` holen, `.env` schreiben, Systemdienst einrichten, Bot starten
und einen **Auto-Updater** einrichten, der alle 5 Minuten neue Commits aus GitHub holt.

**Einladungslink:**
https://discord.com/oauth2/authorize?client_id=1574700107566284830&scope=bot%20applications.commands&permissions=326417599488

## 🧭 Einrichtung in Discord

1. **`/aufbau`** (braucht „Server verwalten“) – Formular:
   - **Forum**, in dem die Personalakten angelegt werden
   - **Rollen** (mehrere möglich), die das Panel benutzen dürfen
2. **`/panel`** – fragt nach der **Kanal-ID** und schickt das Panel dorthin (am besten in einen privaten Highteam-Kanal).

## 📂 Funktionen im Panel

| | Funktion | Inhalt |
|---|---|---|
| 👮 | Personalakte anlegen | Ingame-Name, Dienstnummer, Rang, Discord-ID, Notiz |
| ⚠️ | Warn | Grund, Details, Dauer |
| 🔨 | Bann | Grund, Dauer, Details |
| 📢 | Meldung | Betreff, Beschreibung, Melder/Beteiligte |
| ✅ | Positiver Eintrag | Titel, Beschreibung |
| ❌ | Negativer Eintrag | Titel, Beschreibung |
| 📝 | Bearbeitung | Jeden Eintrag über seine Nummer bearbeiten oder löschen |
| 🔍 | Wichtige Merkmale | Fähigkeit / Stärke / Auffälligkeit |
| 🚨 | Probleme | Konflikte, Beteiligte, Status (offen, gelöst …) |
| 🕒 | Dienstverhalten | Aktivität, Zuverlässigkeit, Verhalten (1–10), Bemerkung |
| 🎓 | Ausbildungen | Schulung/Prüfung, Ergebnis, Prüfer |
| 🗂️ | Stammdaten bearbeiten | Name, DN, Rang usw. ändern |
| 🔎 | Akte suchen | Nach Name oder Dienstnummer |

Jeder Beamte hat **einen** Forum-Post mit seiner **Übersicht**: Stammdaten, Zähler aller Einträge, letztes Dienstverhalten, Ausbildungen, Merkmale, Probleme und die letzten Einträge.
Sie aktualisiert sich automatisch.

Über den Button **📋 Einträge anzeigen** in der Akte öffnet sich eine Liste, die nur du siehst. Die Einträge stehen also nicht unter der Akte.
Dort kannst du nach Kategorie filtern, blättern, einen Eintrag im Log-Stil öffnen und ihn **bearbeiten** oder **löschen**.

🔒 Alle Aktionen prüfen die Highteam-Rollen aus `/aufbau` (Administratoren haben immer Zugriff).

## 🛠️ Verwaltung auf dem Server

```
bcpp-bot status        Status + Auto-Updater
bcpp-bot logs          Live-Logs
bcpp-bot restart       Neustart
bcpp-bot update        Sofort aus GitHub aktualisieren
bcpp-bot config        .env bearbeiten
bcpp-bot reconfigure   Token / Datenbank neu abfragen
bcpp-bot backup        .env + Datenbank sichern
bcpp-bot uninstall     Komplett entfernen
```

## 🗄️ Datenbank

- **Standard:** lokale SQLite-Datei (`/opt/bcpp-bot/data/bcpp.db`). Funktioniert ohne Konfiguration.
- **Cloudflare D1:** `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID` und `CF_API_TOKEN` (Berechtigung *D1 Edit*) in der `.env` eintragen, dann wird automatisch D1 benutzt.
  Die Tabellen legt der Bot beim Start selbst an.
- **GitHub ↔ D1:** Dieselben drei Werte als *Repository Secrets* hinterlegen. Dann wendet die Action `.github/workflows/d1.yml` Schemaänderungen bei jedem Push automatisch auf D1 an.

## ⚙️ Variablen (`.env`)

Siehe [`.env.example`](.env.example). Ein Client Secret wird **nicht** benötigt.
Eine Guild-ID ist auch nicht nötig, weil die Befehle global registriert werden und damit auf allen Servern funktionieren.

## Entwicklung

```bash
npm install
cp .env.example .env   # Token eintragen
npm start
```

Benötigt Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`).
