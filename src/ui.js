'use strict';
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  LabelBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');
const config = require('./config');
const { TYPES, summary, abteilungName } = require('./categories');

const cut = (s, n) => {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
const ts = (sec, style = 'f') => `<t:${sec}:${style}>`;

class UserError extends Error {}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

const PANEL_OPTIONS = [
  { value: 'akte_neu', label: 'Personalakte anlegen', emoji: '👮', description: 'Neue Akte für einen Beamten erstellen' },
  ...['warn', 'bann', 'meldung', 'positiv', 'negativ'].map((k) => ({
    value: `eintrag:${k}`,
    label: TYPES[k].label,
    emoji: TYPES[k].emoji,
    description: TYPES[k].description,
  })),
  { value: 'bearbeiten', label: 'Eintrag bearbeiten / löschen', emoji: '📝', description: 'Vorhandenen Eintrag über seine Nummer ändern' },
  ...['merkmal', 'dienst', 'ausbildung'].map((k) => ({
    value: `eintrag:${k}`,
    label: TYPES[k].label,
    emoji: TYPES[k].emoji,
    description: TYPES[k].description,
  })),
  { value: 'akte_bearbeiten', label: 'Stammdaten bearbeiten', emoji: '🗂️', description: 'Name, Dienstnummer, Rang usw. ändern' },
  { value: 'suchen', label: 'Akte suchen', emoji: '🔎', description: 'Personalakte finden und öffnen' },
];

function panelMessage() {
  const embed = new EmbedBuilder()
    .setColor(config.brandColor)
    .setTitle(`🚔 ${config.orgName} – Aktenverwaltung`)
    .setDescription(
      [
        'Wähle unten im Menü aus, was du tun möchtest.',
        '',
        '👮 **Personalakte** – eigene Akte für jeden Beamten',
        '⚠️ **Warn** · 🔨 **Bann** · 📢 **Meldung / Info**',
        '✅ **Positive** und ❌ **Negative Einträge**',
        '🔍 **Wichtige Merkmale**',
        '🕒 **Dienstverhalten** · 🎓 **Ausbildungen**',
        '📝 **Bearbeitung** – Einträge jederzeit aktualisieren',
      ].join('\n'),
    )
    .setFooter({ text: '🔒 Zugriff ausschließlich für das Highteam der Polizei' });

  const menu = new StringSelectMenuBuilder()
    .setCustomId('panel:select')
    .setPlaceholder('📂 Aktion auswählen …')
    .addOptions(
      PANEL_OPTIONS.map((o) =>
        new StringSelectMenuOptionBuilder()
          .setValue(o.value)
          .setLabel(o.label)
          .setEmoji(o.emoji)
          .setDescription(o.description),
      ),
    );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

/**
 * Baut ein Modal aus Felddefinitionen.
 * fields: [{ id, label, type: short|paragraph|select, required, max, options, placeholder }]
 */
function buildModal(customId, title, fields, values = {}) {
  const modal = new ModalBuilder().setCustomId(customId).setTitle(cut(title, 45));
  for (const f of fields) {
    const label = new LabelBuilder().setLabel(cut(f.label, 45));
    if (f.description) label.setDescription(cut(f.description, 100));
    const value = values[f.id];
    if (f.type === 'select') {
      const select = new StringSelectMenuBuilder()
        .setCustomId(f.id)
        .setRequired(Boolean(f.required))
        .setMinValues(f.required ? 1 : 0)
        .setMaxValues(1)
        .setPlaceholder('Auswählen …')
        .addOptions(
          f.options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o;
            const option = new StringSelectMenuOptionBuilder()
              .setLabel(cut(opt.label, 100))
              .setValue(opt.value)
              .setDefault(value !== undefined && value !== null && String(value) === opt.value);
            if (opt.description) option.setDescription(cut(opt.description, 100));
            return option;
          }),
        );
      label.setStringSelectMenuComponent(select);
    } else if (f.type === 'user') {
      // Dropdown mit den Mitgliedern des Servers (Discord-eigene Suche)
      const select = new UserSelectMenuBuilder()
        .setCustomId(f.id)
        .setRequired(Boolean(f.required))
        .setMinValues(f.required ? 1 : 0)
        .setMaxValues(1)
        .setPlaceholder('Mitglied auswählen …');
      if (value) select.setDefaultUsers(String(value));
      label.setUserSelectMenuComponent(select);
    } else {
      const input = new TextInputBuilder()
        .setCustomId(f.id)
        .setStyle(f.type === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(Boolean(f.required))
        .setMaxLength(f.max ?? 4000);
      if (f.placeholder) input.setPlaceholder(cut(f.placeholder, 100));
      if (value) input.setValue(cut(value, f.max ?? 4000));
      label.setTextInputComponent(input);
    }
    modal.addLabelComponents(label);
  }
  return modal;
}

/** Liest die Werte eines mit buildModal gebauten Modals aus. */
function readModal(interaction, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'select') {
      out[f.id] = interaction.fields.getStringSelectValues(f.id)?.[0] ?? '';
    } else if (f.type === 'user') {
      out[f.id] = interaction.fields.getSelectedUsers(f.id)?.first()?.id ?? '';
    } else {
      out[f.id] = interaction.fields.getTextInputValue(f.id).trim();
    }
  }
  return out;
}

