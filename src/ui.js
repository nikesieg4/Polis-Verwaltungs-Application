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
} = require('discord.js');
const config = require('./config');
const { TYPES, summary } = require('./categories');

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
  ...['merkmal', 'problem', 'dienst', 'ausbildung'].map((k) => ({
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
        '⚠️ **Warn** · 🔨 **Bann** · 📢 **Meldung**',
        '✅ **Positive** und ❌ **Negative Einträge**',
        '🔍 **Wichtige Merkmale** · 🚨 **Probleme**',
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
          f.options.map((o) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(o)
              .setValue(o)
              .setDefault(value !== undefined && String(value) === o),
          ),
        );
      label.setStringSelectMenuComponent(select);
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
    } else {
      out[f.id] = interaction.fields.getTextInputValue(f.id).trim();
    }
  }
  return out;
}

const BEAMTER_FIELD = {
  id: 'beamter',
  label: 'Beamter',
  description: 'Dienstnummer oder Ingame-Name des Beamten',
  type: 'short',
  required: true,
  max: 80,
};

/* ------------------------------------------------------------------ */
/* Personalakte (Übersicht = erste Nachricht im Forum-Post)            */
/* ------------------------------------------------------------------ */

function threadName(akte) {
  return cut(`${akte.dienstnummer ? `[${akte.dienstnummer}] ` : ''}${akte.name}`, 100);
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
          `**Dienstnummer:** ${akte.dienstnummer || '—'}`,
          `**Rang:** ${akte.rang || '—'}`,
          `**Discord:** ${akte.discord_id ? `<@${akte.discord_id}>` : '—'}`,
          `**Angelegt:** ${ts(akte.created_at, 'D')}${akte.created_by ? ` von <@${akte.created_by}>` : ''}`,
          akte.notiz ? `\n📌 **Notiz:**\n${akte.notiz}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        4096,
      ),
    );

  const stats = Object.entries(TYPES)
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
      name: '🚨 Probleme',
      value: listField(
        by('problem').map((e) => `• ${cut(e.daten.problem, 60)} – *${e.daten.status}* (#${e.id})`),
      ),
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

function entryButtons(entryId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`entry:edit:${entryId}`).setLabel('Bearbeiten').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`entry:del:${entryId}`).setLabel('Löschen').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
}

function entryMessage(entry, akte) {
  return { embeds: [entryEmbed(entry, akte)], components: [entryButtons(entry.id)] };
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
};
