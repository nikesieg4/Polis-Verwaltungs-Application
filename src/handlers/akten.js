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
  entryMessage,
  entriesView,
  entryDetailView,
} = require('../ui');

const EPH = { flags: MessageFlags.Ephemeral };

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

/** Akte des im Dropdown gewählten Discord-Mitglieds */
async function akteForMember(guildId, userId) {
  if (!userId) throw new UserError('Bitte einen Beamten auswählen.');
  const akte = await db.findAkteByDiscord(guildId, userId);
  if (!akte) {
    throw new UserError(
      `Für <@${userId}> gibt es noch keine Personalakte. Lege sie zuerst über **👮 Personalakte anlegen** an ` +
        '(bei älteren Akten: Discord-Mitglied über **Stammdaten bearbeiten** in der Akte zuordnen).',
    );
  }
  return akte;
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
  // Discord-Namen aktuell halten (Name des Forum-Beitrags)
  if (akte.discord_id) {
    const member = await thread.guild.members.fetch(akte.discord_id).catch(() => null);
    if (member && member.displayName !== akte.discord_name) {
      akte.discord_name = member.displayName;
      await db.setDiscordName(akte.id, member.displayName);
    }
  }
  const entries = await db.listEntries(akte.id);
  const starter = await thread.fetchStarterMessage().catch(() => null);
  if (starter) await starter.edit(akteMessage(akte, entries));
  const name = threadName(akte);
  if (thread.name !== name) await thread.setName(name).catch(() => {});
}

/** Formularwerte der Stammdaten prüfen + aktuellen Discord-Namen des Beamten ermitteln */
async function parseAkteInput(interaction, values, currentId = null) {
  const data = { ...values };
  if (!data.discord_id) throw new UserError('Bitte den Beamten (Discord) auswählen.');
  if (!data.abteilung) throw new UserError('Bitte eine Abteilung auswählen.');

  const member = await interaction.guild.members.fetch(data.discord_id).catch(() => null);
  if (!member) throw new UserError('Dieses Mitglied ist nicht (mehr) auf dem Server.');
  if (member.user.bot) throw new UserError('Für Bots kann keine Personalakte angelegt werden.');
  data.discord_name = member.displayName;

  const sameUser = await db.findAkteByDiscord(interaction.guildId, data.discord_id);
  if (sameUser && sameUser.id !== currentId) {
    throw new UserError(`<@${data.discord_id}> hat bereits eine Personalakte: <#${sameUser.thread_id}>`);
  }
  data.dienstnummer = data.dienstnummer || null;
  const sameDn = data.dienstnummer
    ? await db.findAkteByDienstnummer(interaction.guildId, data.abteilung, data.dienstnummer)
    : null;
  if (sameDn && sameDn.id !== currentId) {
    throw new UserError(
      `Die Dienstnummer **[${data.abteilung}|${data.dienstnummer}]** gehört bereits zur Akte von **${sameDn.name}**.`,
    );
  }
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
          {
            id: 'suche',
            label: 'Suche',
            description: 'Ingame-Name, Discord-Name, Dienstnummer oder z. B. 15|04',
            type: 'short',
            required: true,
            max: 80,
          },
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
  const data = await parseAkteInput(interaction, readModal(interaction, AKTE_FIELDS));

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
    await interaction.editReply(`✅ Personalakte für <@${akte.discord_id}> angelegt: <#${thread.id}>`);
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
  const akte = await akteForMember(interaction.guildId, values.beamter);
  delete values.beamter;
  validateEntry(typ, values);

  const thread = await getThread(interaction.client, akte);
  const entryId = await db.createEntry(akte, typ, values, interaction.user.id);
  await refreshAkte(interaction.client, akte.id);
  await interaction.editReply(
    `✅ ${TYPES[typ].emoji} **${TYPES[typ].label}** (Eintrag #${entryId}) zur Akte von **${akte.name}** hinzugefügt: <#${thread.id}>\n` +
      '-# Ansehen über den Button „📋 Einträge anzeigen“ in der Akte.',
  );
}

async function entrySave(interaction, id, flag) {
  await requireAccess(interaction);
  const inView = flag === 'v' && interaction.isFromMessage();
  if (inView) await interaction.deferUpdate();
  else await interaction.deferReply(EPH);

  const entry = await loadEntry(interaction.guildId, id);
  const akte = await loadAkte(interaction.guildId, entry.akte_id);
  const values = validateEntry(entry.typ, readModal(interaction, TYPES[entry.typ].fields));

  await db.updateEntry(entry.id, values, interaction.user.id);
  const updated = await db.getEntry(entry.id);
  // Alte Einträge aus früheren Versionen, die noch als Nachricht existieren, mit aktualisieren
  const thread = await getThread(interaction.client, akte);
  if (updated.message_id) {
    const msg = await thread.messages.fetch(updated.message_id).catch(() => null);
    if (msg) await msg.edit(entryMessage(updated, akte)).catch(() => {});
  }
  await refreshAkte(interaction.client, akte.id);

  if (inView) {
    const view = entryDetailView(updated, akte, { akteId: akte.id, typ: 'alle', page: 0 });
    await interaction.editReply({ ...view, content: `✅ Eintrag #${entry.id} wurde aktualisiert.` });
  } else {
    await interaction.editReply(`✅ Eintrag #${entry.id} wurde aktualisiert: <#${thread.id}>`);
  }
}

async function akteSave(interaction, id) {
  await requireAccess(interaction);
  await interaction.deferReply(EPH);
  const akte = await loadAkte(interaction.guildId, id);
  const data = await parseAkteInput(interaction, readModal(interaction, AKTE_FIELDS), akte.id);
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
  await interaction.reply({ ...EPH, ...entryDetailView(entry, akte, { akteId: akte.id, typ: 'alle', page: 0 }) });
}

