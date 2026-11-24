'use strict';
const { Client, GatewayIntentBits, Events, MessageFlags, OAuth2Scopes, PermissionFlagsBits, ActivityType } = require('discord.js');
const config = require('./config');
const db = require('./db');
const { UserError } = require('./ui');
const setup = require('./handlers/setup');
const akten = require('./handlers/akten');

const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
];

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

async function route(interaction) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'aufbau') return setup.aufbauCommand(interaction);
    if (interaction.commandName === 'panel') return setup.panelCommand(interaction);
    return;
  }

  const parts = interaction.customId?.split(':') ?? [];
  const [scope, action, arg, flag] = parts;

  if (scope === 'view' && action !== 'x') return akten.viewInteraction(interaction, parts);

  if (interaction.isStringSelectMenu() && interaction.customId === 'panel:select') return akten.panelSelect(interaction);

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'aufbau:modal') return setup.aufbauSubmit(interaction);
    if (interaction.customId === 'panel:modal') return setup.panelModalSubmit(interaction);
    if (scope === 'akte' && action === 'new') return akten.akteNew(interaction);
    if (scope === 'akte' && action === 'save') return akten.akteSave(interaction, arg);
    if (scope === 'entry' && action === 'new') return akten.entryNew(interaction, arg, flag);
    if (scope === 'entry' && action === 'save') return akten.entrySave(interaction, arg, flag);
    if (scope === 'find' && action === 'entry') return akten.findEntry(interaction);
    if (scope === 'find' && action === 'akte') return akten.findAkte(interaction, arg);
    if (scope === 'find' && action === 'search') return akten.search(interaction);
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'cancel') return akten.cancel(interaction);
    if (scope === 'entry' && action === 'edit') return akten.entryEditButton(interaction, arg, flag);
    if (scope === 'entry' && action === 'del') return akten.entryDeleteButton(interaction, arg, flag);
    if (scope === 'entry' && action === 'delok') return akten.entryDeleteConfirm(interaction, arg, flag);
    if (scope === 'akte' && action === 'view') return akten.akteViewButton(interaction, arg);
    if (scope === 'akte' && action === 'edit') return akten.akteEditButton(interaction, arg);
    if (scope === 'akte' && action === 'del') return akten.akteDeleteButton(interaction, arg);
    if (scope === 'akte' && action === 'delok') return akten.akteDeleteConfirm(interaction, arg);
  }
}

async function respond(interaction, content) {
  const payload = { content, embeds: [], components: [] };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch {
    /* Interaktion abgelaufen */
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isRepliable()) return;
  try {
    await route(interaction);
  } catch (err) {
    if (err instanceof UserError) return respond(interaction, `❌ ${err.message}`);
    console.error(`[Fehler] ${interaction.customId ?? interaction.commandName}:`, err);
    const hint = err.code === 50013 ? ' (dem Bot fehlen Rechte in diesem Kanal)' : '';
    await respond(interaction, `❌ Es ist ein Fehler aufgetreten${hint}. Bitte erneut versuchen.`);
  }
});

/* ------------------------------------------------------------------ */
/* Start                                                               */
/* ------------------------------------------------------------------ */

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ Eingeloggt als ${c.user.tag} – auf ${c.guilds.cache.size} Server(n)`);
  c.user.setActivity('Personalakten', { type: ActivityType.Watching });

  // Globale Befehle → funktionieren auf jedem Server, auf dem der Bot ist
  try {
    await c.application.commands.set(setup.commands.map((cmd) => cmd.toJSON()));
    console.log(`✅ ${setup.commands.length} Slash-Befehle global registriert`);
  } catch (err) {
    console.error('❌ Slash-Befehle konnten nicht registriert werden:', err);
  }

  akten
    .migrateEntriesToView(c)
    .then(() => akten.refreshAllOnce(c))
    .catch((err) => console.error('[Umstellung]', err));

  const invite = c.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: BOT_PERMISSIONS,
  });
  console.log(`🔗 Einladungslink: ${invite}`);
});

client.on(Events.GuildCreate, (g) => console.log(`➕ Neuer Server: ${g.name} (${g.id})`));
client.on(Events.GuildDelete, (g) => console.log(`➖ Server verlassen: ${g.name ?? g.id}`));
client.on(Events.Error, (err) => console.error('[Client]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

(async () => {
  if (!config.token) {
    console.error('❌ DISCORD_TOKEN fehlt in der .env');
    process.exit(1);
  }
  const dbName = await db.init();
  console.log(`✅ Datenbank: ${dbName}`);
  await client.login(config.token);
})().catch((err) => {
  console.error('❌ Start fehlgeschlagen:', err);
  process.exit(1);
});

const shutdown = () => {
  client.destroy();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
