function modeTeamSize(mode) {
  if (mode === 'Duo') return 2;
  if (mode === 'Squad') return 4;
  return 1;
}

const alertedMatches = new Set();
const socket = io();
let registering = false;

// Initialize alert container
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('custom-alerts-container')) {
    const alertsContainer = document.createElement('div');
    alertsContainer.id = 'custom-alerts-container';
    document.body.appendChild(alertsContainer);
  }
});

// Override default alert
window.alert = (message) => {
  showCustomAlert(message);
};

// Enhanced custom alert function
function showCustomAlert(message, type = 'info') {
  const alertsContainer = document.getElementById('custom-alerts-container') || document.body;
  
  // Remove any existing alerts with the same message
  const existingAlerts = document.querySelectorAll('.custom-alert');
  existingAlerts.forEach(alert => {
    if (alert.textContent === message) {
      alert.remove();
    }
  });

  // Create new alert
  const alert = document.createElement('div');
  alert.className = `custom-alert ${type}`;
  alert.textContent = message;

  // Add close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'alert-close';
  closeBtn.innerHTML = '×';
  closeBtn.onclick = () => {
    alert.classList.remove('show');
    setTimeout(() => alert.remove(), 300);
  };
  alert.appendChild(closeBtn);

  alertsContainer.appendChild(alert);

  // Trigger animation
  requestAnimationFrame(() => {
    alert.classList.add('show');
  });

  // Auto remove after 5 seconds
  setTimeout(() => {
    alert.classList.remove('show');
    setTimeout(() => alert.remove(), 300);
  }, 5000);
}

function fmtDate(dt) {
  const d = new Date(dt);
  return d.toLocaleString();
}

// Countdown Timer functionality
function updateTournamentCard(card, data) {
  const banner = card.querySelector('.tournament-banner');
  const existingBadge = banner.querySelector('.tournament-winner-badge');

  // Check if tournament has any winner
  const hasWinner = data.winner1Name || data.winner2Name || data.winner3Name;
  const winnerNames = [data.winner1Name, data.winner2Name, data.winner3Name].filter(Boolean);

  if (hasWinner && winnerNames.length > 0) {
    const winnerBadge = `
      <div class="tournament-winner-badge new-winner" data-winner>
        <span class="winner-name">Winner: ${winnerNames.join(', ')}</span>
      </div>
    `;

    if (existingBadge) {
      // Update existing badge
      existingBadge.outerHTML = winnerBadge;
    } else {
      // Add new badge
      banner.insertAdjacentHTML('afterbegin', winnerBadge);
    }

    // Show notification for new winner
    showCustomAlert(`Winner announced: ${winnerNames.join(', ')}!`, 'success');
  } else if (existingBadge) {
    // Remove winner badge if no winner
    existingBadge.remove();
  }

  // If startTime changed, re-fetch to get proper sorting
  if (data.startTime && card.getAttribute('data-starttime') !== data.startTime) {
    card.setAttribute('data-starttime', data.startTime);
    if (pageGame) {
      fetchTournaments();
    }
  }
}

function updateCountdown(element, targetDate) {
  const now = new Date().getTime();
  const target = new Date(targetDate).getTime();
  const difference = target - now;

  if (difference <= 0) {
    // Tournament has started
    element.innerHTML = '<div class="countdown-item"><span class="countdown-value">Tournament Started</span></div>';
    return false;
  }

  // Time calculations
  const days = Math.floor(difference / (1000 * 60 * 60 * 24));
  const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((difference % (1000 * 60)) / 1000);

  // Update countdown values
  element.querySelector('.days').textContent = days.toString().padStart(2, '0');
  element.querySelector('.hours').textContent = hours.toString().padStart(2, '0');
  element.querySelector('.minutes').textContent = minutes.toString().padStart(2, '0');
  element.querySelector('.seconds').textContent = seconds.toString().padStart(2, '0');

  // Add urgent class if less than 1 hour remaining
  if (difference < (1000 * 60 * 60)) {
    element.classList.add('urgent');
  }

  return true;
}

// Initialize all countdown timers
function initCountdowns() {
  const countdowns = document.querySelectorAll('.countdown-timer');
  countdowns.forEach(countdown => {
    const startTime = countdown.dataset.startTime;
    if (startTime) {
      updateCountdown(countdown, startTime);
      // Update every second
      const timerId = setInterval(() => {
        const shouldContinue = updateCountdown(countdown, startTime);
        if (!shouldContinue) {
          clearInterval(timerId);
        }
      }, 1000);
      // Store the timer ID for cleanup
      countdown.dataset.timerId = timerId;
    }
  });
}