async function findAkte(interaction) {
  await requireAccess(interaction);
  const akte = await akteForMember(interaction.guildId, readModal(interaction, [BEAMTER_FIELD]).beamter);
  await interaction.reply({
    ...EPH,
    content: `🗂️ Personalakte von **${akte.name}** – ${akte.thread_id ? `<#${akte.thread_id}>` : ''}`,
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
        .map(
          (a) =>
            `• ${a.thread_id ? `<#${a.thread_id}>` : `**${a.name}**`} · ${a.discord_id ? `<@${a.discord_id}>` : ''} · ${a.rang || '—'}`,
        )
        .join('\n'),
    );
  await interaction.reply({ ...EPH, embeds: [embed] });
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

async function entryEditButton(interaction, id, flag) {
  await requireAccess(interaction);
  const entry = await loadEntry(interaction.guildId, id);
  const t = TYPES[entry.typ];
  await interaction.showModal(
    buildModal(`entry:save:${entry.id}${flag === 'v' ? ':v' : ''}`, `📝 ${t.label} #${entry.id} bearbeiten`, t.fields, entry.daten),
  );
}

async function entryDeleteButton(interaction, id, flag) {
  await requireAccess(interaction);
  const entry = await loadEntry(interaction.guildId, id);
  const question = `Soll **${TYPES[entry.typ].emoji} ${TYPES[entry.typ].label} #${entry.id}** („${cut(summary(entry), 80)}“) wirklich gelöscht werden?`;
  if (flag === 'v') {
    // innerhalb der Einträge-Ansicht: dieselbe Nachricht ersetzen, „Abbrechen“ führt zurück zum Eintrag
    await interaction.update({
      content: question,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`entry:delok:${entry.id}:v`).setLabel('Endgültig löschen').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`view:o:${entry.akte_id}:alle:0:${entry.id}`).setLabel('Abbrechen').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    return;
  }
  await interaction.reply({
    ...EPH,
    content: question,
    components: [confirmRow(`entry:delok:${entry.id}`, 'Endgültig löschen')],
  });
}

async function entryDeleteConfirm(interaction, id, flag) {
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
  if (flag === 'v') {
    const view = entriesView(akte, await db.listEntries(akte.id), 'alle', 0);
    await interaction.editReply({ ...view, content: `🗑️ Eintrag #${entry.id} wurde gelöscht.` });
  } else {
    await interaction.editReply({ content: `🗑️ Eintrag #${entry.id} wurde gelöscht.`, embeds: [], components: [] });
  }
}

/* ------------------------------------------------------------------ */
/* Einträge-Ansicht                                                    */
/* ------------------------------------------------------------------ */

/** Button „📋 Einträge anzeigen“ in der Akte */
async function akteViewButton(interaction, akteId) {
  await requireAccess(interaction);
  const akte = await loadAkte(interaction.guildId, akteId);
  await interaction.reply({ ...EPH, ...entriesView(akte, await db.listEntries(akte.id)) });
}

/** Filter-Menü, Blättern-Buttons, Eintrag öffnen (customId: view:<f|p|o>:<akteId>:<typ>:<seite>[:<eintrag>]) */
async function viewInteraction(interaction, parts) {
  await requireAccess(interaction);
  const [, action, akteId, typ = 'alle', page = '0', entryId] = parts;
  const akte = await loadAkte(interaction.guildId, akteId);
  const entries = await db.listEntries(akte.id);

  if (action === 'f') return interaction.update(entriesView(akte, entries, interaction.values[0], 0));
  if (action === 'p') return interaction.update(entriesView(akte, entries, typ, page));
  if (action === 'o') {
    const id = entryId ?? interaction.values?.[0];
    const entry = entries.find((e) => String(e.id) === String(id));
    if (!entry) return interaction.update({ ...entriesView(akte, entries, typ, page), content: '❌ Dieser Eintrag existiert nicht mehr.' });
    return interaction.update(entryDetailView(entry, akte, { akteId: akte.id, typ, page }));
  }
}

/**
 * Einmalige Umstellung: Einträge wurden früher als Nachrichten unter die Akte gepostet.
 * Diese Nachrichten werden entfernt (Daten bleiben in der Datenbank) und alle Übersichten bekommen den neuen Button.
 */
async function migrateEntriesToView(client) {
  const KEY = 'entries_view_v1';
  if (await db.getMeta(KEY)) return;
  const akten = await db.allAkten();
  let removed = 0;
  for (const akte of akten) {
    if (!client.guilds.cache.has(akte.guild_id)) continue;
    try {
      const entries = await db.listEntries(akte.id);
      const withMsg = entries.filter((e) => e.message_id);
      const thread = akte.thread_id ? await client.channels.fetch(akte.thread_id).catch(() => null) : null;
      if (!thread) continue;
      if (thread.archived) await thread.setArchived(false).catch(() => {});
      for (const e of withMsg) {
        const m = await thread.messages.fetch(e.message_id).catch(() => null);
        if (m) {
          await m.delete().catch(() => {});
          removed++;
        }
        await db.setEntryMessage(e.id, null);
      }
      await refreshAkte(client, akte.id);
    } catch (err) {
      console.error(`[Umstellung] Akte #${akte.id}:`, err.message);
    }
  }
  await db.setMeta(KEY, String(db.now()));
  console.log(`✅ Umstellung: ${akten.length} Akten aktualisiert, ${removed} alte Eintrags-Nachrichten entfernt`);
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
  akteViewButton,
  viewInteraction,
  migrateEntriesToView,
  cancel,
};
