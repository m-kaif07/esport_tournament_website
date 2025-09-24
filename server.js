const express = require('express');

// Helper will be added later
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');
const multer = require('multer');   // 👈 Added multer
const admin = require('firebase-admin');
let fcm = null;
try {
  const path = require('path');
  const keyPath = path.resolve(__dirname, 'ak-arena-firebase-adminsdk-fbsvc-1b52bab7f3.json');
  console.log('Attempting to load Firebase Admin SDK key from:', keyPath);
  const serviceAccount = require(keyPath);
  let app;
  if (admin.apps.length === 0) {
    app = admin.initializeApp({credential: admin.credential.cert(serviceAccount)});
    console.log('Firebase Admin initialized');
  } else {
    app = admin.app();
    console.log('Firebase Admin already initialized');
  }
  fcm = admin.messaging(app);
} catch (err) {
  console.warn('Firebase Admin init failed - place ak-arena-firebase-adminsdk-fbsvc-1b52bab7f3.json at project root to enable notifications');
  console.error('Firebase Admin error details:', err);
}

dotenv.config();

const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Ensure uploads dir exists
const uploadDir = process.env.UPLOAD_DIR || path.join('public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'PUT, POST, PATCH, DELETE, GET');
    return res.status(200).json({});
  }
  next();
});

