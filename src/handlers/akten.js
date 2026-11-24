'use strict';
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../db');
const { TYPES, AKTE_FIELDS, summary } = require('../categories');
const { requireAccess } = require('../access');
const {
  UserError,
  cut,
  panelMessage,
  buildModal,
  readModal,
  BEAMTER_FIELD,
  threadName,
  akteMessage,
  entryEmbed,
  entryButtons,
  entryMessage,
} = require('../ui');

const EPH = { flags: MessageFlags.Ephemeral };

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

async function resolveAkte(guildId, query) {
  const q = query.trim();
  const threadId = q.match(/^<#(\d{17,20})>$/)?.[1] ?? (/^\d{17,20}$/.test(q) ? q : null);
  if (threadId) {
    const byThread = await db.getAkteByThread(threadId);
    if (byThread && byThread.guild_id === guildId) return byThread;
  }

  const exact = await db.exactAkten(guildId, q);
  if (exact.length === 1) return exact[0];
  const rows = exact.length ? exact : await db.searchAkten(guildId, q, 10);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw new UserError(`Keine Personalakte für „${cut(q, 50)}“ gefunden.`);
  throw new UserError(
    `Mehrere Akten passen zu „${cut(q, 50)}“. Bitte genauer angeben (am besten die Dienstnummer):\n` +
      rows.map((a) => `• **${a.name}** – ${a.dienstnummer || 'ohne DN'}`).join('\n'),
  );
}

async function loadAkte(guildId, id) {
  const akte = await db.getAkte(Number(id));
  if (!akte || akte.guild_id !== guildId) throw new UserError('Diese Personalakte existiert nicht mehr.');
  return akte;
}

async function loadEntry(guildId, id) {
  const entry = await db.getEntry(Number(id));
  if (!entry || entry.guild_id !== guildId) throw new UserError(`Eintrag #${id} existiert nicht.`);
  return entry;
}

async function getThread(client, akte) {
  const thread = akte.thread_id ? await client.channels.fetch(akte.thread_id).catch(() => null) : null;
  if (!thread) {
    throw new UserError(
      `Der Forum-Post der Akte **${akte.name}** wurde nicht gefunden (gelöscht?). Die Daten sind aber noch gespeichert.`,
    );
  }
  if (thread.archived) await thread.setArchived(false).catch(() => {});
  return thread;
}

/** Aktualisiert die Übersicht (erste Nachricht) im Forum-Post. */
async function refreshAkte(client, akteId) {
  const akte = await db.getAkte(akteId);
  if (!akte) return;
  const thread = await getThread(client, akte);
  const entries = await db.listEntries(akte.id);
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (starter) await starter.edit(akteMessage(akte, entries));
  const name = threadName(akte);
  if (thread.name !== name) await thread.setName(name).catch(() => {});
}

function parseAkteInput(values) {
  const data = { ...values };
  if (data.discord_id) {
    const id = data.discord_id.match(/(\d{17,20})/)?.[1];
    if (!id) throw new UserError('Die Discord-ID ist ungültig (nur Zahlen, z. B. `123456789012345678`).');
    data.discord_id = id;
  } else {
    data.discord_id = null;
  }
  data.notiz = data.notiz || null;
  return data;
}

function validateEntry(typ, values) {
  for (const f of TYPES[typ].fields) {
    if (f.required && !values[f.id]) throw new UserError(`Das Feld **${f.name}** muss ausgefüllt werden.`);
  }
  return values;
}

const confirmRow = (yesId, label) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(yesId).setLabel(label).setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('cancel').setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
  );

/* ------------------------------------------------------------------ */
/* Panel-Auswahl                                                       */
/* ------------------------------------------------------------------ */

