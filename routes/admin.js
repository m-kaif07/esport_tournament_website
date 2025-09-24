const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authRequired, adminOnly } = require('../middleware/auth');

const uploadDir = process.env.UPLOAD_DIR || path.join('public', 'uploads');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const unique = Date.now() + '-' + safe;
    cb(null, unique);
  }
});
const upload = multer({ storage });

function defaultSlotsFor(game, mode) {
  // PUBG: Solo 100, Duo 50, Squad 25
  // Free Fire: Solo 48, Duo 24, Squad 12
  const g = String(game || 'Free Fire');
  if (g === 'PUBG') {
    if (mode === 'Duo') return 50;
    if (mode === 'Squad') return 25;
    return 100; // Solo
  } else {
    if (mode === 'Duo') return 24;
    if (mode === 'Squad') return 12;
    return 48; // Solo
  }
}

module.exports = function(db) {
  const router = express.Router();

  // Set winner (rank 1,2,3) for a tournament, add earning, and send formal notification
  router.post('/tournaments/:id/winner', authRequired, adminOnly, (req, res) => {
    const tournamentId = req.params.id;
    const { userId, rank } = req.body;
    const rankNum = parseInt(rank || 1, 10);
    if (!userId || ![1,2,3].includes(rankNum)) return res.status(400).json({ error: 'userId and rank (1,2,3) required' });
    // Get tournament
    db.get('SELECT * FROM tournaments WHERE id = ?', [tournamentId], (err, tournament) => {
      if (err || !tournament) return res.status(404).json({ error: 'Tournament not found' });
      // Check if user is registered for this tournament
      db.get('SELECT r.*, u.fcmToken, u.username FROM registrations r JOIN users u ON r.userId = u.id WHERE r.tournamentId = ? AND r.userId = ?', [tournamentId, userId], (err2, reg) => {
        if (err2) return res.status(500).json({ error: 'Failed to get registration' });
        if (!reg) return res.status(400).json({ error: 'User not registered for this tournament' });
        // Save winner in tournaments table (idempotent rank assignment)
        const winnerField = rankNum === 1 ? 'winner1Id' : rankNum === 2 ? 'winner2Id' : 'winner3Id';
        const existingWinnerId = tournament[winnerField];
        if (existingWinnerId && existingWinnerId !== userId) {
          return res.status(409).json({ error: `Rank ${rankNum} already assigned to another user` });
        }
        db.run(`UPDATE tournaments SET ${winnerField} = ? WHERE id = ?`, [userId, tournamentId], function(err3) {
          if (err3) return res.status(500).json({ error: 'Failed to save winner' });
          const prize = Number(rankNum === 1 ? (tournament.prize1 || 0) : rankNum === 2 ? (tournament.prize2 || 0) : (tournament.prize3 || 0));
          const nowIso = new Date().toISOString();
          // Add earning for the winner (idempotent on user+description)
          const earningDesc = `Tournament prize (${rankNum === 1 ? '1st' : rankNum === 2 ? '2nd' : '3rd'}): ${tournament.title}`;
          db.get('SELECT id FROM earnings WHERE userId = ? AND description = ?', [userId, earningDesc], (chkErr, existing) => {
            if (chkErr) return res.status(500).json({ error: 'Failed to check existing earning' });
            const done = () => {
              // Send formal notification to winner
              const fcm = req.app.get('fcm');
              if (fcm && reg.fcmToken) {
                const message = {
                  token: reg.fcmToken,
                  notification: {
                    title: 'Congratulations — You Won! 🎉',
                    body: `Dear ${reg.username}, you secured ${rankNum === 1 ? '1st' : rankNum === 2 ? '2nd' : '3rd'} place in "${tournament.title}". An amount of ₹${prize} has been transferred.`
                  }
                };
                fcm.send(message).then(() => {
                  console.log(`Notification sent to user ${reg.username} (${reg.userId}) for rank ${rankNum}`);
                }).catch((err) => {
                  console.error(`Failed to send notification to user ${reg.username} (${reg.userId}):`, err);
                });
              } else {
                console.warn(`No FCM token available for user ${reg.username} (${reg.userId}), notification not sent`);
              }

              // Emit real-time tournament update for all connected clients
              const io = req.app.get('io');
              if (io) {
                io.to(`tournament:${tournamentId}`).emit('tournament.updated', {
                  id: tournamentId,
                  winner1Name: rankNum === 1 ? reg.username : tournament.winner1Id ? null : null,
                  winner2Name: rankNum === 2 ? reg.username : tournament.winner2Id ? null : null,
                  winner3Name: rankNum === 3 ? reg.username : tournament.winner3Id ? null : null,
                  startTime: tournament.dateTime
                });
              }

              return res.json({ ok: true, winnerId: userId, rank: rankNum, prize });
            };
            if (existing) return done();
            db.run('INSERT INTO earnings (userId, amount, description, dateTime) VALUES (?,?,?,?)', [userId, prize, earningDesc, nowIso], (e4) => {
              if (e4) return res.status(500).json({ error: 'Failed to record earning' });
              done();
            });
          });
        });
      });
    });
  });

  // Simple test endpoint to verify admin router is reachable (no auth)
  router.get('/test', (req, res) => {
    res.json({ ok: true, message: 'Admin router is reachable.' });
  });

  // Get user by ID (for admin to enable notifications)
  router.get('/users/:id', (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

    db.get('SELECT id, username, email, phone, role, createdAt FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json(user);
    });
  });

  // All admin routes require auth + admin role
  router.use(authRequired, adminOnly);

  // Create tournament (supports banner and qr uploads)
  router.post('/tournaments', upload.fields([{ name: 'banner', maxCount: 1 }, { name: 'qr', maxCount: 1 }]), (req, res) => {
    const { title, dateTime, map, mode, fee, prizePool, prize1, prize2, prize3 } = req.body;
    const game = (req.body && req.body.game) ? String(req.body.game) : 'Free Fire';
    if (!title || !dateTime || !map || !mode) {
      return res.status(400).json({ error: 'title, dateTime, map, mode required' });
    }
    const totalSlots = defaultSlotsFor(game, mode);
    const bannerFile = (req.files && req.files.banner && req.files.banner[0]) ? req.files.banner[0] : null;
    const qrFile = (req.files && req.files.qr && req.files.qr[0]) ? req.files.qr[0] : null;
    const bannerPath = bannerFile ? ('/uploads/' + bannerFile.filename) : null;
    const qrPath = qrFile ? ('/uploads/' + qrFile.filename) : null;
    const now = new Date().toISOString();
    const sql = `INSERT INTO tournaments (title, bannerPath, qrPath, dateTime, map, mode, totalSlots, fee, prizePool, prize1, prize2, prize3, createdAt, game)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    db.run(sql, [title, bannerPath, qrPath, dateTime, map, mode, totalSlots, Number(fee || 0), Number(prizePool || 0), Number(prize1 || 0), Number(prize2 || 0), Number(prize3 || 0), now, game], function(err) {
      if (err) return res.status(500).json({ error: 'Failed to create tournament' });
      const id = this.lastID;
      // Create slots
      const teamSlots = totalSlots; // already mapped by mode
      const insert = db.prepare('INSERT INTO slots (tournamentId, slotNumber, status, updatedAt) VALUES (?,?,?,?)');
      const nowIso = new Date().toISOString();
      for (let i = 1; i <= teamSlots; i++) {
        insert.run(id, i, 'empty', nowIso);
      }
      insert.finalize(() => {
        // Notify all users of new tournament (push notification)
        const io = req.app.get('io');
        const dbRef = db;
        dbRef.all('SELECT fcmToken FROM users WHERE fcmToken IS NOT NULL AND fcmToken <> ""', [], (err, users) => {
          if (!err && users && users.length) {
            const fcm = req.app.get('fcm');
            users.forEach(u => {
              const message = {
                token: u.fcmToken,
                notification: {
                  title: 'New Tournament!',
                  body: `A new tournament "${title}" has been added. Check it out!`
                }
              };
              fcm.send(message).catch(console.error);
            });
          }
        });
        if (io) {
          io.emit('notification', { type: 'new_tournament', message: 'New tournament added!' });
        }
        res.json({ id });
      });
    });
  });

  // Update tournament (including room credentials; banner/qr optional)
  router.put('/tournaments/:id', upload.fields([{ name: 'banner', maxCount: 1 }, { name: 'qr', maxCount: 1 }]), (req, res) => {
    const id = req.params.id;
    const { title, dateTime, map, mode, roomId, roomPassword, fee, prizePool, prize1, prize2, prize3, game } = req.body;
    const fields = [];
    const params = [];
    function add(field, value) { fields.push(`${field} = ?`); params.push(value); }

    if (title) add('title', title);
    if (dateTime) add('dateTime', dateTime);
    if (map) add('map', map);
    if (mode) { add('mode', mode); }
    if (game) { add('game', game); }
    // If mode or game provided, recompute totalSlots
    if (mode || game) {
      const recomputeSlots = defaultSlotsFor(game || 'Free Fire', mode || 'Solo');
      add('totalSlots', recomputeSlots);
    }
    if (typeof roomId !== 'undefined') add('roomId', roomId);
    if (typeof roomPassword !== 'undefined') add('roomPassword', roomPassword);
    if (typeof fee !== 'undefined') add('fee', Number(fee || 0));
    if (typeof prizePool !== 'undefined') add('prizePool', Number(prizePool || 0));
    if (typeof prize1 !== 'undefined') add('prize1', Number(prize1 || 0));
    if (typeof prize2 !== 'undefined') add('prize2', Number(prize2 || 0));
    if (typeof prize3 !== 'undefined') add('prize3', Number(prize3 || 0));
    const bannerFile = (req.files && req.files.banner && req.files.banner[0]) ? req.files.banner[0] : null;
    const qrFile = (req.files && req.files.qr && req.files.qr[0]) ? req.files.qr[0] : null;
    if (bannerFile) add('bannerPath', '/uploads/' + bannerFile.filename);
    if (qrFile) add('qrPath', '/uploads/' + qrFile.filename);

    if (fields.length === 0) return res.json({ ok: true, updated: 0 });

    // const sql = `UPDATE tournaments SET ${fields.join(', ')} WHERE id = ?`;
    const sql = `UPDATE tournaments SET ${fields.join(', ')} WHERE id = ?`;
    params.push(id);
    db.run(sql, params, function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update tournament' });
      // Emit notification if room details updated
      if (fields.some(f => f === 'roomId = ?' || f === 'roomPassword = ?')) {
        const io = req.app.get('io');
        if (io) {
          io.to(`tournament:${id}`).emit('notification', { type: 'room_updated', message: 'Room ID and Password have been updated for this tournament.' });
        }
      }
      // If mode changed and thus totalSlots changed, re-seed slots only if needed
      if (fields.some(f => f.startsWith('totalSlots'))) {
        const nowIso = new Date().toISOString();
        db.get('SELECT totalSlots FROM tournaments WHERE id = ?', [id], (e2, row) => {
          if (!e2 && row) {
            db.all('SELECT COUNT(*) as c FROM slots WHERE tournamentId = ?', [id], (e3, cnt) => {
              const have = (cnt && cnt[0] && cnt[0].c) ? cnt[0].c : 0;
              if (have < row.totalSlots) {
                const insert = db.prepare('INSERT INTO slots (tournamentId, slotNumber, status, updatedAt) VALUES (?,?,?,?)');
                for (let i = have + 1; i <= row.totalSlots; i++) insert.run(id, i, 'empty', nowIso);
                insert.finalize(() => res.json({ ok: true, updated: 1 }));
              } else if (have > row.totalSlots) {
                db.run('DELETE FROM slots WHERE tournamentId = ? AND slotNumber > ?', [id, row.totalSlots], () => {
                  res.json({ ok: true, updated: 1 });
                });
              } else {
                res.json({ ok: true, updated: this.changes });
              }
            });
          } else {
            res.json({ ok: true, updated: this.changes });
          }
        });
      } else {
        res.json({ ok: true, updated: this.changes });
      }
    });
  });

  // Delete tournament
  router.delete('/tournaments/:id', (req, res) => {
    const id = req.params.id;
    // Optionally remove banner file after fetching path
    db.get('SELECT bannerPath FROM tournaments WHERE id = ?', [id], (err, row) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      db.run('DELETE FROM tournaments WHERE id = ?', [id], function(err2) {
        if (err2) return res.status(500).json({ error: 'Failed to delete' });
        if (row && row.bannerPath) {
          const filePath = path.join('public', row.bannerPath.replace(/^\//, ''));
          fs.unlink(filePath, ()=>{});
        }
        res.json({ ok: true, deleted: this.changes });
      });
    });
  });

  // See registrations for a tournament (include UTR and status info)
  router.get('/tournaments/:id/registrations', (req, res) => {
    const id = req.params.id;
    const sql = `
      SELECT r.id, r.userId, r.slotNumber, r.utr, r.paid, r.teamSize,
             u.username, u.email,
             r.phone, r.ingame_name, r.ingame_uid, r.phonepe_number, r.createdAt
      FROM registrations r
      JOIN users u ON u.id = r.userId
      WHERE r.tournamentId = ?
      ORDER BY datetime(r.createdAt) ASC
    `;
    db.all(sql, [id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  });

  // Approve a registration: mark paid and confirm the reserved slot
  router.post('/registrations/:id/approve', (req, res) => {
    const registrationId = parseInt(req.params.id, 10);
    if (!registrationId) return res.status(400).json({ error: 'Invalid id' });
    db.get('SELECT r.*, t.id as tId, t.title FROM registrations r JOIN tournaments t ON t.id = r.tournamentId WHERE r.id = ?', [registrationId], (e1, reg) => {
      if (e1) return res.status(500).json({ error: 'Server error' });
      if (!reg) return res.status(404).json({ error: 'Not found' });
      if (!reg.slotNumber) return res.status(400).json({ error: 'No reserved slot to confirm' });
      const nowIso = new Date().toISOString();
      db.run('BEGIN TRANSACTION');
      db.run('UPDATE registrations SET paid = 1 WHERE id = ?', [registrationId], function(e2) {
        if (e2) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Server error' });
        }
        const sql = `UPDATE slots SET status = 'confirmed', updatedAt = ? WHERE tournamentId = ? AND slotNumber = ?`;
        db.run(sql, [nowIso, reg.tournamentId, reg.slotNumber], function(e3) {
          if (e3) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Server error' });
          }
          db.run('COMMIT', () => {
            // Send push notification to user for payment confirmation
            const io = req.app.get('io');
            const fcm = req.app.get('fcm');
            db.get('SELECT fcmToken FROM users WHERE id = ?', [reg.userId], (err, user) => {
              if (!err && user && user.fcmToken) {
                const message = {
                  token: user.fcmToken,
                  notification: {
                    title: 'Payment Confirmed!',
                    body: `Your payment for tournament "${reg.title}" has been confirmed.`
                  }
                };
                fcm.send(message).catch(console.error);
              }
            });
            if (io) {
              io.to(`tournament:${reg.tournamentId}`).emit('slot_update', { tournamentId: reg.tournamentId, slot: { slotNumber: reg.slotNumber, status: 'confirmed' } });
              io.to(`user:${reg.userId}`).emit('payment_confirmed', { tournamentId: reg.tournamentId, title: reg.title, registrationId });
            }
            return res.json({ ok: true });
          });
        });
      });
    });
  });

  // Reject a registration: free the reserved slot and delete registration
  router.post('/registrations/:id/reject', (req, res) => {
    const registrationId = parseInt(req.params.id, 10);
    if (!registrationId) return res.status(400).json({ error: 'Invalid id' });
    db.get('SELECT * FROM registrations WHERE id = ?', [registrationId], (e1, reg) => {
      if (e1) return res.status(500).json({ error: 'Server error' });
      if (!reg) return res.status(404).json({ error: 'Not found' });
      const nowIso = new Date().toISOString();
      db.run('BEGIN TRANSACTION');
      // If a slot was reserved, free it
      const freeSlot = (cb) => {
        if (!reg.slotNumber) return cb();
        db.run('UPDATE slots SET status = \"empty\", p1 = NULL, p2 = NULL, p3 = NULL, p4 = NULL, updatedAt = ? WHERE tournamentId = ? AND slotNumber = ?', [nowIso, reg.tournamentId, reg.slotNumber], (e2) => cb(e2));
      };
      freeSlot((e2) => {
        if (e2) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Server error' });
        }
        db.run('DELETE FROM registrations WHERE id = ?', [registrationId], (e3) => {
          if (e3) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Server error' });
          }
          db.run('COMMIT', () => {
            const io = req.app.get('io');
            if (io && reg.slotNumber) {
              db.get('SELECT * FROM slots WHERE tournamentId = ? AND slotNumber = ?', [reg.tournamentId, reg.slotNumber], (e4, slotRow) => {
                if (!e4 && slotRow) io.to(`tournament:${reg.tournamentId}`).emit('slot_update', { tournamentId: reg.tournamentId, slot: slotRow });
                return res.json({ ok: true });
              });
            } else {
              return res.json({ ok: true });
            }
          });
        });
      });
    });
  });

  // Update a slot (status and participants) and emit live update
  router.patch('/tournaments/:id/slots/:slotNumber', (req, res) => {
    const tournamentId = parseInt(req.params.id, 10);
    const slotNumber = parseInt(req.params.slotNumber, 10);
    const { status, participants } = req.body || {};
    if (!tournamentId || !slotNumber) return res.status(400).json({ error: 'Invalid params' });

    db.get('SELECT mode FROM tournaments WHERE id = ?', [tournamentId], (e1, t) => {
      if (e1) return res.status(500).json({ error: 'Server error' });
      if (!t) return res.status(404).json({ error: 'Tournament not found' });

      const teamSize = (t.mode === 'Duo') ? 2 : (t.mode === 'Squad') ? 4 : 1;
      const allowedStatus = ['empty','reserved','confirmed'];
      const statusValue = allowedStatus.includes(status) ? status : 'empty';

      let p = [null, null, null, null];
      if (Array.isArray(participants)) {
        for (let i = 0; i < Math.min(participants.length, 4); i++) {
          const v = String(participants[i] || '').trim();
          p[i] = v.length ? v : null;
        }
      }

      // Validation: if reserved/confirmed, require exactly teamSize non-empty names
      if (statusValue !== 'empty') {
        const nonEmpty = p.filter(x => x && x.length > 0).length;
        if (nonEmpty !== teamSize) {
          return res.status(400).json({ error: `Require exactly ${teamSize} participant name(s) for ${t.mode}` });
        }
      } else {
        p = [null, null, null, null];
      }

      const nowIso = new Date().toISOString();
      const sql = `UPDATE slots SET status = ?, p1 = ?, p2 = ?, p3 = ?, p4 = ?, updatedAt = ?
                   WHERE tournamentId = ? AND slotNumber = ?`;
      db.run(sql, [statusValue, p[0], p[1], p[2], p[3], nowIso, tournamentId, slotNumber], function(e2) {
        if (e2) return res.status(500).json({ error: 'Server error' });
        db.get('SELECT * FROM slots WHERE tournamentId = ? AND slotNumber = ?', [tournamentId, slotNumber], (e3, row) => {
          if (e3) return res.status(500).json({ error: 'Server error' });
          const io = req.app.get('io');
          if (io) io.to(`tournament:${tournamentId}`).emit('slot_update', { tournamentId, slot: row });
          return res.json({ ok: true, slot: row });
        });
      });
    });
  });

  // Update tournament core fields (fee/prize/room)
  router.patch('/tournaments/:id/fields', authRequired, adminOnly, (req, res) => {
    const id = req.params.id;
    const { fee, prizePool, roomId, roomPassword, title, mode, totalSlots, dateTime } = req.body || {};
    const sql = `UPDATE tournaments SET
      title = COALESCE(?, title),
      mode = COALESCE(?, mode),
      totalSlots = COALESCE(?, totalSlots),
      dateTime = COALESCE(?, dateTime),
      fee = COALESCE(?, fee),
      prizePool = COALESCE(?, prizePool),
      roomId = COALESCE(?, roomId),
      roomPassword = COALESCE(?, roomPassword)
      WHERE id = ?`;
    db.run(sql, [title || null, mode || null, totalSlots || null, dateTime || null, fee || null, prizePool || null, roomId || null, roomPassword || null, id], function(err) {
      if (err) return res.status(500).json({ error: 'Server error' });
      return res.json({ ok: true });
    });
  });

  // Notify winner and send notification

  return router;
};