const BEAMTER_FIELD = {
  id: 'beamter',
  label: 'Beamter',
  description: 'Beamten auf dem Server auswählen',
  type: 'user',
  required: true,
};

/* ------------------------------------------------------------------ */
/* Personalakte (Übersicht = erste Nachricht im Forum-Post)            */
/* ------------------------------------------------------------------ */

/** Name des Forum-Beitrags = Discord-Name des Beamten (ältere Akten ohne Discord: Ingame-Name) */
function threadName(akte) {
  return cut(akte.discord_name || akte.name, 100);
}

function listField(items, max = 1024) {
  if (!items.length) return '—';
  const lines = [];
  let len = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const line = items[i];
    if (len + line.length + 1 > max - 20) {
      lines.unshift(`… und ${i + 1} weitere`);
      break;
    }
    lines.unshift(line);
    len += line.length + 1;
  }
  return lines.join('\n');
}

function akteMessage(akte, entries) {
  const by = (typ) => entries.filter((e) => e.typ === typ);
  const count = (typ) => by(typ).length;

  let color = config.brandColor;
  if (count('bann') > 0) color = TYPES.bann.color;
  else if (count('warn') > 0) color = TYPES.warn.color;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(cut(`👮 Personalakte – ${akte.name}`, 256))
    .setDescription(
      cut(
        [
          `**Discord:** ${akte.discord_id ? `<@${akte.discord_id}>` : '—'}`,
          `**Abteilung:** ${akte.abteilung ? `${akte.abteilung} – ${abteilungName(akte.abteilung)}` : '—'}`,
          akte.dienstnummer ? `**Dienstnummer:** ${akte.dienstnummer}` : '',
          `**Rang:** ${akte.rang || '—'}`,
          `**Ingame-Name:** ${akte.name}`,
          `**Angelegt:** ${ts(akte.created_at, 'D')}${akte.created_by ? ` von <@${akte.created_by}>` : ''}`,
          akte.notiz ? `\n📝 **Beschreibung:**\n${akte.notiz}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        4096,
      ),
    );

  const stats = Object.entries(TYPES)
    .filter(([k]) => k !== 'dienst') // Dienstverhalten steht separat (nur das letzte)
    .map(([k, t]) => `${t.emoji} ${t.label}: **${count(k)}**`)
    .join('\n');
  embed.addFields({ name: '📊 Übersicht', value: stats, inline: true });

  const dienst = by('dienst').at(-1);
  embed.addFields({
    name: '🕒 Dienstverhalten (zuletzt)',
    value: dienst
      ? cut(
          `Aktivität: **${dienst.daten.aktivitaet}/10**\nZuverlässigkeit: **${dienst.daten.zuverlaessigkeit}/10**\nVerhalten: **${dienst.daten.verhalten}/10**\n${ts(dienst.created_at, 'd')} · #${dienst.id}`,
          1024,
        )
      : '—',
    inline: true,
  });

  embed.addFields(
    {
      name: '🎓 Ausbildungen',
      value: listField(by('ausbildung').map((e) => `• ${cut(e.daten.ausbildung, 60)} – ${e.daten.ergebnis} (#${e.id})`)),
    },
    {
      name: '🔍 Wichtige Merkmale',
      value: listField(by('merkmal').map((e) => `• **${e.daten.art}:** ${cut(e.daten.merkmal, 70)} (#${e.id})`)),
    },
    {
      name: '📜 Letzte Einträge',
      value: listField(
        entries
          .slice(-8)
          .map((e) => `\`#${e.id}\` ${TYPES[e.typ]?.emoji ?? ''} ${cut(summary(e), 60)} · ${ts(e.created_at, 'd')}`),
      ),
    },
  );

  embed.setFooter({ text: `Akte #${akte.id} • zuletzt aktualisiert` }).setTimestamp(new Date());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`akte:view:${akte.id}`)
      .setLabel(`Einträge anzeigen (${entries.length})`)
      .setEmoji('📋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`akte:edit:${akte.id}`)
      .setLabel('Stammdaten bearbeiten')
      .setEmoji('🗂️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`akte:del:${akte.id}`)
      .setLabel('Akte löschen')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

/* ------------------------------------------------------------------ */
/* Eintrag (Log-Stil)                                                  */
/* ------------------------------------------------------------------ */

function entryEmbed(entry, akte) {
  const t = TYPES[entry.typ];
  const embed = new EmbedBuilder()
    .setColor(t.color)
    .setAuthor({ name: `${t.emoji} ${t.label} • Eintrag #${entry.id}` })
    .setTitle(cut(`${akte.name}${akte.dienstnummer ? ` (${akte.dienstnummer})` : ''}`, 256));

  for (const f of t.fields) {
    const v = entry.daten[f.id];
    if (!v) continue;
    const value = f.type === 'select' && f.id !== 'art' && /^\d+$/.test(v) ? `${'▰'.repeat(+v)}${'▱'.repeat(10 - v)} **${v}/10**` : v;
    embed.addFields({ name: f.name, value: cut(value, 1024), inline: f.type !== 'paragraph' });
  }

  const meta = [`Erstellt von <@${entry.created_by}> · ${ts(entry.created_at)}`];
  if (entry.updated_at) meta.push(`Bearbeitet von <@${entry.updated_by}> · ${ts(entry.updated_at, 'R')}`);
  embed.addFields({ name: '​', value: meta.join('\n') });
  embed.setFooter({ text: `Akte #${akte.id} • Eintrag #${entry.id}` }).setTimestamp(entry.created_at * 1000);
  return embed;
}

/**
 * Buttons unter einem Eintrag.
 * back = { akteId, typ, page } → Eintrag wird in der Einträge-Ansicht angezeigt (mit „Zurück“)
 */
function entryButtons(entryId, back = null) {
  const v = back ? ':v' : '';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`entry:edit:${entryId}${v}`).setLabel('Bearbeiten').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`entry:del:${entryId}${v}`).setLabel('Löschen').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  if (back) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`view:p:${back.akteId}:${back.typ}:${back.page}`)
        .setLabel('Zurück zur Liste')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Primary),
    );
  }
  return row;
}

