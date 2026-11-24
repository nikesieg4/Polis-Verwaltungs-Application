'use strict';
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// .env laden (Node >= 20.12 hat das eingebaut, kein dotenv nötig)
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  /* keine .env vorhanden – Variablen kommen evtl. aus der Umgebung (systemd, GitHub Actions) */
}

// Leerzeichen und versehentlich mitkopierte Anführungszeichen entfernen
const env = (k, d = '') => (process.env[k] ?? d).trim().replace(/^["']|["']$/g, '').trim();

const cf = {
  accountId: env('CF_ACCOUNT_ID'),
  databaseId: env('CF_D1_DATABASE_ID'),
  apiToken: env('CF_API_TOKEN'),
};
const d1Configured = Boolean(cf.accountId && cf.databaseId && cf.apiToken);

let driver = env('DB_DRIVER').toLowerCase();
if (!driver) driver = d1Configured ? 'd1' : 'sqlite';

module.exports = {
  ROOT,
  token: env('DISCORD_TOKEN'),
  guildId: env('GUILD_ID'),
  clientId: env('CLIENT_ID'),
  db: {
    driver,
    sqlitePath: path.resolve(ROOT, env('SQLITE_PATH', './data/bcpp.db')),
    cf,
    d1Configured,
  },
  brandColor: 0x1d4ed8,
  orgName: 'Berlin City Polizeipräsidium',
};
