const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'db', 'ararena.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open DB:', err.message);
    process.exit(1);
  }
});

function run(sql) {
  return new Promise((resolve) => db.run(sql, () => resolve()));
}

(async () => {
  try {
    console.log('Running UTR migration on', dbPath);
    try { await run("ALTER TABLE registrations ADD COLUMN utr TEXT"); } catch {}
    try { await run("ALTER TABLE registrations ADD COLUMN slotNumber INTEGER"); } catch {}
    try { await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_utr_unique ON registrations(utr) WHERE utr IS NOT NULL AND utr <> ''"); } catch {}
    console.log('Migration done');
  } catch (e) {
    console.error('Migration error:', e && e.message ? e.message : e);
  } finally {
    db.close();
  }
})();