function entryMessage(entry, akte) {
  return { embeds: [entryEmbed(entry, akte)], components: [entryButtons(entry.id)] };
}

/* ------------------------------------------------------------------ */
/* Einträge-Ansicht (nur für den Klickenden sichtbar)                  */
/* ------------------------------------------------------------------ */

const PAGE_SIZE = 10;

function entriesView(akte, entries, typ = 'alle', page = 0) {
  if (typ !== 'alle' && !TYPES[typ]) typ = 'alle';
  const list = (typ === 'alle' ? entries : entries.filter((e) => e.typ === typ)).slice().reverse(); // neueste zuerst
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  page = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const slice = list.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const filterName = typ === 'alle' ? 'Alle Einträge' : `${TYPES[typ].emoji} ${TYPES[typ].label}`;
  const embed = new EmbedBuilder()
    .setColor(typ === 'alle' ? config.brandColor : TYPES[typ].color)
    .setTitle(cut(`📋 ${akte.name}${akte.dienstnummer ? ` (${akte.dienstnummer})` : ''} – ${filterName}`, 256))
    .setDescription(
      slice.length
        ? cut(
            slice
              .map(
                (e) =>
                  `\`#${e.id}\` ${TYPES[e.typ]?.emoji ?? ''} **${TYPES[e.typ]?.label ?? e.typ}** – ${cut(summary(e), 70)}\n` +
                  `-# ${ts(e.created_at, 'd')} · von <@${e.created_by}>${e.updated_at ? ' · bearbeitet' : ''}`,
              )
              .join('\n'),
            4096,
          )
        : '*Keine Einträge vorhanden.*',
    )
    .setFooter({ text: `Seite ${page + 1}/${pages} • ${list.length} Einträge • Eintrag unten auswählen zum Öffnen` });

  const counts = Object.fromEntries(Object.keys(TYPES).map((k) => [k, entries.filter((e) => e.typ === k).length]));
  const filter = new StringSelectMenuBuilder()
    .setCustomId(`view:f:${akte.id}`)
    .setPlaceholder('Kategorie filtern …')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setValue('alle')
        .setLabel(`Alle Einträge (${entries.length})`)
        .setEmoji('📋')
        .setDefault(typ === 'alle'),
      ...Object.entries(TYPES).map(([k, t]) =>
        new StringSelectMenuOptionBuilder()
          .setValue(k)
          .setLabel(`${t.label} (${counts[k]})`)
          .setEmoji(t.emoji)
          .setDefault(typ === k),
      ),
    );

  const components = [new ActionRowBuilder().addComponents(filter)];

  if (slice.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`view:o:${akte.id}:${typ}:${page}`)
          .setPlaceholder('🔍 Eintrag öffnen / bearbeiten …')
          .addOptions(
            slice.map((e) =>
              new StringSelectMenuOptionBuilder()
                .setValue(String(e.id))
                .setLabel(cut(`#${e.id} ${TYPES[e.typ]?.label ?? e.typ}`, 100))
                .setDescription(cut(summary(e), 100))
                .setEmoji(TYPES[e.typ]?.emoji ?? '📄'),
            ),
          ),
      ),
    );
  }

  if (pages > 1) {
    components.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`view:p:${akte.id}:${typ}:${page - 1}`)
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('view:x')
          .setLabel(`${page + 1} / ${pages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`view:p:${akte.id}:${typ}:${page + 1}`)
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= pages - 1),
      ),
    );
  }
  return { content: '', embeds: [embed], components };
}

/** Einzelner Eintrag innerhalb der Ansicht */
function entryDetailView(entry, akte, back) {
  return { content: '', embeds: [entryEmbed(entry, akte)], components: [entryButtons(entry.id, back)] };
}

module.exports = {
  UserError,
  cut,
  ts,
  panelMessage,
  buildModal,
  readModal,
  BEAMTER_FIELD,
  threadName,
  akteMessage,
  entryEmbed,
  entryButtons,
  entryMessage,
  entriesView,
  entryDetailView,
};