async function panelSelect(interaction) {
  // Auswahl im Menü zurücksetzen, damit dieselbe Option erneut gewählt werden kann
  const reset = () => interaction.message.edit(panelMessage()).catch(() => {});

  try {
    await requireAccess(interaction);
  } catch (err) {
    reset();
    throw err;
  }
  const [action, typ] = interaction.values[0].split(':');

  switch (action) {
    case 'akte_neu':
      await interaction.showModal(buildModal('akte:new', '👮 Neue Personalakte', AKTE_FIELDS));
      break;
    case 'eintrag': {
      const t = TYPES[typ];
      await interaction.showModal(buildModal(`entry:new:${typ}`, `${t.emoji} ${t.label}`, [BEAMTER_FIELD, ...t.fields]));
      break;
    }
    case 'bearbeiten':
      await interaction.showModal(
        buildModal('find:entry', '📝 Eintrag bearbeiten', [
          {
            id: 'nummer',
            label: 'Eintrags-Nummer',
            description: 'Steht im Eintrag oben, z. B. „Eintrag #12“',
            type: 'short',
            required: true,
            max: 12,
            placeholder: '12',
          },
        ]),
      );
      break;
    case 'akte_bearbeiten':
      await interaction.showModal(buildModal('find:akte', '🗂️ Stammdaten bearbeiten', [BEAMTER_FIELD]));
      break;
    case 'suchen':
      await interaction.showModal(
        buildModal('find:search', '🔎 Akte suchen', [
          { id: 'suche', label: 'Name oder Dienstnummer', type: 'short', required: true, max: 80 },
        ]),
      );
      break;
    default:
      throw new UserError('Unbekannte Aktion.');
  }
  reset();
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

async function akteNew(interaction) {
  const cfg = await requireAccess(interaction);
  await interaction.deferReply(EPH);
  const data = parseAkteInput(readModal(interaction, AKTE_FIELDS));

  if (await db.findAkteByDienstnummer(interaction.guildId, data.dienstnummer)) {
    throw new UserError(`Es gibt bereits eine Personalakte mit der Dienstnummer **${data.dienstnummer}**.`);
  }

  const forum = await interaction.guild.channels.fetch(cfg.forum_channel_id).catch(() => null);
  if (!forum || forum.type !== ChannelType.GuildForum) {
    throw new UserError('Das Akten-Forum existiert nicht mehr. Bitte **/aufbau** erneut ausführen.');
  }

  const id = await db.createAkte(interaction.guildId, data, interaction.user.id);
  const akte = await db.getAkte(id);
  try {
    const requireTag = forum.flags?.has?.('RequireTag');
    const thread = await forum.threads.create({
      name: threadName(akte),
      message: akteMessage(akte, []),
      appliedTags: requireTag && forum.availableTags.length ? [forum.availableTags[0].id] : [],
      reason: `Personalakte angelegt von ${interaction.user.tag}`,
    });
    await db.setAkteThread(id, thread.id);
    await interaction.editReply(`✅ Personalakte für **${akte.name}** angelegt: <#${thread.id}>`);
  } catch (err) {
    await db.deleteAkte(id);
    if (err.code === 50013 || err.code === 50001) {
      throw new UserError('Dem Bot fehlen Rechte im Akten-Forum (Beiträge erstellen, Nachrichten senden, Threads verwalten).');
    }
    throw err;
  }
}

async function entryNew(interaction, typ) {
  if (!TYPES[typ]) throw new UserError('Unbekannte Eintragsart.');
  await requireAccess(interaction);
  await interaction.deferReply(EPH);

  const values = readModal(interaction, [BEAMTER_FIELD, ...TYPES[typ].fields]);
  const akte = await resolveAkte(interaction.guildId, values.beamter);
  delete values.beamter;
  validateEntry(typ, values);

  const thread = await getThread(interaction.client, akte);
  const entryId = await db.createEntry(akte, typ, values, interaction.user.id);
  const entry = await db.getEntry(entryId);
  try {
    const msg = await thread.send(entryMessage(entry, akte));
    await db.setEntryMessage(entryId, msg.id);
  } catch (err) {
    await db.deleteEntry(entryId);
    throw err;
  }
  await refreshAkte(interaction.client, akte.id);
  await interaction.editReply(
    `✅ ${TYPES[typ].emoji} **${TYPES[typ].label}** (Eintrag #${entryId}) zur Akte von **${akte.name}** hinzugefügt: <#${thread.id}>`,
  );
}

async function entrySave(interaction, id) {
  await requireAccess(interaction);
  await interaction.deferReply(EPH);
  const entry = await loadEntry(interaction.guildId, id);
  const akte = await loadAkte(interaction.guildId, entry.akte_id);
  const values = validateEntry(entry.typ, readModal(interaction, TYPES[entry.typ].fields));

  await db.updateEntry(entry.id, values, interaction.user.id);
  const updated = await db.getEntry(entry.id);
  const thread = await getThread(interaction.client, akte);
  const msg = updated.message_id ? await thread.messages.fetch(updated.message_id).catch(() => null) : null;
  if (msg) await msg.edit(entryMessage(updated, akte));
  else await db.setEntryMessage(updated.id, (await thread.send(entryMessage(updated, akte))).id);

  await refreshAkte(interaction.client, akte.id);
  await interaction.editReply(`✅ Eintrag #${entry.id} wurde aktualisiert: <#${thread.id}>`);
}

async function akteSave(interaction, id) {
  await requireAccess(interaction);
  await interaction.deferReply(EPH);
  const akte = await loadAkte(interaction.guildId, id);
  const data = parseAkteInput(readModal(interaction, AKTE_FIELDS));
  const dupe = await db.findAkteByDienstnummer(interaction.guildId, data.dienstnummer);
  if (dupe && dupe.id !== akte.id) {
    throw new UserError(`Die Dienstnummer **${data.dienstnummer}** gehört bereits zur Akte von **${dupe.name}**.`);
  }
  await db.updateAkte(akte.id, data, interaction.user.id);

  // Kopfzeile aller Einträge enthält Name + DN → mit aktualisieren
  const updated = await db.getAkte(akte.id);
  await refreshAkte(interaction.client, akte.id);
  if (akte.name !== updated.name || akte.dienstnummer !== updated.dienstnummer) {
    const thread = await getThread(interaction.client, updated);
    for (const e of await db.listEntries(akte.id)) {
      if (!e.message_id) continue;
      const m = await thread.messages.fetch(e.message_id).catch(() => null);
      if (m) await m.edit(entryMessage(e, updated)).catch(() => {});
    }
  }
  await interaction.editReply(`✅ Stammdaten von **${updated.name}** gespeichert: <#${updated.thread_id}>`);
}

async function findEntry(interaction) {
  await requireAccess(interaction);
  const nr = interaction.fields.getTextInputValue('nummer').replace(/\D/g, '');
  if (!nr) throw new UserError('Bitte eine Eintrags-Nummer angeben.');
  const entry = await loadEntry(interaction.guildId, nr);
  const akte = await loadAkte(interaction.guildId, entry.akte_id);
  await interaction.reply({ ...EPH, embeds: [entryEmbed(entry, akte)], components: [entryButtons(entry.id)] });
}

async function findAkte(interaction) {
  await requireAccess(interaction);
  const akte = await resolveAkte(interaction.guildId, interaction.fields.getTextInputValue('beamter'));
  await interaction.reply({
    ...EPH,
    content: `🗂️ Personalakte von **${akte.name}** (${akte.dienstnummer || 'ohne DN'}) – ${akte.thread_id ? `<#${akte.thread_id}>` : ''}`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`akte:edit:${akte.id}`)
          .setLabel('Stammdaten bearbeiten')
          .setEmoji('🗂️')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  });
}

async function search(interaction) {
  await requireAccess(interaction);
  const q = interaction.fields.getTextInputValue('suche').trim();
  const rows = await db.searchAkten(interaction.guildId, q, 15);
  if (!rows.length) throw new UserError(`Keine Personalakte für „${cut(q, 50)}“ gefunden.`);
  const embed = new EmbedBuilder()
    .setColor(0x1d4ed8)
    .setTitle(`🔎 Suchergebnisse für „${cut(q, 50)}“`)
    .setDescription(
      rows
        .map((a) => `• **${a.name}** – ${a.dienstnummer || 'ohne DN'} · ${a.rang || '—'} · ${a.thread_id ? `<#${a.thread_id}>` : ''}`)
        .join('\n'),
    );
  await interaction.reply({ ...EPH, embeds: [embed] });
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

async function entryEditButton(interaction, id) {
  await requireAccess(interaction);
  const entry = await loadEntry(interaction.guildId, id);
  const t = TYPES[entry.typ];
  await interaction.showModal(
    buildModal(`entry:save:${entry.id}`, `📝 ${t.label} #${entry.id} bearbeiten`, t.fields, entry.daten),
  );
}

async function entryDeleteButton(interaction, id) {
  await requireAccess(interaction);
  const entry = await loadEntry(interaction.guildId, id);
  await interaction.reply({
    ...EPH,
    content: `Soll **${TYPES[entry.typ].emoji} ${TYPES[entry.typ].label} #${entry.id}** („${cut(summary(entry), 80)}“) wirklich gelöscht werden?`,
    components: [confirmRow(`entry:delok:${entry.id}`, 'Endgültig löschen')],
  });
}

async function entryDeleteConfirm(interaction, id) {
  await requireAccess(interaction);
  await interaction.deferUpdate();
  const entry = await loadEntry(interaction.guildId, id);
  const akte = await loadAkte(interaction.guildId, entry.akte_id);
  await db.deleteEntry(entry.id);
  const thread = await getThread(interaction.client, akte).catch(() => null);
  if (thread && entry.message_id) {
    const m = await thread.messages.fetch(entry.message_id).catch(() => null);
    await m?.delete().catch(() => {});
  }
  if (thread) await refreshAkte(interaction.client, akte.id);
  await interaction.editReply({ content: `🗑️ Eintrag #${entry.id} wurde gelöscht.`, embeds: [], components: [] });
}

async function akteEditButton(interaction, id) {
  await requireAccess(interaction);
  const akte = await loadAkte(interaction.guildId, id);
  await interaction.showModal(buildModal(`akte:save:${akte.id}`, '🗂️ Stammdaten bearbeiten', AKTE_FIELDS, akte));
}

async function akteDeleteButton(interaction, id) {
  await requireAccess(interaction);
  const akte = await loadAkte(interaction.guildId, id);
  await interaction.reply({
    ...EPH,
    content: `⚠️ Soll die **komplette Personalakte von ${akte.name}** inkl. aller Einträge und des Forum-Posts wirklich gelöscht werden? Das kann nicht rückgängig gemacht werden.`,
    components: [confirmRow(`akte:delok:${akte.id}`, 'Akte endgültig löschen')],
  });
}

async function akteDeleteConfirm(interaction, id) {
  await requireAccess(interaction);
  await interaction.deferUpdate();
  const akte = await loadAkte(interaction.guildId, id);
  await db.deleteAkte(akte.id);
  const thread = akte.thread_id ? await interaction.client.channels.fetch(akte.thread_id).catch(() => null) : null;
  await thread?.delete(`Personalakte gelöscht von ${interaction.user.tag}`).catch(() => {});
  // Falls der Klick im gelöschten Thread war, existiert die Antwort nicht mehr
  await interaction
    .editReply({ content: `🗑️ Personalakte von **${akte.name}** wurde gelöscht.`, components: [] })
    .catch(() => {});
}

async function cancel(interaction) {
  await interaction.update({ content: 'Abgebrochen.', embeds: [], components: [] });
}

module.exports = {
  panelSelect,
  akteNew,
  entryNew,
  entrySave,
  akteSave,
  findEntry,
  findAkte,
  search,
  entryEditButton,
  entryDeleteButton,
  entryDeleteConfirm,
  akteEditButton,
  akteDeleteButton,
  akteDeleteConfirm,
  cancel,
};
