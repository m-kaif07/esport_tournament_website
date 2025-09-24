# ARArena — Free Fire Tournament Website

**Tech Stack**: Node.js v18 + Express, SQLite (single-file), Frontend in HTML/CSS/JS (no template engines).  
**Auth**: JWT (stored in localStorage) + bcryptjs (password hashing).

## Quick Start
1. **Extract** this zip.
2. Open a terminal in the project folder and run:
   ```bash
   npm install
   cp .env.example .env   # On Windows: copy .env.example .env
   npm start
   ```
   Server will start at: http://localhost:3000

> If you **forget** to set `JWT_SECRET`, the app will fall back to a safe default (`dev_secret_change_me`) so it won't crash.

## Admin Auto-Seeding
On first boot, the server ensures an admin account exists:
- Email: `admin@ararena.com`
- Password: `admin123`
- Role: `admin`

## Project Structure
```
/server.js
/package.json
/.env.example
/db/ararena.db         # SQLite single-file DB (created if missing)
/db/init.js            # Table creation + admin seeding (runs on server start)
/middleware/auth.js
/routes/auth.js
/routes/tournaments.js
/routes/admin.js
/public/               # Static frontend
  index.html
  login.html
  signup.html
  tournaments.html
  profile.html
  admin.html
  /css/styles.css
  /js/api.js
  /js/auth.js
  /js/header.js
  /js/index.js
  /js/tournaments.js
  /js/profile.js
  /js/admin.js
  /img/placeholder-banner.jpg
  /uploads/           # Uploaded banners
```

## Notes
- **Room ID / Password** are visible only to **registered players** starting **5 minutes** before the match start time.
- **Slots**: Solo=48, Duo=24, Squad=12 (server auto-assigns based on mode).
- **Slot tracking** updates via polling on the tournaments page.
- **PhonePe Number** is collected on registration and stored per registration.
- **Razorpay** placeholder is indicated in the UI for future integration.
- DB is created automatically if missing. You can delete `db/ararena.db` to start fresh.

## Troubleshooting
- If you previously saw `Error: secretOrPrivateKey must have a value`, it’s fixed here by setting a default. You can still override with `.env`.
- If images don't show, ensure the server has write access to `public/uploads` and that you're using the provided `npm start`.
```
