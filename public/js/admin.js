// Firebase configuration for notifications
const firebaseConfig = {
  apiKey: "AIzaSyBQDNxx8_9DFVOsJ5c4pn9kuzNxX6AxU0k",
  authDomain: "ak-arena.firebaseapp.com",
  projectId: "ak-arena",
  storageBucket: "ak-arena.firebasestorage.app",
  messagingSenderId: "883603092694",
  appId: "1:883603092694:web:238973cdc2057ae26b8577",
  measurementId: "G-MGTPR6RGT0"
};

// Initialize Firebase
let firebaseApp = null;
let messaging = null;

try {
  if (!firebase.apps || !firebase.apps.length) {
    firebaseApp = firebase.initializeApp(firebaseConfig);
    messaging = firebase.messaging();
  } else {
    firebaseApp = firebase.app();
    messaging = firebase.messaging();
  }
} catch (err) {
  console.warn('Firebase initialization failed:', err);
}

function fmtDate(dt) {
  const d = new Date(dt);
  return d.toLocaleString();
}
async function ensureAdmin() {
  const user = await API.me();
  if (!user || user.role !== 'admin') {
    alert('Admin only');
    window.location.href = '/';
  }
}

async function createTournament(e) {
  e.preventDefault();
  const form = document.getElementById('createTournamentForm');
  const fd = new FormData(form);
  // Ensure game present
  if (!fd.get('game')) {
    const g = document.getElementById('gameField');
    if (g && g.value) fd.set('game', g.value);
    else fd.set('game', 'Free Fire');
  }
  // Ensure numeric defaults
  if (!fd.get('fee')) fd.set('fee', 0);
  if (!fd.get('prizePool')) fd.set('prizePool', 0);
  if (!fd.get('prize1')) fd.set('prize1', 0);
  if (!fd.get('prize2')) fd.set('prize2', 0);
  if (!fd.get('prize3')) fd.set('prize3', 0);
  try {
    const res = await fetch('/api/admin/tournaments', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API.token },
      body: fd
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    document.getElementById('createMsg').textContent = 'Tournament created!';
    form.reset();
    loadAdminTournaments();
  } catch (err) {
    document.getElementById('createMsg').textContent = err.message;
  }
}

let listGame = 'Free Fire';
async function loadAdminTournaments() {
  try {
    const list = await API.request('/api/tournaments?game=' + encodeURIComponent(listGame)); // filter
    const wrap = document.getElementById('adminTours');
    wrap.innerHTML = '';
    list.forEach(t => {
      const banner = t.bannerPath ? t.bannerPath : '/img/placeholder-banner.jpg';
      const qr = t.qrPath ? t.qrPath : null;
      const card = document.createElement('div');
      card.className = 'card admin-card';
      card.innerHTML = `
        <img class="tour-banner" src="${banner}" alt="${t.title}"/>
        <h3>${t.title}</h3>
        <div class="tour-row">
          <span class="pill">${t.mode}</span>
          <span class="pill">${t.map}</span>
          <span class="pill">${fmtDate(t.dateTime)}</span>
        </div>
        <p class="small">Slots: ${t.slotsFilled}/${t.totalSlots} · Players: ${t.filledPlayers}/${t.playerCapacity}</p>
        ${qr ? `<div class="small">Payment QR:</div><img src="${qr}" alt="QR" style="max-width:200px;max-height:200px;object-fit:contain;border:1px solid #ddd;border-radius:6px"/>` : '<div class="small">No QR uploaded</div>'}
        <div class="form" style="margin-top:10px">
          <label>Room ID
            <input type="text" data-roomid="${t.id}" value="${t.roomId || ''}"/>
          </label>
          <label>Password
            <input type="text" data-roompw="${t.id}" value="${t.roomPassword || ''}"/>
          </label>
        <div class="row">
            <button class="btn small" data-action="save" data-id="${t.id}">Save</button>
            <button class="btn small danger" data-action="delete" data-id="${t.id}">Delete</button>
            <button class="btn small secondary" data-action="viewregs" data-id="${t.id}">Registrations</button>
          </div>
        </div>
        <div class="small" id="msg-${t.id}"></div>
        <div class="small" id="regs-${t.id}"></div>
      `;
      wrap.appendChild(card);
    });
  } catch (err) {
    document.getElementById('adminMsg').textContent = err.message;
  }
}

