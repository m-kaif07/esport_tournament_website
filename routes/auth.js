const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { authRequired, signToken } = require('../middleware/auth');

module.exports = function(db) {
  const router = express.Router();
  const multer = require('multer');
  const path = require('path');
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

  // Create reusable transporter object using Gmail SMTP
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER || 'quizbyer@gmail.com',
      pass: process.env.EMAIL_PASS || '' // You should set this in environment variables for security
    }
  });

  // Send test push notification to user (for demo)
  router.post('/notify', authRequired, async (req, res) => {
    const userId = req.user.id;
    db.get('SELECT fcmToken FROM users WHERE id = ?', [userId], async (err, row) => {
      if (err || !row || !row.fcmToken) {
        return res.status(400).json({ error: 'No FCM token found for user' });
      }
      try {
        const fcm = req.app.get('fcm');
        const message = {
          token: row.fcmToken,
          notification: {
            title: 'Test Notification',
            body: 'This is a test push notification from ARArena.'
          }
        };
        await fcm.send(message);
        return res.json({ ok: true, sent: true });
      } catch (e) {
        return res.status(500).json({ error: 'Failed to send notification', details: String(e) });
      }
    });
  });

  // Profile picture upload
  router.post('/profile/pic', authRequired, upload.single('profilePic'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const profilePicPath = '/uploads/' + req.file.filename;
    db.run('UPDATE users SET profilePic = ? WHERE id = ?', [profilePicPath, req.user.id], function(err) {
      if (err) return res.status(500).json({ error: 'Failed to update profile picture' });
      return res.json({ ok: true, profilePic: profilePicPath });
    });
  });

  // Signup
  router.post('/signup', async (req, res) => {
    console.log('Signup request body:', req.body);
    try {
      const { username, email, phone, password } = req.body;
      if (!username || !email || !password) {
        console.log('Signup missing fields:', req.body);
        return res.status(400).json({ error: 'username, email, password required' });
      }
      const hash = await bcrypt.hash(password, 10);
      const now = new Date().toISOString();
      const stmt = db.prepare('INSERT INTO users (username, email, phone, passwordHash, role, createdAt) VALUES (?,?,?,?,?,?)');
      stmt.run([username, email, phone || '', hash, 'user', now], function(err) {
        if (err) {
          console.log('Signup DB error:', err);
          if (String(err).includes('UNIQUE')) {
            return res.status(400).json({ error: 'Email already in use' });
          }
          return res.status(500).json({ error: 'Failed to create user' });
        }
        const user = { id: this.lastID, username, email, phone: phone || '', role: 'user' };
        const token = signToken(user);
        console.log('Signup success for user:', user.email);
        return res.json({ token, user });
      });
    } catch (e) {
      console.log('Signup exception:', e);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // Login
  router.post('/login', (req, res) => {
    console.log('Login request body:', req.body);
    const { email, password } = req.body;
    if (!email || !password) {
      console.log('Login missing fields:', req.body);
      return res.status(400).json({ error: 'email and password required' });
    }
    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        console.log('Login DB error:', err);
        return res.status(500).json({ error: 'Server error' });
      }
      if (!user) {
        console.log('Login user not found:', email);
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const match = await bcrypt.compare(password, user.passwordHash);
      if (!match) {
        console.log('Login password mismatch for user:', email);
        return res.status(401).json({ error: 'Invalid credentials' });
      }
  const token = signToken(user);
  const safeUser = { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role, profilePic: user.profilePic };
  console.log('Login success for user:', email, 'role:', user.role);
  return res.json({ token, user: safeUser });
    });
  });

  // Me
  router.get('/me', authRequired, (req, res) => {
    db.get('SELECT id, username, email, phone, role, profilePic FROM users WHERE id = ?', [req.user.id], (err, row) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      return res.json(row);
    });
  });

  // My Earnings
  router.get('/me/earnings', authRequired, (req, res) => {
    db.all('SELECT id, amount, description, dateTime FROM earnings WHERE userId = ? ORDER BY dateTime DESC', [req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Server error' });
      return res.json(rows || []);
    });
  });

  // Forgot Password
  router.post('/forgot-password', async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      // Check if user exists
      db.get('SELECT id, email FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
          console.error('Database error in forgot-password:', err);
          return res.status(500).json({ error: 'Server error' });
        }

        if (!user) {
          // Don't reveal if email exists or not for security
          return res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date(Date.now() + 3600000); // 1 hour from now

        // Store reset token in database
        db.run('UPDATE users SET resetToken = ?, resetExpires = ? WHERE id = ?',
          [resetToken, resetExpires.toISOString(), user.id],
          async function(err) {
            if (err) {
              console.error('Error storing reset token:', err);
              return res.status(500).json({ error: 'Server error' });
            }

            const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${resetToken}`;

            console.log(`Password reset link for ${email}: ${resetLink}`);

            // Send email with reset link
            const mailOptions = {
              from: process.env.EMAIL_USER || 'quizbyer@gmail.com',
              to: email,
              subject: 'Password Reset Request',
              text: `You requested a password reset. Click the link to reset your password: ${resetLink}`,
              html: `<p>You requested a password reset. Click the link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p>`
            };

            try {
              await transporter.sendMail(mailOptions);
              console.log('Password reset email sent to:', email);
            } catch (emailErr) {
              console.error('Error sending password reset email:', emailErr);
              // Optionally handle email sending failure here
            }

            return res.json({
              message: 'If an account with that email exists, a reset link has been sent.',
              resetLink: process.env.NODE_ENV === 'development' ? resetLink : undefined
            });
          }
        );
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // Reset Password
  router.post('/reset-password', async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: 'Token and password are required' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long' });
      }

      // Find user with valid reset token
      db.get('SELECT id, resetToken, resetExpires FROM users WHERE resetToken = ?', [token], async (err, user) => {
        if (err) {
          console.error('Database error in reset-password:', err);
          return res.status(500).json({ error: 'Server error' });
        }

        if (!user) {
          return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        // Check if token is expired
        const now = new Date();
        const resetExpires = new Date(user.resetExpires);
        if (now > resetExpires) {
          return res.status(400).json({ error: 'Reset token has expired' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update password and clear reset token
        db.run('UPDATE users SET passwordHash = ?, resetToken = NULL, resetExpires = NULL WHERE id = ?',
          [hashedPassword, user.id],
          function(err) {
            if (err) {
              console.error('Error updating password:', err);
              return res.status(500).json({ error: 'Server error' });
            }

            return res.json({ message: 'Password updated successfully' });
          }
        );
      });
    } catch (error) {
      console.error('Reset password error:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
};