// Static frontend
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Multer + Proof System ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// Upload proofs (admin use karega)
app.post('/upload', upload.array('proofImages', 10), (req, res) => {
  const db = req.app.get('db');
  const auth = req.headers.authorization || '';
  const jwtToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!jwtToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET || 'dev_secret_change_me');
    const userId = decoded.id;

    // Check if user is admin
    db.get('SELECT role FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const now = new Date().toISOString();
      const insertStmt = db.prepare('INSERT INTO proof_images (imagePath, uploadedBy, uploadedAt) VALUES (?, ?, ?)');

      req.files.forEach(file => {
        const imagePath = '/uploads/' + file.filename;
        insertStmt.run(imagePath, userId, now);
      });

      insertStmt.finalize();
      res.redirect('/proof.html');
    });
  } catch (e) {
    console.error('JWT verification failed for upload:', e.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Users ko proofs bhejne wala API
app.get('/proof-data', (req, res) => {
  const db = req.app.get('db');
  db.all('SELECT imagePath FROM proof_images WHERE deletedAt IS NULL ORDER BY uploadedAt DESC', [], (err, rows) => {
    if (err) {
      console.error('Database error fetching proof images:', err);
      return res.status(500).json({ error: 'Failed to fetch images' });
    }
    const images = rows.map(row => row.imagePath);
    res.json({ images });
  });
});

// Delete proof image (admin only)
app.delete('/proof-images/:imagePath', (req, res) => {
  const db = req.app.get('db');
  const auth = req.headers.authorization || '';
  const jwtToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const imagePath = '/' + req.params.imagePath.replace(/^\//, ''); // Ensure starts with /

  if (!jwtToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET || 'dev_secret_change_me');
    const userId = decoded.id;

    // Check if user is admin
    db.get('SELECT role FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const now = new Date().toISOString();
      db.run('UPDATE proof_images SET deletedAt = ? WHERE imagePath = ? AND deletedAt IS NULL',
        [now, imagePath], function(err) {
          if (err) {
            console.error('Database error deleting proof image:', err);
            return res.status(500).json({ error: 'Failed to delete image' });
          }

          if (this.changes === 0) {
            return res.status(404).json({ error: 'Image not found' });
          }

          res.json({ ok: true, message: 'Image deleted successfully' });
        });
    });
  } catch (e) {
    console.error('JWT verification failed for delete:', e.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// Save FCM token
app.post('/save-token', express.json(), (req, res) => {
  const { token } = req.body;
  const auth = req.headers.authorization || '';
  const jwtToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  console.log('Save token request received, token present:', !!token, 'auth present:', !!jwtToken);
  if (!jwtToken) {
    console.warn('Save token failed: No JWT token in authorization header');
    return res.status(401).json({ error: 'No token' });
  }
  try {
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(jwtToken, process.env.JWT_SECRET || 'dev_secret_change_me');
    const userId = decoded.id;
    console.log('Saving FCM token for user ID:', userId, 'token length:', token ? token.length : 0);
    const db = req.app.get('db');
    db.run('UPDATE users SET fcmToken = ? WHERE id = ?', [token, userId], function(err) {
      if (err) {
        console.error('Database error saving FCM token for user', userId, ':', err);
        return res.status(500).json({ error: 'Failed to save token' });
      }
      console.log('FCM token saved successfully for user', userId, 'changes:', this.changes);
      res.json({ ok: true });
    });
  } catch (e) {
    console.error('JWT verification failed for save-token:', e.message);
    return res.status(401).json({ error: 'Invalid token' });
  }
});
// ===============================================================

// Initialize Firebase Admin SDK
// (Initialization is handled above, do not repeat)

// Initialize DB and seed admin
const dbPath = path.join(__dirname, 'db', 'ararena.db');
console.log('DB Path:', dbPath);
require('./db/init')(dbPath).then((db) => {
  app.set('db', db);
  app.set('io', io);
  app.set('fcm', fcm);

  // Routes
  app.use('/api/auth', require('./routes/auth')(db));
  app.use('/api/tournaments', require('./routes/tournaments')(db));
  app.use('/api/admin', require('./routes/admin')(db));

  // Backfill slots for existing tournaments if missing
  db.all('SELECT id, mode, totalSlots FROM tournaments', [], (e1, tours) => {
    if (e1 || !tours) return;
    tours.forEach(t => {
      db.get('SELECT COUNT(*) as c FROM slots WHERE tournamentId = ?', [t.id], (e2, r) => {
        if (e2) return;
        const have = (r && r.c) ? r.c : 0;
        const need = t.totalSlots || 0;
        if (have < need) {
          const nowIso = new Date().toISOString();
          const insert = db.prepare(
            'INSERT INTO slots (tournamentId, slotNumber, status, updatedAt) VALUES (?,?,?,?)'
          );
          for (let i = have + 1; i <= need; i++) insert.run(t.id, i, 'empty', nowIso);
          insert.finalize();
        }
      });
    });
  });

  // Health
  app.get('/api/health', (req,res)=>res.json({ok:true}));

  // Socket.IO basic room subscription
  io.on('connection', (socket) => {
    socket.on('subscribe', (room) => {
      if (typeof room === 'string') socket.join(room);
    });
    socket.on('unsubscribe', (room) => {
      if (typeof room === 'string') socket.leave(room);
    });
  });

  // Unified match notification scheduler
  const notifiedTournaments = new Set();
  setInterval(() => {
    if (!fcm) return; // Skip if FCM not initialized
    const now = new Date();
    const nowIso = now.toISOString();

    db.all('SELECT * FROM tournaments', [], (err, tours) => {
      if (err || !tours) return;
      tours.forEach((t) => {
        const start = new Date(t.dateTime);
        const diffMin = Math.ceil((start.getTime() - now.getTime()) / 60000);

        // Registered users: one-time alerts at 30/10/5/2 minutes before start
        const notifyWindows = [30, 10, 5, 2];
        if (diffMin >= 0 && notifyWindows.includes(diffMin)) {
          const key = `reg-${diffMin}-${t.id}`;
          if (!notifiedTournaments.has(key)) {
            notifiedTournaments.add(key);
            db.all('SELECT u.fcmToken FROM registrations r JOIN users u ON r.userId = u.id WHERE r.tournamentId = ? AND u.fcmToken IS NOT NULL', [t.id], (e2, regs) => {
              if (e2 || !regs || regs.length === 0) return;
              const tokens = regs.map(r => r.fcmToken).filter(Boolean);
              if (tokens.length === 0) return;
              const message = {
                tokens,
                notification: {
                  title: 'Match Reminder',
                  body: `Your tournament "${t.title}" starts in ${diffMin} minute${diffMin === 1 ? '' : 's'}.`
                }
              };
              fcm.sendEach(tokens.map(token => ({ token, notification: message.notification }))).catch(console.error);
            });
          }
        }

        // Unregistered users: one-time alert at 5 minutes before start with remaining slots
        if (diffMin === 5) {
          const keyU = `unreg5-${t.id}`;
          if (!notifiedTournaments.has(keyU)) {
            notifiedTournaments.add(keyU);
            // Compute remaining slots from slots table
            db.get('SELECT COUNT(*) as filled FROM slots WHERE tournamentId = ? AND status IN ("reserved","confirmed")', [t.id], (e3, row) => {
              const filled = row && row.filled ? row.filled : 0;
              const remaining = Math.max(0, (t.totalSlots || 0) - filled);
              // Find users not registered for this tournament
              db.all('SELECT u.fcmToken FROM users u WHERE u.fcmToken IS NOT NULL AND u.id NOT IN (SELECT r.userId FROM registrations r WHERE r.tournamentId = ?)', [t.id], (e4, users) => {
                if (e4 || !users || users.length === 0) return;
                const tokens = users.map(u => u.fcmToken).filter(Boolean);
                if (tokens.length === 0) return;
                const message = {
                  tokens,
                  notification: {
                    title: 'Tournament Starting Soon',
                    body: `"${t.title}" starts in 5 minutes. ${remaining} slot${remaining === 1 ? '' : 's'} left. Register now!`
                  }
                };
                fcm.sendEach(tokens.map(token => ({ token, notification: message.notification }))).catch(console.error);
              });
            });
          }
        }
      });
    });
  }, 60000); // every minute

  // Start server


// Helper: send notifications to tokens via FCM (if initialized)
async function sendToTokens(tokens, title, body) {
  if (!fcm) { console.warn('FCM not initialized; skipping send'); return; }
  if (!tokens || tokens.length === 0) return;
  const messages = tokens.map(token => ({ token, notification: { title, body } }));
  try {
    const resp = await fcm.sendEach(messages);
    console.log(`Notifications sent: ${resp.successCount}/${tokens.length}`);
    resp.responses.forEach((r, i) => {
      if (!r.success) console.warn('Token failed:', tokens[i], r.error && r.error.code);
    });
  } catch (err) { console.error('sendToTokens error', err); }
}


// Public endpoint to save FCM tokens (anonymous subscribers)
app.post('/save-token-public', express.json(), (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Missing token' });
  const db = req.app.get('db');
  const now = new Date().toISOString();
  db.run('CREATE TABLE IF NOT EXISTS fcm_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, token TEXT UNIQUE, createdAt TEXT)');
  db.run('INSERT OR IGNORE INTO fcm_tokens (token, createdAt) VALUES (?,?)', [token, now], (err) => {
    if (err) {
      console.error('Failed to save public token', err);
      return res.status(500).json({ error: 'DB error' });
    }
    return res.json({ ok: true });
  });
});
server.listen(PORT, '0.0.0.0', () => {
    console.log(`ARArena server running on http://localhost:${PORT} and http://0.0.0.0:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
