'use strict';
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  InteractionContextType,
  ChannelType,
  ModalBuilder,
  LabelBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');
const db = require('../db');
const { requireAccess, missingBotPerms } = require('../access');
const { UserError, panelMessage } = require('../ui');

const FORUM_PERMS = ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks', 'ReadMessageHistory', 'ManageThreads'];
const PANEL_PERMS = ['ViewChannel', 'SendMessages', 'EmbedLinks'];

const commands = [
  new SlashCommandBuilder()
    .setName('aufbau')
    .setDescription('Richtet den Bot ein: Forum für die Akten und Rollen mit Zugriff festlegen')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Schickt das Akten-Panel in einen Kanal')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o.setName('kanal_id').setDescription('ID des Kanals, in den das Panel geschickt wird').setRequired(false),
    ),
];

/* ---------------------------- /aufbau ----------------------------- */

async function aufbauCommand(interaction) {
  const cfg = await db.getConfig(interaction.guildId);

  const forum = new ChannelSelectMenuBuilder()
    .setCustomId('forum')
    .setChannelTypes(ChannelType.GuildForum)
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true)
    .setPlaceholder('Forum auswählen …');
  if (cfg?.forum_channel_id) forum.setDefaultChannels(cfg.forum_channel_id);

  const roles = new RoleSelectMenuBuilder()
    .setCustomId('rollen')
    .setMinValues(1)
    .setMaxValues(25)
    .setRequired(true)
    .setPlaceholder('Rollen auswählen …');
  const existingRoles = (cfg?.access_role_ids ?? []).filter((id) => interaction.guild.roles.cache.has(id)).slice(0, 25);
  if (existingRoles.length) roles.setDefaultRoles(...existingRoles);

  const modal = new ModalBuilder()
    .setCustomId('aufbau:modal')
    .setTitle('Aktenverwaltung einrichten')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Forum für die Personalakten')
        .setDescription('In diesem Forum wird für jeden Beamten ein eigener Post angelegt.')
        .setChannelSelectMenuComponent(forum),
      new LabelBuilder()
        .setLabel('Rollen mit Zugriff (Highteam)')
        .setDescription('Nur diese Rollen (und Administratoren) dürfen das Panel benutzen.')
        .setRoleSelectMenuComponent(roles),
    );
  await interaction.showModal(modal);
}

async function aufbauSubmit(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserError('Nur Nutzer mit „Server verwalten“ dürfen den Bot einrichten.');
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const forum = interaction.fields.getSelectedChannels('forum', true)?.first();
  if (!forum || forum.type !== ChannelType.GuildForum) throw new UserError('Bitte wähle einen **Forum**-Kanal aus.');
  const roles = [...(interaction.fields.getSelectedRoles('rollen')?.keys() ?? [])];

  await db.saveConfig(interaction.guildId, { forumChannelId: forum.id, accessRoleIds: roles });

  const forumChannel = await interaction.guild.channels.fetch(forum.id);
  const missing = missingBotPerms(forumChannel, FORUM_PERMS);

  const embed = new EmbedBuilder()
    .setColor(missing.length ? 0xf59e0b : 0x16a34a)
    .setTitle('✅ Einrichtung gespeichert')
    .addFields(
      { name: '📂 Akten-Forum', value: `<#${forum.id}>`, inline: true },
      { name: '🔒 Zugriff', value: roles.map((r) => `<@&${r}>`).join(' ') || 'nur Administratoren', inline: true },
    )
    .setDescription('Als Nächstes **/panel** ausführen, um das Akten-Panel in einen (privaten) Kanal zu schicken.');
  if (missing.length) {
    embed.addFields({
      name: '⚠️ Fehlende Bot-Rechte im Forum',
      value: `Bitte dem Bot im Forum diese Rechte geben:\n\`${missing.join('`, `')}\``,
    });
  }
  await interaction.editReply({ embeds: [embed] });
}

/* ----------------------------- /panel ----------------------------- */

async function panelCommand(interaction) {
  await requireAccess(interaction);
  const raw = interaction.options.getString('kanal_id');
  if (raw) return sendPanel(interaction, raw);

  const input = new TextInputBuilder()
    .setCustomId('kanal_id')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(40)
    .setPlaceholder('z. B. 123456789012345678')
    .setValue(interaction.channelId);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('panel:modal')
      .setTitle('Panel senden')
      .addLabelComponents(
        new LabelBuilder()
          .setLabel('Kanal-ID')
          .setDescription('Rechtsklick auf den Kanal → „Kanal-ID kopieren“ (Entwicklermodus)')
          .setTextInputComponent(input),
      ),
  );
}

async function panelModalSubmit(interaction) {
  await requireAccess(interaction);
  return sendPanel(interaction, interaction.fields.getTextInputValue('kanal_id'));
}

async function sendPanel(interaction, raw) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const id = String(raw).match(/(\d{17,20})/)?.[1];
  if (!id) throw new UserError('Das ist keine gültige Kanal-ID.');

  const channel = await interaction.guild.channels.fetch(id).catch(() => null);
  if (!channel) throw new UserError(`Kanal \`${id}\` wurde auf diesem Server nicht gefunden.`);
  if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
    throw new UserError('Das Panel kann nur in einen normalen Text-Kanal geschickt werden.');
  }
  const missing = missingBotPerms(channel, PANEL_PERMS);
  if (missing.length) throw new UserError(`Dem Bot fehlen in <#${channel.id}> diese Rechte: \`${missing.join('`, `')}\``);

  const msg = await channel.send(panelMessage());
  await db.setPanel(interaction.guildId, channel.id, msg.id);
  await interaction.editReply(`✅ Panel wurde in <#${channel.id}> geschickt: ${msg.url}`);
}

module.exports = { commands, aufbauCommand, aufbauSubmit, panelCommand, panelModalSubmit };