async function saveTournament(id) {
  const roomId = document.querySelector(`input[data-roomid="${id}"]`).value;
  const roomPassword = document.querySelector(`input[data-roompw="${id}"]`).value;
  try {
    await API.request(`/api/admin/tournaments/${id}`, {
      method: 'PUT',
      body: { roomId, roomPassword }
    });
    document.getElementById(`msg-${id}`).textContent = 'Saved!';
  } catch (err) {
    document.getElementById(`msg-${id}`).textContent = err.message;
  }
}

async function deleteTournament(id) {
  if (!confirm('Delete this tournament?')) return;
  try {
    await API.request(`/api/admin/tournaments/${id}`, { method: 'DELETE' });
    loadAdminTournaments();
  } catch (err) {
    alert(err.message);
  }
}

async function viewRegistrations(id) {
  try {
    const regs = await API.request(`/api/admin/tournaments/${id}/registrations`);
    const box = document.getElementById(`regs-${id}`);
    if (!regs.length) { box.textContent = 'No registrations yet.'; return; }
    // Build table UI
        const rows = regs.map(r => {
      const status = r.paid ? 'CONFIRMED' : 'PENDING';
      const statusClass = r.paid ? 'status-confirmed' : 'status-pending';
      const utr = r.utr ? r.utr : '-';
      return `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px;">${r.slotNumber || '?'}</td>
          <td style="padding: 10px;">${r.userId}</td>
          <td style="padding: 10px;">${r.username} (${r.email})</td>
          <td style="padding: 10px;">${r.phone || '-'}</td>
          <td style="padding: 10px;">${utr}</td>
          <td style="padding: 10px;"><span class="${statusClass}" style="padding: 4px 8px; border-radius: 4px; font-weight: bold;">${status}</span></td>
          <td style="padding: 10px;">${new Date(r.createdAt).toLocaleString()}</td>
          <td style="padding: 10px;">
            <button class="btn small" data-action="approve-reg" data-reg="${r.id}" style="margin-right: 5px;">Approve</button>
            <button class="btn small danger" data-action="reject-reg" data-reg="${r.id}">Reject</button>
            <span class="small" style="margin-left:6px;">Mark as:</span>
            <select data-rank-for="${r.userId}" style="margin:0 6px;">
              <option value="1">1st</option>
              <option value="2">2nd</option>
              <option value="3">3rd</option>
            </select>
            <button class="btn small" data-action="winner-reg" data-user="${r.userId}" data-tournament="${id}" style="background: linear-gradient(45deg, #19c37d, #00e5ff);">Notify</button>
          </td>
        </tr>`;
    }).join('');
    box.innerHTML = `
      <div style="overflow:auto; max-height: 400px; border: 1px solid #ddd; border-radius: 8px; background: #fff;">
        <table class="table small" style="width: 100%; border-collapse: collapse;">
          <thead style="background: #f5f5f5; position: sticky; top: 0;">
            <tr>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Slot</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">User ID</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">User</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Phone</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">UTR</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Status</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Registered</th>
              <th style="padding: 10px; text-align: left; border-bottom: 1px solid #ddd;">Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (err) {
    alert(err.message);
  }
}

// Handle proof image upload with authentication
async function handleProofUpload(e) {
  e.preventDefault();
  const form = document.getElementById('proofUploadForm');
  const msg = document.getElementById('uploadMsg');
  const formData = new FormData(form);

  if (!API.token) {
    msg.textContent = 'Authentication required. Please login again.';
    return;
  }

  try {
    const response = await fetch('/upload', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + API.token
      },
      body: formData
    });

    if (response.ok) {
      msg.textContent = 'Images uploaded successfully!';
      msg.style.color = 'green';
      form.reset();
      // Reload proof images
      if (window.loadProofImages) {
        loadProofImages();
      }
    } else {
      const error = await response.json();
      msg.textContent = 'Upload failed: ' + (error.error || 'Unknown error');
      msg.style.color = 'red';
    }
  } catch (err) {
    msg.textContent = 'Upload failed: ' + err.message;
    msg.style.color = 'red';
  }
}

// Function to help users enable notifications
async function enableUserNotifications(userId) {
  try {
    // First check if user exists and get their info
    const user = await API.request(`/api/admin/users/${userId}`);
    if (!user) {
      alert('User not found');
      return;
    }

    // Check if Firebase messaging is available
    if (!messaging) {
      alert('Firebase messaging not available. User needs to use a supported browser.');
      return;
    }

    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Notification permission denied. User needs to enable notifications manually.');
      return;
    }

    // Get FCM token
    const token = await messaging.getToken({
      vapidKey: "BLjD_rqopmKcujWud5s2M2cJrL6HUS156HJkbAGkflQV0wAHIIoAIf4dbbv2vpyDOQutvfMFf3-ATQBi3T9CbX8"
    });

    if (token) {
      // Save token to server
      const response = await fetch("/save-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API.token}`
        },
        body: JSON.stringify({ token })
      });

      if (response.ok) {
        alert(`Notifications enabled for user ${user.username}!`);
      } else {
        alert('Failed to save FCM token to server');
      }
    } else {
      alert('Failed to get FCM token');
    }
  } catch (err) {
    alert('Error enabling notifications: ' + err.message);
    console.error('Notification enable error:', err);
  }
}

