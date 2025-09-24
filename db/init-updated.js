const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

module.exports = async function init(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        db.run('PRAGMA foreign_keys = ON');

        // helper: safely add a column if missing
        function safeAddColumn(table, colDef) {
          db.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`, (err) => {
            if (err && !String(err).includes("duplicate column name")) {
              console.error(`Migration error on ${table}:`, err.message);
            }
          });
        }

        // Ensure tournaments table
        db.run(`CREATE TABLE IF NOT EXISTS tournaments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          bannerPath TEXT,
          qrPath TEXT,
          dateTime TEXT NOT NULL,
          map TEXT NOT NULL,
          mode TEXT NOT NULL, -- Solo | Duo | Squad
          totalSlots INTEGER NOT NULL,
          roomId TEXT,
          roomPassword TEXT,
          createdAt TEXT NOT NULL
        )`);

        // Ensure registrations table
        db.run(`CREATE TABLE IF NOT EXISTS registrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER NOT NULL,
          tournamentId INTEGER NOT NULL,
          slotNumber INTEGER,
          phone TEXT,
          ingame_name TEXT,
          ingame_uid TEXT,
          phonepe_number TEXT,
          utr TEXT,
          createdAt TEXT NOT NULL,
          UNIQUE(userId, tournamentId),
          FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY(tournamentId) REFERENCES tournaments(id) ON DELETE CASCADE
        )`);

        // Ensure slots table
        db.run(`CREATE TABLE IF NOT EXISTS slots (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tournamentId INTEGER NOT NULL,
          slotNumber INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'empty', -- empty | reserved | confirmed
          p1 TEXT,
          p2 TEXT,
          p3 TEXT,
          p4 TEXT,
          updatedAt TEXT NOT NULL,
          UNIQUE(tournamentId, slotNumber),
          FOREIGN KEY(tournamentId) REFERENCES tournaments(id) ON DELETE CASCADE
        )`);

        // Ensure users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          phone TEXT,
          passwordHash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'user',
          fcmToken TEXT,
          createdAt TEXT NOT NULL
        )`);

        // Ensure earnings table
        db.run(`CREATE TABLE IF NOT EXISTS earnings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER NOT NULL,
          amount INTEGER NOT NULL,
          description TEXT NOT NULL,
          dateTime TEXT NOT NULL,
          FOREIGN KEY(userId) REFERENCES users(id) ON DELETE CASCADE
        )`);

        // Ensure proof_images table for persistent storage
        db.run(`CREATE TABLE IF NOT EXISTS proof_images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          imagePath TEXT NOT NULL UNIQUE,
          uploadedBy INTEGER,
          uploadedAt TEXT NOT NULL,
          deletedAt TEXT,
          FOREIGN KEY(uploadedBy) REFERENCES users(id) ON DELETE SET NULL
        )`);

        // Auto-migrate columns (safe, idempotent)
        db.all("PRAGMA table_info(tournaments)", [], (e1, cols) => {
          if (!e1) {
            const names = (cols || []).map(c => c.name);
            // Add monetization and winners related columns if missing
            if (!names.includes('fee')) safeAddColumn("tournaments", "fee INTEGER DEFAULT 0");
            if (!names.includes('prizePool')) safeAddColumn("tournaments", "prizePool INTEGER DEFAULT 0");
            if (!names.includes('roomId')) safeAddColumn("tournaments", "roomId TEXT");
            if (!names.includes('roomPassword')) safeAddColumn("tournaments", "roomPassword TEXT");
            if (!names.includes('qrPath')) safeAddColumn("tournaments", "qrPath TEXT");
            if (!names.includes('prize1')) safeAddColumn("tournaments", "prize1 INTEGER DEFAULT 0");
            if (!names.includes('prize2')) safeAddColumn("tournaments", "prize2 INTEGER DEFAULT 0");
            if (!names.includes('prize3')) safeAddColumn("tournaments", "prize3 INTEGER DEFAULT 0");
            if (!names.includes('winner1Id')) safeAddColumn("tournaments", "winner1Id INTEGER");
            if (!names.includes('winner2Id')) safeAddColumn("tournaments", "winner2Id INTEGER");
            if (!names.includes('winner3Id')) safeAddColumn("tournaments", "winner3Id INTEGER");
            // New: game column for multi-game support
            if (!names.includes('game')) {
              db.run("ALTER TABLE tournaments ADD COLUMN game TEXT", (err) => {
                if (err && !String(err).includes('duplicate column name')) {
                  console.error('Migration error adding game column:', err.message);
                }
                // Backfill after ensuring column exists
                db.run("UPDATE tournaments SET game = 'Free Fire' WHERE game IS NULL OR game = ''");
              });
            } else {
              // Ensure backfill on existing DBs
              db.run("UPDATE tournaments SET game = 'Free Fire' WHERE game IS NULL OR game = ''");
            }
          }
        });

        db.all("PRAGMA table_info(registrations)", [], (e2, cols) => {
          if (!e2) {
            const names = (cols || []).map(c => c.name);
            if (!names.includes('ingame_name')) safeAddColumn("registrations", "ingame_name TEXT");
            if (!names.includes('ingame_uid')) safeAddColumn("registrations", "ingame_uid TEXT");
            if (!names.includes('paid')) safeAddColumn("registrations", "paid INTEGER DEFAULT 0");
            if (!names.includes('paymentId')) safeAddColumn("registrations", "paymentId TEXT");
            if (!names.includes('paymentSignature')) safeAddColumn("registrations", "paymentSignature TEXT");
            if (!names.includes('phonepe_number')) safeAddColumn("registrations", "phonepe_number TEXT");
            if (!names.includes('teammatesJson')) safeAddColumn("registrations", "teammatesJson TEXT");
            if (!names.includes('teamSize')) safeAddColumn("registrations", "teamSize INTEGER DEFAULT 1");
            if (!names.includes('utr')) safeAddColumn("registrations", "utr TEXT");
            if (!names.includes('slotNumber')) safeAddColumn("registrations", "slotNumber INTEGER");
            // Partial unique index to prevent duplicate non-empty UTR values
            db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_utr_unique ON registrations(utr) WHERE utr IS NOT NULL AND utr <> ''");
          }
        });

        // Auto-migrate slots table columns if needed
        db.all("PRAGMA table_info(slots)", [], (e3, cols) => {
          if (!e3) {
            const names = (cols || []).map(c => c.name);
            if (!names.includes('status')) safeAddColumn('slots', "status TEXT NOT NULL DEFAULT 'empty'");
            if (!names.includes('p1')) safeAddColumn('slots', 'p1 TEXT');
            if (!names.includes('p2')) safeAddColumn('slots', 'p2 TEXT');
            if (!names.includes('p3')) safeAddColumn('slots', 'p3 TEXT');
            if (!names.includes('p4')) safeAddColumn('slots', 'p4 TEXT');
            if (!names.includes('updatedAt')) safeAddColumn('slots', 'updatedAt TEXT NOT NULL DEFAULT ""');
          }
        });

        db.all("PRAGMA table_info(users)", [], (e4, cols) => {
          if (!e4) {
            const names = (cols || []).map(c => c.name);
            if (!names.includes('fcmToken')) safeAddColumn('users', 'fcmToken TEXT');
            if (!names.includes('profilePic')) safeAddColumn('users', 'profilePic TEXT');
            if (!names.includes('resetToken')) safeAddColumn('users', 'resetToken TEXT');
            if (!names.includes('resetExpires')) safeAddColumn('users', 'resetExpires TEXT');
          }
        });

        // Seed admin if missing
        const adminEmail = 'skillzmatteresports@gmail.com';
        const adminPass = 'Abuzarsk@8888555629';
        db.get('SELECT id FROM users WHERE email = ?', [adminEmail], async (err, row) => {
          if (err) return reject(err);
          if (!row) {
            const hash = await bcrypt.hash(adminPass, 10);
            const now = new Date().toISOString();
            db.run(
              'INSERT INTO users (username, email, phone, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?)',
              ['admin', adminEmail, '0000000000', hash, 'admin', now],
              (err2) => {
                if (err2) return reject(err2);
                console.log('Seeded default admin:', adminEmail);
                db.run(`CREATE TABLE IF NOT EXISTS fcm_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, createdAt TEXT)`);
  resolve(db);
              }
            );
          } else {
            db.run(`CREATE TABLE IF NOT EXISTS fcm_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, createdAt TEXT)`);
  resolve(db);
          }
        });
      });
    });
  });
};
