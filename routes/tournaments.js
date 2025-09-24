const express = require('express');
const { authRequired } = require('../middleware/auth');

function teamSizeForMode(mode) {
  if (mode === 'Duo') return 2;
  if (mode === 'Squad') return 4;
  return 1; // Solo
}


const Razorpay = require('razorpay');
const crypto = require('crypto');

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || null;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || null;

function msUntil(dt) {
  const now = Date.now();
  const start = new Date(dt).getTime();
  return start - now;
}

module.exports = function(db) {
  const router = express.Router();

  // List tournaments with filled players from SUM(teamSize) and include winner
  router.get('/', (req, res) => {
    const gameFilter = (req.query && req.query.game) ? String(req.query.game) : null;
    const sqlBase = gameFilter ? 'SELECT * FROM tournaments WHERE game = ? ORDER BY datetime(dateTime) ASC' : 'SELECT * FROM tournaments ORDER BY datetime(dateTime) ASC';
    const params = gameFilter ? [gameFilter] : [];
    db.all(sqlBase, params, (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (!rows) return res.json([]);
      const sql = 'SELECT tournamentId, COALESCE(SUM(teamSize), 0) as count FROM registrations GROUP BY tournamentId';
      db.all(sql, [], (err2, counts) => {
        if (err2) return res.status(500).json({ error: 'Server error' });
        const map = {};
        (counts || []).forEach(c => { map[c.tournamentId] = c.count; });
        const result = rows.map(r => {
          const filledPlayers = map[r.id] || 0;
          const teamSize = teamSizeForMode(r.mode);
          const slotsFilled = Math.ceil(filledPlayers / teamSize);
          const playerCapacity = r.totalSlots * teamSize;
          return { ...r, filledPlayers, slotsFilled, playerCapacity };
        });
        // Attach winner info (username) if available
        const ids = result.map(r => r.id);
        if (ids.length === 0) return res.json(result);
        const placeholders = ids.map(() => '?').join(',');
        const q = `
          SELECT t.id as tournamentId,
                 u1.username as winner1Name,
                 u2.username as winner2Name,
                 u3.username as winner3Name
          FROM tournaments t
          LEFT JOIN users u1 ON u1.id = t.winner1Id
          LEFT JOIN users u2 ON u2.id = t.winner2Id
          LEFT JOIN users u3 ON u3.id = t.winner3Id
          WHERE t.id IN (${placeholders})`;
        db.all(q, ids, (e3, winners) => {
          const wmap = {};
          (winners || []).forEach(w => { wmap[w.tournamentId] = w; });
          const withWinners = result.map(r => ({
            ...r,
            winner1Name: (wmap[r.id] && wmap[r.id].winner1Name) || null,
            winner2Name: (wmap[r.id] && wmap[r.id].winner2Name) || null,
            winner3Name: (wmap[r.id] && wmap[r.id].winner3Name) || null
          }));
          return res.json(withWinners);
        });
      });
    });
  });

  // Get one tournament (with conditional room info: only within 5 minutes of start and if registered)
  router.get('/:id', authRequired, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM tournaments WHERE id = ?', [id], (err, r) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (!r) return res.status(404).json({ error: 'Not found' });

      db.get('SELECT COALESCE(SUM(teamSize), 0) as count FROM registrations WHERE tournamentId = ?', [id], (err2, row) => {
        if (err2) return res.status(500).json({ error: 'Server error' });
        const filledPlayers = row.count;
        const teamSize = teamSizeForMode(r.mode);
        const slotsFilled = Math.ceil(filledPlayers / teamSize);
        const playerCapacity = r.totalSlots * teamSize;

        // Check if user is registered
        db.get('SELECT 1 FROM registrations WHERE userId = ? AND tournamentId = ?', [req.user.id, id], (err3, regRow) => {
          if (err3) return res.status(500).json({ error: 'Server error' });

          // Show room only if registered and within 5 minutes before or after start
          const now = new Date();
          const start = new Date(r.dateTime);
          const fiveMinMs = 5 * 60 * 1000;
          const showRoom = !!regRow && (now.getTime() >= (start.getTime() - fiveMinMs));

          return res.json({
            ...r,
            filledPlayers,
            slotsFilled,
            playerCapacity,
            roomId: showRoom ? (r.roomId || null) : null,
            roomPassword: showRoom ? (r.roomPassword || null) : null,
            showRoom,
            isRegistered: !!regRow
          });
        });
      });
    });
  });

  // Register for a tournament (team-aware)
  router.post('/:id/register', authRequired, (req, res) => {
    const id = req.params.id;
    const { phone, phonepe_number, participants, utr } = req.body || {};
    const phoneValue = phonepe_number || phone || null;

    db.get('SELECT * FROM tournaments WHERE id = ?', [id], (err, r) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (!r) return res.status(404).json({ error: 'Tournament not found' });

      const teamSize = teamSizeForMode(r.mode);

      // Check if tournament has started
      const now = new Date();
      const start = new Date(r.dateTime);
      if (now >= start) {
        return res.status(400).json({ error: 'Tournament has already started. Registration closed.' });
      }

      // Validate participants array
      if (!Array.isArray(participants) || participants.length !== teamSize) {
        return res.status(400).json({ error: `participants must be an array of ${teamSize} members` });
      }
      for (const p of participants) {
        if (!p || !p.name || !p.uid) return res.status(400).json({ error: 'Each participant requires name and uid' });
        if (!/^\d{4,}$/.test(String(p.uid))) return res.status(400).json({ error: 'Invalid uid format' });
      }

      const capacity = r.totalSlots * teamSize;

      // Already registered?
      db.get('SELECT id FROM registrations WHERE userId = ? AND tournamentId = ?', [req.user.id, id], (err2, already) => {
        if (err2) return res.status(500).json({ error: 'Server error' });
        if (already) return res.status(400).json({ error: 'Already registered for this tournament' });

        // Count current filled players by SUM(teamSize)
        db.get('SELECT COALESCE(SUM(teamSize), 0) as count FROM registrations WHERE tournamentId = ?', [id], (err3, cnt) => {
          if (err3) return res.status(500).json({ error: 'Server error' });
          if (cnt.count + teamSize > capacity) return res.status(400).json({ error: 'Tournament is full' });

          // Find first available empty slot
          db.get('SELECT slotNumber FROM slots WHERE tournamentId = ? AND status = ? ORDER BY slotNumber ASC LIMIT 1', [id, 'empty'], (e4, slotRow) => {
            if (e4) return res.status(500).json({ error: 'Server error' });
            if (!slotRow) return res.status(400).json({ error: 'No available slots' });

            const now = new Date().toISOString();
            const leader = participants[0];
            const p = [null, null, null, null];
            for (let i = 0; i < Math.min(participants.length, 4); i++) {
              p[i] = participants[i].name;
            }

            // Begin transaction: insert registration then reserve the slot
            db.run('BEGIN TRANSACTION');
            db.run(
              'INSERT INTO registrations (userId, tournamentId, phone, ingame_name, ingame_uid, phonepe_number, teammatesJson, teamSize, utr, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
              [req.user.id, id, phoneValue, leader.name, leader.uid, phoneValue, JSON.stringify(participants), teamSize, utr || null, now],
              function(err4) {
                if (err4) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: 'Failed to register' });
                }
                const updateSql = `UPDATE slots SET status = ?, p1 = ?, p2 = ?, p3 = ?, p4 = ?, updatedAt = ?
                                   WHERE tournamentId = ? AND slotNumber = ? AND status = 'empty'`;
                db.run(updateSql, ['reserved', p[0], p[1], p[2], p[3], now, id, slotRow.slotNumber], function(e5) {
                  if (e5 || this.changes === 0) {
                    db.run('ROLLBACK');
                    return res.status(409).json({ error: 'Slot just got taken, please retry' });
                  }
                  // Save slotNumber on the registration
                  db.run('UPDATE registrations SET slotNumber = ? WHERE id = ?', [slotRow.slotNumber, this.lastID], (e6) => {
                    if (e6) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: 'Server error' });
                    }
                    // If fee is zero or not set, auto-confirm: mark paid=1 and set slot to confirmed
                    if (!r.fee || Number(r.fee) <= 0) {
                      const nowIso = new Date().toISOString();
                      db.run('UPDATE registrations SET paid = 1 WHERE id = ?', [this.lastID], (e7) => {
                        if (e7) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: 'Server error' });
                        }
                        const confirmSql = `UPDATE slots SET status = 'confirmed', updatedAt = ? WHERE tournamentId = ? AND slotNumber = ?`;
                        db.run(confirmSql, [nowIso, id, slotRow.slotNumber], (e8) => {
                          if (e8) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Server error' });
                          }
                          db.run('COMMIT', (e9) => {
                            if (e9) return res.status(500).json({ error: 'Server error' });
                            db.get('SELECT * FROM slots WHERE tournamentId = ? AND slotNumber = ?', [id, slotRow.slotNumber], (e10, finalSlot) => {
                              const io = req.app.get('io');
                              if (io && finalSlot) {
                                io.to(`tournament:${id}`).emit('slot_update', { tournamentId: Number(id), slot: finalSlot });
                                // Check if slots are almost full
                                db.get('SELECT COUNT(*) as filled FROM slots WHERE tournamentId = ? AND status IN ("reserved", "confirmed")', [id], (e11, cnt) => {
                                  if (!e11 && cnt) {
                                    const total = r.totalSlots;
                                    const remaining = total - cnt.filled;
                                    if (remaining <= 5 && remaining > 0) {
                                      io.to(`tournament:${id}`).emit('notification', { type: 'slots_filling', message: `Register Fast! Only ${remaining} slots left.` });
                                    }
                                  }
                                });
                              }
                              return res.json({ ok: true, registrationId: this.lastID, slotNumber: slotRow.slotNumber, autoConfirmed: true });
                            });
                          });
                        });
                      });
                    } else {
                      db.run('COMMIT', (e7) => {
                        if (e7) return res.status(500).json({ error: 'Server error' });
                        // Emit update for the reserved slot
                        db.get('SELECT * FROM slots WHERE tournamentId = ? AND slotNumber = ?', [id, slotRow.slotNumber], (e8, finalSlot) => {
                          const io = req.app.get('io');
                          if (io && finalSlot) {
                            io.to(`tournament:${id}`).emit('slot_update', { tournamentId: Number(id), slot: finalSlot });
                            // Check if slots are almost full
                            db.get('SELECT COUNT(*) as filled FROM slots WHERE tournamentId = ? AND status IN ("reserved", "confirmed")', [id], (e9, cnt) => {
                              if (!e9 && cnt) {
                                const total = r.totalSlots;
                                const remaining = total - cnt.filled;
                                if (remaining <= 5 && remaining > 0) {
                                  io.to(`tournament:${id}`).emit('notification', { type: 'slots_filling', message: `Register Fast! Only ${remaining} slots left.` });
                                }
                              }
                            });
                          }
                          return res.json({ ok: true, registrationId: this.lastID, slotNumber: slotRow.slotNumber });
                        });
                      });
                    }
                  });
                });
              }
            );
          });
        });
      });
    });
  });

  // Get user's registered tournaments
  router.get('/me/registrations/list', authRequired, (req, res) => {
    const sql = `
      SELECT t.*, r.createdAt as registeredAt
      FROM registrations r
      JOIN tournaments t ON t.id = r.tournamentId
      WHERE r.userId = ?
      ORDER BY datetime(t.dateTime) ASC
    `;
    db.all(sql, [req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  });

  // Public: list slots for a tournament (no sensitive data)
  router.get('/:id/slots', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    db.all('SELECT slotNumber, status, p1, p2, p3, p4, updatedAt FROM slots WHERE tournamentId = ? ORDER BY slotNumber ASC', [id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  });

  // Create Razorpay order (optional)
  router.post('/:id/order', authRequired, (req, res) => {
    const id = req.params.id;
    db.get('SELECT * FROM tournaments WHERE id = ?', [id], async (err, t) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      if (!t) return res.status(404).json({ error: 'Not found' });
      if (!t.fee || t.fee <= 0) return res.status(400).json({ error: 'No payment required' });

      // If keys missing, return a fake order for test so app doesn't crash
      if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
        const fake = {
          id: 'order_TEST_' + Date.now(),
          amount: t.fee * 100,
          currency: 'INR'
        };
        return res.json({ key: 'rzp_test_key', order: fake, testMode: true });
      }
      try {
        const instance = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
        const order = await instance.orders.create({
          amount: t.fee * 100,
          currency: 'INR',
          receipt: 'tournament_' + id + '_' + req.user.id
        });
        return res.json({ key: RAZORPAY_KEY_ID, order, testMode: false });
      } catch (e) {
        return res.status(500).json({ error: 'Razorpay error' });
      }
    });
  });

  // User's registrations
  router.get('/mine', authRequired, (req, res) => {
    const sql = `
      SELECT t.*, r.createdAt as registeredAt, r.paid as paid
      FROM registrations r
      JOIN tournaments t ON t.id = r.tournamentId
      WHERE r.userId = ?
      ORDER BY datetime(t.dateTime) ASC`;
    db.all(sql, [req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      res.json(rows || []);
    });
  });

  return router;
};
