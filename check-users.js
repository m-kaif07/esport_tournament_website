const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database('./db/ararena.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    return;
  }
  console.log('Connected to the SQLite database.');
});

db.all('SELECT id, username, email, role FROM users', [], (err, rows) => {
  if (err) {
    console.error('Error querying users:', err.message);
  } else {
    console.log('Users in database:');
    rows.forEach(row => {
      console.log(`ID: ${row.id}, Username: ${row.username}, Email: ${row.email}, Role: ${row.role}`);
    });
  }
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
  });
});
