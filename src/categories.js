'use strict';
// Alle Eintragsarten einer Personalakte.
// Feldtypen: short | paragraph | select   (max. 4 Felder, das 5. Modal-Feld ist der Beamte)

const score = (id, name) => ({
  id,
  name,
  label: `${name} (1–10)`,
  type: 'select',
  required: true,
  options: Array.from({ length: 10 }, (_, i) => String(10 - i)),
});

const TYPES = {
  warn: {
    label: 'Warn',
    emoji: '⚠️',
    color: 0xf59e0b,
    description: 'Verwarnung dokumentieren',
    fields: [
      { id: 'grund', name: 'Grund', label: 'Grund', type: 'short', required: true, max: 200 },
      { id: 'details', name: 'Details', label: 'Details / Vorfall', type: 'paragraph', max: 1500 },
      { id: 'dauer', name: 'Gültig bis / Dauer', label: 'Gültig bis / Dauer', type: 'short', max: 100 },
    ],
  },
  bann: {
    label: 'Bann',
    emoji: '🔨',
    color: 0xdc2626,
    description: 'Sperre und Grund festhalten',
    fields: [
      { id: 'grund', name: 'Grund', label: 'Grund', type: 'short', required: true, max: 200 },
      { id: 'dauer', name: 'Dauer', label: 'Dauer (z. B. 7 Tage, permanent)', type: 'short', required: true, max: 100 },
      { id: 'details', name: 'Details', label: 'Details', type: 'paragraph', max: 1500 },
    ],
  },
  meldung: {
    label: 'Meldung / Info',
    emoji: '📢',
    color: 0x3b82f6,
    description: 'Beschwerden, Vorfälle und Infos eintragen',
    fields: [
      { id: 'art', name: 'Art', label: 'Art', type: 'select', required: true, options: ['Meldung', 'Info'] },
      { id: 'betreff', name: 'Betreff', label: 'Betreff', type: 'short', required: true, max: 200 },
      { id: 'beschreibung', name: 'Beschreibung', label: 'Beschreibung', type: 'paragraph', required: true, max: 1500 },
      { id: 'melder', name: 'Gemeldet von / Beteiligte', label: 'Gemeldet von / Beteiligte', type: 'short', max: 200 },
    ],
  },
  positiv: {
    label: 'Positiver Eintrag',
    emoji: '✅',
    color: 0x16a34a,
    description: 'Gute Leistung dokumentieren',
    fields: [
      { id: 'titel', name: 'Titel', label: 'Titel', type: 'short', required: true, max: 200 },
      { id: 'beschreibung', name: 'Beschreibung', label: 'Beschreibung', type: 'paragraph', max: 1500 },
    ],
  },
  negativ: {
    label: 'Negativer Eintrag',
    emoji: '❌',
    color: 0xb91c1c,
    description: 'Fehlverhalten festhalten',
    fields: [
      { id: 'titel', name: 'Titel', label: 'Titel', type: 'short', required: true, max: 200 },
      { id: 'beschreibung', name: 'Beschreibung', label: 'Beschreibung', type: 'paragraph', max: 1500 },
    ],
  },
  merkmal: {
    label: 'Wichtiges Merkmal',
    emoji: '🔍',
    color: 0x8b5cf6,
    description: 'Fähigkeiten, Stärken, Auffälligkeiten',
    fields: [
      { id: 'merkmal', name: 'Merkmal', label: 'Merkmal', type: 'short', required: true, max: 200 },
      {
        id: 'art',
        name: 'Art',
        label: 'Art',
        type: 'select',
        required: true,
        options: ['Fähigkeit', 'Stärke', 'Auffälligkeit', 'Sonstiges'],
      },
      { id: 'beschreibung', name: 'Beschreibung', label: 'Beschreibung', type: 'paragraph', max: 1500 },
    ],
  },
  dienst: {
    label: 'Dienstverhalten',
    emoji: '🕒',
    color: 0x0ea5e9,
    description: 'Aktivität, Zuverlässigkeit, Verhalten',
    fields: [
      score('aktivitaet', 'Aktivität'),
      score('zuverlaessigkeit', 'Zuverlässigkeit'),
      score('verhalten', 'Verhalten im Dienst'),
      { id: 'bemerkung', name: 'Bemerkung', label: 'Bemerkung', type: 'paragraph', max: 1500 },
    ],
  },
  ausbildung: {
    label: 'Ausbildung',
    emoji: '🎓',
    color: 0x14b8a6,
    description: 'Schulungen, Prüfungen, Qualifikationen',
    fields: [
      { id: 'ausbildung', name: 'Ausbildung', label: 'Schulung / Prüfung / Qualifikation', type: 'short', required: true, max: 200 },
      {
        id: 'ergebnis',
        name: 'Ergebnis',
        label: 'Ergebnis',
        type: 'select',
        required: true,
        options: ['Bestanden', 'Nicht bestanden', 'Teilgenommen', 'Ausstehend'],
      },
      { id: 'pruefer', name: 'Ausbilder / Prüfer', label: 'Ausbilder / Prüfer', type: 'short', max: 100 },
      { id: 'bemerkung', name: 'Bemerkung', label: 'Bemerkung', type: 'paragraph', max: 1000 },
    ],
  },
};

// Abteilungen (Nummer erscheint im Namen des Forum-Beitrags: LPB [15|DN] Name)
const ABTEILUNGEN = [
  { id: '15', name: 'Polizei' },
  { id: '20', name: 'Kripo' },
  { id: '25', name: 'SEK' },
];
const abteilungName = (id) => ABTEILUNGEN.find((a) => a.id === String(id))?.name ?? '';

// Stammdaten der Personalakte (max. 5 Felder pro Formular, Reihenfolge = Reihenfolge im Formular)
const AKTE_FIELDS = [
  {
    id: 'discord_id',
    name: 'Discord',
    label: 'Beamter (Discord)',
    description: 'Person auf dem Server auswählen',
    type: 'user',
    required: true,
  },
  {
    id: 'abteilung',
    name: 'Abteilung',
    label: 'Abteilung',
    type: 'select',
    required: true,
    options: ABTEILUNGEN.map((a) => ({ value: a.id, label: `${a.id} – ${a.name}` })),
  },
  { id: 'rang', name: 'Rang', label: 'Rang', type: 'short', required: true, max: 60 },
  { id: 'name', name: 'Ingame-Name', label: 'Ingame-Name', type: 'short', required: true, max: 80 },
  {
    id: 'notiz',
    name: 'Beschreibung',
    label: 'Beschreibung',
    description: 'Kurze Beschreibung des Beamten',
    type: 'paragraph',
    max: 1500,
  },
];

/** Kurztext eines Eintrags (für Listen) */
function summary(entry) {
  const t = TYPES[entry.typ];
  if (!t) return entry.typ;
  const d = entry.daten;
  if (entry.typ === 'dienst') return `A ${d.aktivitaet}/10 · Z ${d.zuverlaessigkeit}/10 · V ${d.verhalten}/10`;
  if (entry.typ === 'ausbildung') return `${d.ausbildung} – ${d.ergebnis}`;
  if (entry.typ === 'meldung') return `${d.art ? `[${d.art}] ` : ''}${d.betreff}`;
  if (entry.typ === 'bann') return `${d.grund} (${d.dauer})`;
  const first = t.fields[0];
  return d[first.id] || '—';
}

module.exports = { TYPES, AKTE_FIELDS, ABTEILUNGEN, abteilungName, summary };
