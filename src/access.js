'use strict';
const { PermissionFlagsBits } = require('discord.js');
const db = require('./db');
const { UserError } = require('./ui');

function memberRoleIds(interaction) {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  return Array.isArray(roles) ? roles : [...roles.cache.keys()];
}

/** Lädt die Server-Konfiguration und prüft, ob der Nutzer Highteam-Zugriff hat. */
async function requireAccess(interaction) {
  if (!interaction.inGuild()) throw new UserError('Dieser Bot funktioniert nur auf Servern.');
  const cfg = await db.getConfig(interaction.guildId);
  if (!cfg || !cfg.forum_channel_id) {
    throw new UserError('Der Bot ist auf diesem Server noch nicht eingerichtet. Ein Admin muss zuerst **/aufbau** ausführen.');
  }
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  const roles = memberRoleIds(interaction);
  if (!isAdmin && !cfg.access_role_ids.some((r) => roles.includes(r))) {
    throw new UserError('🔒 Kein Zugriff. Nur das Highteam der Polizei darf die Personalakten verwalten.');
  }
  return cfg;
}

/** Prüft fehlende Bot-Rechte in einem Kanal und gibt deren Namen zurück. */
function missingBotPerms(channel, perms) {
  const me = channel.guild.members.me;
  const have = channel.permissionsFor(me);
  return perms.filter((p) => !have?.has(PermissionFlagsBits[p]));
}

module.exports = { requireAccess, missingBotPerms };
