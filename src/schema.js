'use strict';
// Wird beim Start automatisch ausgeführt (lokal SQLite und Cloudflare D1).
module.exports = [
  `CREATE TABLE IF NOT EXISTS guild_config (
    guild_id TEXT PRIMARY KEY,
    forum_channel_id TEXT,
    access_role_ids TEXT NOT NULL DEFAULT '[]',
    panel_channel_id TEXT,
    panel_message_id TEXT,
    updated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS akten (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    dienstnummer TEXT,
    rang TEXT,
    discord_id TEXT,
    notiz TEXT,
    thread_id TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_by TEXT,
    updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_akten_guild ON akten (guild_id)`,
  `CREATE TABLE IF NOT EXISTS eintraege (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    akte_id INTEGER NOT NULL,
    guild_id TEXT NOT NULL,
    typ TEXT NOT NULL,
    daten TEXT NOT NULL,
    message_id TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_by TEXT,
    updated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_eintraege_akte ON eintraege (akte_id)`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
  )`,
];