// Function to refresh FCM token for current user
async function refreshFCMToken() {
  try {
    if (!messaging) {
      alert('Firebase messaging not available');
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('Notification permission required');
      return;
    }

    const token = await messaging.getToken({
      vapidKey: "BLjD_rqopmKcujWud5s2M2cJrL6HUS156HJkbAGkflQV0wAHIIoAIf4dbbv2vpyDOQutvfMFf3-ATQBi3T9CbX8"
    });

    if (token) {
      const response = await fetch("/save-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${API.token}`
        },
        body: JSON.stringify({ token })
      });

      if (response.ok) {
        alert('FCM token refreshed successfully!');
      } else {
        alert('Failed to refresh FCM token');
      }
    }
  } catch (err) {
    alert('Error refreshing FCM token: ' + err.message);
    console.error('FCM refresh error:', err);
  }
}

// Add proof upload handler
document.addEventListener('DOMContentLoaded', async () => {
  await ensureAdmin();

  // Add upload form handler
  const uploadForm = document.getElementById('proofUploadForm');
  if (uploadForm) {
    uploadForm.addEventListener('submit', handleProofUpload);
  }

  // Add notification enable form handler
  const notificationForm = document.getElementById('notificationForm');
  if (notificationForm) {
    notificationForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const userId = document.getElementById('userIdInput').value;
      const msg = document.getElementById('notificationMsg');

      if (!userId) {
        msg.textContent = 'Please enter a user ID';
        msg.style.color = 'red';
        return;
      }

      msg.textContent = 'Enabling notifications...';
      msg.style.color = 'blue';

      try {
        await enableUserNotifications(parseInt(userId));
        msg.textContent = 'Notifications enabled successfully!';
        msg.style.color = 'green';
      } catch (err) {
        msg.textContent = 'Failed to enable notifications: ' + err.message;
        msg.style.color = 'red';
      }
    });
  }

  // Add refresh token button handler
  const refreshTokenBtn = document.getElementById('refreshTokenBtn');
  if (refreshTokenBtn) {
    refreshTokenBtn.addEventListener('click', async () => {
      const msg = document.getElementById('refreshMsg');
      msg.textContent = 'Refreshing FCM token...';
      msg.style.color = 'blue';

      try {
        await refreshFCMToken();
        msg.textContent = 'FCM token refreshed successfully!';
        msg.style.color = 'green';
      } catch (err) {
        msg.textContent = 'Failed to refresh FCM token: ' + err.message;
        msg.style.color = 'red';
      }
    });
  }
  // Tabs: create form game select
  const gameField = document.getElementById('gameField');
  const gameSelMsg = document.getElementById('gameSelMsg');
  function setGame(g) {
    if (gameField) gameField.value = g;
    if (gameSelMsg) gameSelMsg.textContent = 'Selected: ' + g;
    updateSlotsHint();
  }
  document.getElementById('tab-ff').addEventListener('click', (e)=>{ e.preventDefault(); setGame('Free Fire'); e.target.classList.remove('secondary'); document.getElementById('tab-pubg').classList.add('secondary'); });
  document.getElementById('tab-pubg').addEventListener('click', (e)=>{ e.preventDefault(); setGame('PUBG'); e.target.classList.remove('secondary'); document.getElementById('tab-ff').classList.add('secondary'); });

  // Mode change -> update slots hint
  const modeField = document.getElementById('modeField');
  const slotsHint = document.getElementById('slotsHint');
  function defaultSlotsFor(game, mode){
    if (game === 'PUBG') { if (mode === 'Duo') return 50; if (mode === 'Squad') return 25; return 100; }
    else { if (mode === 'Duo') return 24; if (mode === 'Squad') return 12; return 48; }
  }
  function updateSlotsHint(){
    if (!modeField || !slotsHint) return;
    const g = gameField ? gameField.value : 'Free Fire';
    const m = modeField.value;
    slotsHint.textContent = 'Slots: ' + defaultSlotsFor(g, m);
  }
  if (modeField) modeField.addEventListener('change', updateSlotsHint);
  updateSlotsHint();

  document.getElementById('createTournamentForm').addEventListener('submit', createTournament);
  await loadAdminTournaments();

  // Listen for notifications via Socket.IO
  const socket = io();
  socket.on('notification', (data) => {
    if (data && data.message) {
      alert(data.message);
    }
  });

  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');
    if (action === 'viewregs') {
      viewRegistrations(id);
      return;
    }
    if (action === 'winner-reg') {
      const userId = btn.getAttribute('data-user');
      const tournamentId = btn.getAttribute('data-tournament');
      if (!userId || !tournamentId) return alert('Invalid user or tournament.');
      const sel = document.querySelector(`select[data-rank-for="${userId}"]`);
      const rankNum = sel ? parseInt(sel.value, 10) : 1;
      if (![1,2,3].includes(rankNum)) { alert('Invalid rank'); return; }
      API.request(`/api/admin/tournaments/${tournamentId}/winner`, {
        method: 'POST',
        body: { userId: parseInt(userId, 10), rank: rankNum }
      })
        .then(() => { alert('Winner saved and notified!'); viewRegistrations(tournamentId); })
        .catch(err => alert(err.message));
      return;
    }
    if (action === 'approve-reg') {
      const regId = btn.getAttribute('data-reg');
      API.request(`/api/admin/registrations/${regId}/approve`, { method: 'POST' })
        .then(() => { alert('Approved'); loadAdminTournaments(); })
        .catch(err => alert(err.message));
      return;
    }
    if (action === 'reject-reg') {
      const regId = btn.getAttribute('data-reg');
      if (!confirm('Reject this registration and free the slot?')) return;
      API.request(`/api/admin/registrations/${regId}/reject`, { method: 'POST' })
        .then(() => { alert('Rejected'); loadAdminTournaments(); })
        .catch(err => alert(err.message));
      return;
    }
    if (action === 'save') {
      saveTournament(id);
      return;
    }
    if (action === 'delete') {
      deleteTournament(id);
      return;
    }
  });

  // Manage list tabs
  const listGameSelMsg = document.getElementById('listGameSelMsg');
  function setListGame(g){ listGame = g; if (listGameSelMsg) listGameSelMsg.textContent = 'Showing: ' + g; loadAdminTournaments(); }
  document.getElementById('tab-list-ff').addEventListener('click', (e)=>{ e.preventDefault(); setListGame('Free Fire'); e.target.classList.remove('secondary'); document.getElementById('tab-list-pubg').classList.add('secondary'); });
  document.getElementById('tab-list-pubg').addEventListener('click', (e)=>{ e.preventDefault(); setListGame('PUBG'); e.target.classList.remove('secondary'); document.getElementById('tab-list-ff').classList.add('secondary'); });
});
