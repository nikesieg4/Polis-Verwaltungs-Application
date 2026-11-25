'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const schema = require('./schema');

const now = () => Math.floor(Date.now() / 1000);
const clean = (params) => params.map((p) => (p === undefined ? null : p));

/* ------------------------------------------------------------------ */
/* Backends                                                            */
/* ------------------------------------------------------------------ */

function sqliteBackend(file) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    name: `SQLite (${file})`,
    async all(sql, params = []) {
      return db.prepare(sql).all(...clean(params));
    },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...clean(params));
      return { lastId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
  };
}

function d1Backend({ accountId, databaseId, apiToken }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  async function query(sql, params = []) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params: clean(params) }),
          signal: AbortSignal.timeout(10_000), // hängende Verbindung nicht ewig warten lassen
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          const msg = (json.errors || []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
          const err = new Error(`D1: ${msg}`);
          // 4xx (außer 429) nicht wiederholen
          if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
          throw err;
        }
        return json.result[0];
      } catch (err) {
        lastErr = err;
        if (err.fatal) break;
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
    throw lastErr;
  }
  return {
    name: `Cloudflare D1 (${databaseId})`,
    async all(sql, params) {
      return (await query(sql, params)).results ?? [];
    },
    async run(sql, params) {
      const r = await query(sql, params);
      return { lastId: Number(r.meta?.last_row_id ?? 0), changes: Number(r.meta?.changes ?? 0) };
    },
  };
}

let backend;
function getBackend() {
  if (backend) return backend;
  if (config.db.driver === 'd1') {
    if (!config.db.d1Configured) {
      throw new Error('DB_DRIVER=d1, aber CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN fehlen in der .env');
    }
    const { accountId, databaseId } = config.db.cf;
    if (!/^[0-9a-f]{32}$/i.test(accountId)) {
      throw new Error(
        `CF_ACCOUNT_ID ist ungültig ("${accountId}"). Erwartet: 32 Zeichen, z. B. 0123456789abcdef0123456789abcdef. ` +
          'Korrigieren mit: bcpp-bot config',
      );
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId)) {
      throw new Error(
        `CF_D1_DATABASE_ID ist ungültig ("${databaseId}"). Erwartet wird die Database ID (nicht der Name), ` +
          'z. B. 12345678-abcd-1234-abcd-1234567890ab. Korrigieren mit: bcpp-bot config',
      );
    }
    backend = d1Backend(config.db.cf);
  } else {
    backend = sqliteBackend(config.db.sqlitePath);
  }
  return backend;
}

const all = (sql, params) => getBackend().all(sql, params);
const get = async (sql, params) => (await getBackend().all(sql, params))[0] ?? null;
const run = (sql, params) => getBackend().run(sql, params);