// Clean up old timers when re-rendering
function cleanupCountdowns() {
  const countdowns = document.querySelectorAll('.countdown-timer');
  countdowns.forEach(countdown => {
    const timerId = countdown.dataset.timerId;
    if (timerId) {
      clearInterval(parseInt(timerId));
    }
  });
}

let pageGame = null; // selected after click
async function fetchTournaments() {
  try {
    const list = await API.request('/api/tournaments?game=' + encodeURIComponent(pageGame));
    console.log('Fetched tournaments:', list);

    // Sort tournaments by startTime descending (newest to oldest)
    const sortedList = list.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));

    renderTournaments(sortedList);
    // Check for matches starting soon with specific notification times
    const now = new Date();
    const notifyTimes = [30, 10, 5, 2]; // minutes
    sortedList.forEach(t => {
      const start = new Date(t.dateTime);
      const diffMs = start - now;
      const diffMin = Math.ceil(diffMs / 60000);
      if (diffMs > 0 && notifyTimes.includes(diffMin) && !alertedMatches.has(t.id)) {
        showCustomAlert(`Match "${t.title}" Starting In ${diffMin} Minutes!`);
        alertedMatches.add(t.id);
      }
    });
  } catch (err) {
    console.error('Error fetching tournaments:', err);
    document.getElementById('tourMsg').textContent = err.message;
  }
}

function renderTournaments(list) {
    console.log('Rendering tournaments:', list.length);
    const wrap = document.getElementById('tournamentsList');
    wrap.classList.remove('hidden'); // Show the tournaments list
    
    // Cleanup existing countdowns
    cleanupCountdowns();
    
    wrap.innerHTML = '';
    console.log('Wrap cleared');
    if (!list || list.length === 0) {
      wrap.innerHTML = '<p>No tournaments available at the moment.</p>';
      return;
    }
    list.forEach(t => {
      console.log('Adding card for', t.title);
      const teamSize = modeTeamSize(t.mode);
      const slotsText = `${t.slotsFilled}/${t.totalSlots}`;
      const banner = t.bannerPath ? t.bannerPath : '/img/placeholder-banner.jpg';
      const feeText = t.fee && t.fee > 0 ? `₹${t.fee}` : 'Free';
      const prizeText = t.prizePool && t.prizePool > 0 ? `₹${t.prizePool}` : 'TBA';
      const progressPercentage = (t.slotsFilled / t.totalSlots) * 100;
      const isFull = t.slotsFilled >= t.totalSlots;
      
      // Schedule tournament reminder notifications
      if (window.notificationManager?.initialized) {
        window.notificationManager.scheduleReminder(t);
      }
      
      const card = document.createElement('div');
      card.className = 'tournament-card';
      card.setAttribute('data-tid', t.id);
      card.setAttribute('data-starttime', t.dateTime);

      // Check if tournament has any winner
      const hasWinner = t.winner1Name || t.winner2Name || t.winner3Name;
      const winnerNames = [t.winner1Name, t.winner2Name, t.winner3Name].filter(Boolean);
      const winnerBadge = hasWinner ? `
        <div class="tournament-winner-badge" data-winner>
          <span class="winner-name">Winner: ${winnerNames.join(', ')}</span>
        </div>
      ` : '';

      card.innerHTML = `
        <div class="tournament-banner">
          <img src="${banner}" alt="${t.title} Banner">
          ${winnerBadge}
        </div>
        <div class="tournament-content">
          <div class="tournament-header">
            <div>
              <h3 class="tournament-title">${t.title}</h3>
              <div class="tournament-game">${t.game}</div>
            </div>
            <span class="status-badge ${isFull ? 'full' : 'open'}">${isFull ? 'Full' : 'Open'}</span>
          </div>
          
          <div class="countdown-timer" data-start-time="${t.dateTime}" id="countdown-${t.id}">
            <div class="countdown-item">
              <span class="countdown-value days">--</span>
              <span class="countdown-label">Days</span>
            </div>
            <span class="countdown-separator">:</span>
            <div class="countdown-item">
              <span class="countdown-value hours">--</span>
              <span class="countdown-label">Hours</span>
            </div>
            <span class="countdown-separator">:</span>
            <div class="countdown-item">
              <span class="countdown-value minutes">--</span>
              <span class="countdown-label">Mins</span>
            </div>
            <span class="countdown-separator">:</span>
            <div class="countdown-item">
              <span class="countdown-value seconds">--</span>
              <span class="countdown-label">Secs</span>
            </div>
          </div>

          <div class="tournament-info">
            <div class="info-item">
              <span class="info-label">Mode</span>
              <span class="info-value">${t.mode}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Entry Fee</span>
              <span class="info-value">${feeText}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Prize Pool</span>
              <span class="info-value">${prizeText}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Starts</span>
              <span class="info-value">${fmtDate(t.dateTime)}</span>
            </div>
          </div>

          <div class="slots-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progressPercentage}%"></div>
            </div>
            <div class="slots-text">${slotsText} slots filled</div>
          </div>

          ${(t.prize1 || t.prize2 || t.prize3) ? `
          <div class="prize-list">
            <div class="prize-item first">
              <div class="prize-place">1st Place</div>
              <div class="prize-amount">₹${t.prize1 || 0}</div>
            </div>
            <div class="prize-item second">
              <div class="prize-place">2nd Place</div>
              <div class="prize-amount">₹${t.prize2 || 0}</div>
            </div>
            <div class="prize-item third">
              <div class="prize-place">3rd Place</div>
              <div class="prize-amount">₹${t.prize3 || 0}</div>
            </div>
          </div>
          ` : ''}

          <div class="tournament-actions">
            <button class="tournament-btn" data-action="details" data-id="${t.id}">View Details</button>
            <a class="tournament-btn" href="/slots.html?id=${t.id}">View Slots</a>
            <button class="tournament-btn primary" data-action="register" data-id="${t.id}">Register</button>
          </div>
        </div>
      `;
      wrap.appendChild(card);
    });

    // Initialize countdown timers
    initCountdowns();

    // Add click handler for buttons
    wrap.addEventListener('click', async e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      
      if (btn.dataset.action === 'register') {
        await handleRegister(btn.dataset.id);
      } else if (btn.dataset.action === 'details') {
        await showTournamentDetails(btn.dataset.id);
      }
    });
  }
 // Modal functionality
