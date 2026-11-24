'use strict';
// Legt alle Tabellen an (lokal oder in Cloudflare D1). Wird auch von GitHub Actions genutzt.
// Der Bot macht das beim Start ebenfalls automatisch.
const db = require('../src/db');

db.init()
  .then((name) => console.log(`✅ Schema angewendet: ${name}`))
  .catch((err) => {
    console.error('❌ Migration fehlgeschlagen:', err.message);
    process.exit(1);
  });