async function init() {
  for (const stmt of schema.tables) await run(stmt);
  for (const stmt of schema.columns) {
    try {
      await run(stmt);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  }
  await convertProblemsToMeldung();
  return getBackend().name;
}

/** Einmalig: Eintragsart „Problem“ wurde entfernt → bestehende Einträge werden zu „Meldung / Info“ */
async function convertProblemsToMeldung() {
  const KEY = 'problem_to_meldung_v1';
  if (await getMeta(KEY)) return;
  const rows = await all(`SELECT id, daten FROM eintraege WHERE typ = 'problem'`);
  for (const row of rows) {
    const d = parseDaten(row.daten);
    const daten = {
      art: 'Meldung',
      betreff: d.problem || 'Problem',
      beschreibung: [d.beschreibung, d.status ? `Status: ${d.status}` : ''].filter(Boolean).join('\n\n'),
      melder: d.beteiligte || '',
    };
    await run(`UPDATE eintraege SET typ = 'meldung', daten = ? WHERE id = ?`, [JSON.stringify(daten), row.id]);
  }
  await setMeta(KEY, String(now()));
  if (rows.length) console.log(`✅ ${rows.length} Problem-Einträge in „Meldung / Info“ umgewandelt`);
}

/* ------------------------------------------------------------------ */
/* Server-Konfiguration                                                */
/* ------------------------------------------------------------------ */

// Kurzer Zwischenspeicher: Formulare müssen innerhalb von 3 Sekunden geöffnet werden,
// jede gesparte Datenbank-Abfrage (bei D1 eine HTTP-Anfrage) hilft dabei.
const CONFIG_TTL_MS = 60_000;
const configCache = new Map();

async function getConfig(guildId) {
  const hit = configCache.get(guildId);
  if (hit && hit.until > Date.now()) return hit.value;
  const row = await get('SELECT * FROM guild_config WHERE guild_id = ?', [guildId]);
  let roles = [];
  try {
    roles = JSON.parse(row?.access_role_ids || '[]');
  } catch {
    /* beschädigter Wert → keine Rollen */
  }
  const value = row ? { ...row, access_role_ids: Array.isArray(roles) ? roles : [] } : null;
  configCache.set(guildId, { value, until: Date.now() + CONFIG_TTL_MS });
  return value;
}

async function saveConfig(guildId, { forumChannelId, accessRoleIds }) {
  await run(
    `INSERT INTO guild_config (guild_id, forum_channel_id, access_role_ids, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET
       forum_channel_id = excluded.forum_channel_id,
       access_role_ids = excluded.access_role_ids,
       updated_at = excluded.updated_at`,
    [guildId, forumChannelId, JSON.stringify(accessRoleIds), now()],
  );
  configCache.delete(guildId);
}

async function setPanel(guildId, channelId, messageId) {
  await run('UPDATE guild_config SET panel_channel_id = ?, panel_message_id = ?, updated_at = ? WHERE guild_id = ?', [
    channelId,
    messageId,
    now(),
    guildId,
  ]);
  configCache.delete(guildId);
}

/* ------------------------------------------------------------------ */
/* Akten                                                               */
/* ------------------------------------------------------------------ */

async function createAkte(guildId, data, userId) {
  const r = await run(
    `INSERT INTO akten (guild_id, name, dienstnummer, rang, discord_id, discord_name, abteilung, notiz, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      guildId,
      data.name,
      data.dienstnummer,
      data.rang,
      data.discord_id,
      data.discord_name,
      data.abteilung,
      data.notiz,
      userId,
      now(),
    ],
  );
  return r.lastId;
}

const getAkte = (id) => get('SELECT * FROM akten WHERE id = ?', [id]);
const getAkteByThread = (threadId) => get('SELECT * FROM akten WHERE thread_id = ?', [threadId]);

async function setAkteThread(id, threadId) {
  await run('UPDATE akten SET thread_id = ? WHERE id = ?', [threadId, id]);
}

async function updateAkte(id, data, userId) {
  await run(
    `UPDATE akten SET name = ?, dienstnummer = ?, rang = ?, discord_id = ?, discord_name = ?, abteilung = ?, notiz = ?,
       updated_by = ?, updated_at = ?
     WHERE id = ?`,
    [
      data.name,
      data.dienstnummer,
      data.rang,
      data.discord_id,
      data.discord_name,
      data.abteilung,
      data.notiz,
      userId,
      now(),
      id,
    ],
  );
}

async function deleteAkte(id) {
  await run('DELETE FROM eintraege WHERE akte_id = ?', [id]);
  await run('DELETE FROM akten WHERE id = ?', [id]);
}

async function findAkteByDienstnummer(guildId, abteilung, dn) {
  return get(
    `SELECT * FROM akten WHERE guild_id = ? AND coalesce(abteilung, '') = ? AND lower(dienstnummer) = lower(?)`,
    [guildId, abteilung ?? '', dn],
  );
}

async function findAkteByDiscord(guildId, discordId) {
  return get('SELECT * FROM akten WHERE guild_id = ? AND discord_id = ?', [guildId, discordId]);
}

async function searchAkten(guildId, query, limit = 10) {
  const q = query.trim().replace(/^\[|\]$/g, '');
  // Format "15|04" → Abteilung + Dienstnummer
  const abtDn = q.match(/^(\d+)\s*[|/]\s*(.+)$/);
  if (abtDn) {
    return all(
      `SELECT * FROM akten WHERE guild_id = ? AND abteilung = ? AND lower(dienstnummer) LIKE ? ORDER BY dienstnummer LIMIT ?`,
      [guildId, abtDn[1], `%${abtDn[2].toLowerCase().replace(/[%_]/g, '')}%`, limit],
    );
  }
  const like = `%${q.toLowerCase().replace(/[%_]/g, '')}%`;
  return all(
    `SELECT * FROM akten WHERE guild_id = ? AND (lower(name) LIKE ? OR lower(coalesce(dienstnummer, '')) LIKE ?
       OR lower(coalesce(discord_name, '')) LIKE ?)
     ORDER BY abteilung, dienstnummer, name LIMIT ?`,
    [guildId, like, like, like, limit],
  );
}

async function setDiscordName(id, name) {
  await run('UPDATE akten SET discord_name = ? WHERE id = ?', [name, id]);
}

/* ------------------------------------------------------------------ */
/* Einträge                                                            */
/* ------------------------------------------------------------------ */

function parseDaten(raw) {
  try {
    return JSON.parse(raw || '{}') ?? {};
  } catch {
    return {}; // beschädigter Eintrag soll nicht die ganze Akte unbrauchbar machen
  }
}
const parseEntry = (row) => (row ? { ...row, daten: parseDaten(row.daten) } : null);

async function createEntry(akte, typ, daten, userId) {
  const r = await run(
    `INSERT INTO eintraege (akte_id, guild_id, typ, daten, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [akte.id, akte.guild_id, typ, JSON.stringify(daten), userId, now()],
  );
  return r.lastId;
}

async function getEntry(id) {
  return parseEntry(await get('SELECT * FROM eintraege WHERE id = ?', [id]));
}

async function setEntryMessage(id, messageId) {
  await run('UPDATE eintraege SET message_id = ? WHERE id = ?', [messageId, id]);
}

async function updateEntry(id, daten, userId) {
  await run('UPDATE eintraege SET daten = ?, updated_by = ?, updated_at = ? WHERE id = ?', [
    JSON.stringify(daten),
    userId,
    now(),
    id,
  ]);
}

async function deleteEntry(id) {
  await run('DELETE FROM eintraege WHERE id = ?', [id]);
}

async function listEntries(akteId) {
  return (await all('SELECT * FROM eintraege WHERE akte_id = ? ORDER BY created_at ASC, id ASC', [akteId])).map(
    parseEntry,
  );
}

/* ------------------------------------------------------------------ */
/* Meta (z. B. einmalige Umstellungen)                                 */
/* ------------------------------------------------------------------ */

async function getMeta(key) {
  return (await get('SELECT value FROM meta WHERE key = ?', [key]))?.value ?? null;
}

async function setMeta(key, value) {
  await run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
}

const allAkten = () => all('SELECT * FROM akten ORDER BY id');
const listAkten = (guildId) =>
  all(`SELECT * FROM akten WHERE guild_id = ? ORDER BY lower(coalesce(discord_name, name))`, [guildId]);

module.exports = {
  init,
  getMeta,
  setMeta,
  allAkten,
  listAkten,
  now,
  getConfig,
  saveConfig,
  setPanel,
  createAkte,
  getAkte,
  getAkteByThread,
  setAkteThread,
  updateAkte,
  deleteAkte,
  findAkteByDienstnummer,
  findAkteByDiscord,
  searchAkten,
  setDiscordName,
  createEntry,
  getEntry,
  setEntryMessage,
  updateEntry,
  deleteEntry,
  listEntries,
};