// Custom alert function
function showCustomAlert(message) {
  // Remove any existing alerts
  const existingAlert = document.querySelector('.custom-alert');
  if (existingAlert) {
    existingAlert.remove();
  }

  // Create new alert
  const alert = document.createElement('div');
  alert.className = 'custom-alert';
  alert.textContent = message;
  document.body.appendChild(alert);

  // Trigger animation
  setTimeout(() => alert.classList.add('show'), 10);

  // Remove alert after 3 seconds
  setTimeout(() => {
    alert.classList.remove('show');
    setTimeout(() => alert.remove(), 300);
  }, 3000);
}

// Copy to clipboard function
async function copyToClipboard(button) {
  const textToCopy = button.dataset.copy;
  try {
    await navigator.clipboard.writeText(textToCopy);
    button.classList.add('copied');
    showCustomAlert('Copied to clipboard!');
    setTimeout(() => button.classList.remove('copied'), 2000);
  } catch (err) {
    showCustomAlert('Failed to copy text');
  }
}

async function showTournamentDetails(id) {
  try {
    const tournament = await API.request(`/api/tournaments/${id}`);
    const modal = document.getElementById('tournamentModal');
    const content = document.getElementById('modalContent');
    const title = document.getElementById('modalTitle');

    title.textContent = tournament.title;
    
    content.innerHTML = `
      <div class="modal-section game-info">
        <h3 class="section-title">Tournament Info</h3>
        <div class="detail-group">
          <div class="detail-item">
            <div class="detail-label">Game</div>
            <div class="detail-value">${tournament.game}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Mode</div>
            <div class="detail-value">${tournament.mode}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Map</div>
            <div class="detail-value">${tournament.map || 'TBA'}</div>
          </div>
          <div class="detail-item highlight">
            <div class="detail-label">Start Time</div>
            <div class="detail-value">${fmtDate(tournament.dateTime)}</div>
          </div>
        </div>
      </div>

      <div class="modal-section room-details">
        <h3 class="section-title">Room Details</h3>
        <div class="detail-group special">
          <div class="detail-item room-id">
            <div class="detail-label">Room ID</div>
            <div class="detail-value with-copy">
              <span>${tournament.roomId || 'Available 15 mins before start'}</span>
              ${tournament.roomId ? `
                <button class="copy-btn" data-copy="${tournament.roomId}" onclick="copyToClipboard(this)">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2z"/>
                    <path d="M16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2"/>
                  </svg>
                </button>
              ` : ''}
            </div>
          </div>
          <div class="detail-item room-pass">
            <div class="detail-label">Room Password</div>
            <div class="detail-value with-copy">
              <span>${tournament.password || 'Available with Room ID'}</span>
              ${tournament.password ? `
                <button class="copy-btn" data-copy="${tournament.password}" onclick="copyToClipboard(this)">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M8 4v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.242a2 2 0 0 0-.602-1.43L16.083 2.57A2 2 0 0 0 14.685 2H10a2 2 0 0 0-2 2z"/>
                    <path d="M16 18v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2"/>
                  </svg>
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>

      <div class="modal-section prize-details">
        <h3 class="section-title">Prize & Entry Details</h3>
        <div class="detail-group">
          <div class="detail-item">
            <div class="detail-label">Entry Fee</div>
            <div class="detail-value">${tournament.fee ? `₹${tournament.fee}` : 'Free'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Prize Pool</div>
            <div class="detail-value highlight">${tournament.prizePool ? `₹${tournament.prizePool}` : 'TBA'}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Slots Filled</div>
            <div class="detail-value">${tournament.slotsFilled}/${tournament.totalSlots}</div>
          </div>
          <div class="detail-item">
            <div class="detail-label">Players</div>
            <div class="detail-value">${tournament.filledPlayers}/${tournament.playerCapacity}</div>
          </div>
        </div>
      </div>

      ${(tournament.prize1 || tournament.prize2 || tournament.prize3) ? `
      <div class="prize-list">
        <div class="prize-item first">
          <div class="prize-place">1st Place</div>
          <div class="prize-amount">₹${tournament.prize1 || 0}</div>
        </div>
        <div class="prize-item second">
          <div class="prize-place">2nd Place</div>
          <div class="prize-amount">₹${tournament.prize2 || 0}</div>
        </div>
        <div class="prize-item third">
          <div class="prize-place">3rd Place</div>
          <div class="prize-amount">₹${tournament.prize3 || 0}</div>
        </div>
      </div>
      ` : ''}
    `;

    modal.classList.add('active');
  } catch (err) {
    console.error('Error fetching tournament details:', err);
    Modal.alert(err.message);
  }
}

function closeModal() {
  const modal = document.getElementById('tournamentModal');
  modal.classList.remove('active');
}

// Add click event listener for the modal overlay
document.getElementById('tournamentModal').addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    closeModal();
  }
});

// Add escape key listener to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
  }
});

async function handleRegister(id) {
   if (registering) return;
  registering = true;
  if (!API.token) {
    Modal.alert('Please login first.');
    window.location.href = '/login.html';
    return;
  }
  // fetch tournament to know team size
  let t;
  try {
    t = await API.request(`/api/tournaments/${id}`);
  } catch (e) {
    Modal.alert(e.message);
    return;
  }
  // Check if tournament has started
  const now = new Date();
  const start = new Date(t.dateTime);
  if (now >= start) {
    Modal.alert('Tournament has already started. Registration closed.');
    registering = false;
    return;
  }
  const size = modeTeamSize(t.mode);
  const participants = [];

  // Collect participant details using modal
  for (let i = 0; i < size; i++) {
    const fields = [
      { id: `name${i}`, label: `Player ${i+1} Name`, type: 'text', required: true },
      { id: `uid${i}`, label: `Player ${i+1} UID (numbers only)`, type: 'text', required: true }
    ];
    const values = await new Promise(resolve => {
      Modal.prompt(`Enter Player ${i+1} Details`, fields, resolve);
    });
    if (!values || !values[`name${i}`] || !values[`uid${i}`]) {
      Modal.alert('All fields are required.');
      registering = false;
      return;
    }
    if (!/^\d{4,}$/.test(values[`uid${i}`])) {
      Modal.alert('Invalid UID format.');
      registering = false;
      return;
    }
    participants.push({ name: values[`name${i}`], uid: values[`uid${i}`] });
  }

  // Collect PhonePe number
  const phonepeFields = [
    { id: 'phonepe_number', label: 'Enter your PhonePe number or UPI ID', type: 'text', required: true }
  ];
  const phonepeValues = await new Promise(resolve => {
    Modal.prompt('Payment Details', phonepeFields, resolve);
  });
  if (!phonepeValues || !phonepeValues.phonepe_number) {
    Modal.alert('PhonePe number/UPI is required.');
    registering = false;
    return;
  }
  const phonepe_number = phonepeValues.phonepe_number;
  if (!/^\d{10}$/.test(phonepe_number) && !/^[\w.\-]+@[\w.\-]+$/.test(phonepe_number)) {
    Modal.alert('Invalid PhonePe number or UPI ID.');
    registering = false;
    return;
  }

  // Payment flow: skip if fee is zero
  const fee = t.fee || 0;
  let utr = null;
  if (fee <= 0) {
    // Directly register; backend will auto-confirm
  } else if (t.qrPath) {
    const msg = `Make payment of ₹${fee} to the QR below. After payment, copy your UTR from PhonePe/Google Pay and paste it when asked.`;
    // Open a centered modal using window.open
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    const popupWidth = 420;
    const popupHeight = 560;
    const left = (screenWidth - popupWidth) / 2;
    const top = (screenHeight - popupHeight) / 2;
    const w = window.open('', '', `width=${popupWidth},height=${popupWidth},left=${left},top=${top},scrollbars=yes,resizable=yes`);
    w.document.write(`<html><head><title>Payment</title><link rel="stylesheet" href="/css/styles.css"></head><body style="padding:20px;font-family:sans-serif;background: linear-gradient(180deg, #0b0f1a 0%, #0a0d17 100%);color:#e8ecf7;margin:0;">
      <div style="background:#12182a;border:1px solid #1a2342;border-radius:16px;padding:20px;box-shadow:0 10px 30px rgba(0,0,0,0.3);">
        <h3 style="margin-top:0;color:#00e5ff;">Complete Payment</h3>
        <p>${msg}</p>
        <img src="${t.qrPath}" alt="Payment QR" style="max-width:360px;border:1px solid #ddd;border-radius:8px;display:block;margin:0 auto;"/>
        <p style="margin-top:12px"><b>Note:</b> Make payment and enter your UTR number below.</p>
        <p>Amount to pay: <b style="color:#19c37d;">₹${fee}</b></p>
        <input id="utr" type="text" placeholder="Enter UTR number" style="width:100%;padding:10px;border-radius:10px;border:1px solid #26355f;background:#0f1533;color:#e8ecf7;margin-top:8px;"/>
        <button id="ok" style="margin-top:12px;background:linear-gradient(45deg,#00e5ff,#8a2be2);color:#02040a;font-weight:700;border:none;padding:10px 16px;border-radius:12px;cursor:pointer;width:100%;">Submit Payment</button>
        <div id="m" style="margin-top:8px;color:#ff4d4d;"></div>
      </div>
      <script>document.getElementById('ok').onclick = function(){ const v = document.getElementById('utr').value.trim(); if(!v){ document.getElementById('m').textContent='UTR is required'; return;} window.opener.postMessage({ utr: v }, '*'); window.close(); };</script>
    </body></html>`);
    try {
      utr = await new Promise(resolve => {
        function onMsg(ev){ if(ev && ev.data && ev.data.utr){ window.removeEventListener('message', onMsg); resolve(ev.data.utr); } }
        window.addEventListener('message', onMsg);
      });
    } catch (e) {
      registering = false;
      return;
    }
  } else {
    Modal.alert(`Make payment of ₹${fee} and keep your UTR handy.`);
    const utrFields = [
      { id: 'utr', label: 'Enter your UTR number', type: 'text', required: true }
    ];
    const utrValues = await new Promise(resolve => {
      Modal.prompt('UTR Details', utrFields, resolve);
    });
    if (!utrValues || !utrValues.utr) {
      Modal.alert('UTR is required.');
      registering = false;
      return;
    }
    utr = utrValues.utr;
  }
  try {
    await API.request(`/api/tournaments/${id}/register`, { method: 'POST', body: { phone: phonepe_number, phonepe_number, participants, utr } });
    if (fee <= 0) {
      Modal.alert('Registered and auto-confirmed. Check the slots page.');
    } else {
      Modal.alert('Please wait, the admin is verifying your payment.');
    }
    window.location.href = '/tournaments.html';
  } catch (err) {
    Modal.alert(err.message);
  } finally {
    registering = false;
  }
}

async function handleDetails(id) {
  if (!API.token) {
    alert('Please login to view details.');
    window.location.href = '/login.html';
    return;
  }
  try {
    const t = await API.request(`/api/tournaments/${id}`);
    const lines = [
      `Title: ${t.title}`,
      `Map: ${t.map}`,
      `Mode: ${t.mode}`,
      `Start: ${fmtDate(t.dateTime)}`,
      `Slots: ${t.slotsFilled}/${t.totalSlots}`,
      `Players: ${t.filledPlayers}/${t.playerCapacity}`
    ];
    if (t.prize1 || t.prize2 || t.prize3 || t.prizePool) {
      lines.push('');
      lines.push(`Prizes — 1st: ₹${t.prize1 || 0}, 2nd: ₹${t.prize2 || 0}, 3rd: ₹${t.prize3 || 0} (Pool: ${t.prizePool ? '₹'+t.prizePool : 'TBA'})`);
    }
    if (t.showRoom) {
      lines.push('');
      lines.push(`Room ID: ${t.roomId || '(TBA)'}`);
      lines.push(`Password: ${t.roomPassword || '(TBA)'}`);
    } else {
      lines.push('');
      lines.push('Room details will appear 5 minutes before start (for registered players).');
    }
    if (!t.isRegistered) {
      lines.push('');
      lines.push('REGISTER NOW!');
    }
    alert(lines.join('\n'));

    // Subscribe to tournament room for notifications
    socket.emit('subscribe', `tournament:${id}`);

    // Check if match is starting soon with specific times
    const now = new Date();
    const start = new Date(t.dateTime);
    const diffMs = start - now;
    const notifyTimes = [30, 10, 5, 2];
    const diffMin = Math.ceil(diffMs / 60000);
    if (diffMs > 0 && notifyTimes.includes(diffMin)) {
      let msg = `Match "${t.title}" Starting In ${diffMin} Minutes!`;
      if (!t.isRegistered) msg += " REGISTER NOW!";
      alert(msg);
    }
  } catch (err) {
    alert(err.message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Game selection cards
  const gameSelect = document.getElementById('gameSelect');
  const listWrap = document.getElementById('tournamentsList');
  const msg = document.getElementById('selectedGameMsg');
  function chooseGame(g){
    pageGame = g;
    if (gameSelect) gameSelect.classList.add('hidden');
    if (listWrap) listWrap.classList.remove('hidden');
    if (msg) { msg.classList.remove('hidden'); msg.textContent = 'Showing: ' + g; }
    fetchTournaments();
  }
  const cardFf = document.getElementById('card-ff');
  const cardPubg = document.getElementById('card-pubg');
  if (cardFf) { cardFf.addEventListener('click', ()=> chooseGame('Free Fire')); cardFf.addEventListener('keypress', (e)=>{ if (e.key==='Enter') chooseGame('Free Fire'); }); }
  if (cardPubg) { cardPubg.addEventListener('click', ()=> chooseGame('PUBG')); cardPubg.addEventListener('keypress', (e)=>{ if (e.key==='Enter') chooseGame('PUBG'); }); }

  // Do not fetch until a game is chosen
  // Poll every 15s for live updates (fallback if WebSocket fails)
  setInterval(fetchTournaments, 15000);

  // Listen for notifications via Socket.IO
  socket.on('notification', (data) => {
    if (data && data.message) {
      alert(data.message);
    }
  });

  // Subscribe to user room for personal notifications
  if (API.token) {
    try {
      const user = await API.me();
      if (user && user.id) {
        socket.emit('subscribe', `user:${user.id}`);
      }
    } catch (e) {
      // Ignore
    }
  }

  // Listen for payment confirmed
  socket.on('payment_confirmed', (data) => {
    if (data && data.title) {
      alert(`Your payment has been confirmed for tournament "${data.title}"!`);
    }
  });

  // Subscribe to tournament updates for real-time winner notifications
  socket.on('tournament.updated', (data) => {
    console.log('Tournament updated:', data);
    if (data && data.id) {
      const card = document.querySelector(`[data-tid="${data.id}"]`);
      if (card) {
        // Update existing card
        updateTournamentCard(card, data);
      } else {
        // Card not found, re-fetch all tournaments
        if (pageGame) {
          fetchTournaments();
        }
      }
    }
  });

  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const action = btn.getAttribute('data-action');
    if (action === 'register') handleRegister(id);
    if (action === 'details') handleDetails(id);
  });
});
