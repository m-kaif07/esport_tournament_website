function fmtDate(dt) {
  const d = new Date(dt);
  return d.toLocaleString();
}

// Notification settings functionality
async function initializeNotificationSettings() {
  const statusEl = document.getElementById('notificationStatus');
  const enableBtn = document.getElementById('enableNotificationsBtn');
  const disableBtn = document.getElementById('disableNotificationsBtn');
  const helpEl = document.getElementById('notificationHelp');

  // Check if notifications are supported
  if (!('Notification' in window)) {
    statusEl.textContent = 'Notifications are not supported in this browser.';
    helpEl.textContent = 'Please use a modern browser that supports notifications.';
    return;
  }

  // Check current permission status
  const permission = Notification.permission;

  if (permission === 'granted') {
    statusEl.textContent = 'Notifications are enabled. You will receive tournament updates.';
    enableBtn.style.display = 'none';
    disableBtn.style.display = 'inline-block';
    helpEl.textContent = 'Click "Disable Notifications" to stop receiving updates.';
  } else if (permission === 'denied') {
    statusEl.textContent = 'Notifications are blocked. You will not receive updates.';
    enableBtn.style.display = 'none';
    disableBtn.style.display = 'none';
    helpEl.textContent = 'To enable notifications: Go to browser settings → Notifications → Allow this site.';
  } else {
    statusEl.textContent = 'Notifications are not enabled. Enable them to receive tournament updates.';
    enableBtn.style.display = 'inline-block';
    disableBtn.style.display = 'none';
    helpEl.textContent = 'Click "Enable Notifications" to receive tournament updates.';
  }

  // Enable notifications button
  enableBtn.addEventListener('click', async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        // Get FCM token and save it
        if (typeof firebase !== 'undefined' && firebase.messaging) {
          const messaging = firebase.messaging();
          const token = await messaging.getToken({
            vapidKey: "BLjD_rqopmKcujWud5s2M2cJrL6HUS156HJkbAGkflQV0wAHIIoAIf4dbbv2vpyDOQutvfMFf3-ATQBi3T9CbX8"
          });

          if (token) {
            await fetch("/save-token", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${API.token}`
              },
              body: JSON.stringify({ token }),
            });
          }
        }

        statusEl.textContent = 'Notifications enabled successfully!';
        enableBtn.style.display = 'none';
        disableBtn.style.display = 'inline-block';
        helpEl.textContent = 'You will now receive tournament updates.';

        setTimeout(() => {
          initializeNotificationSettings(); // Refresh status
        }, 1000);
      } else {
        statusEl.textContent = 'Permission denied. Notifications not enabled.';
        helpEl.textContent = 'To enable notifications: Go to browser settings → Notifications → Allow this site.';
      }
    } catch (err) {
      console.error('Error enabling notifications:', err);
      statusEl.textContent = 'Failed to enable notifications. Please try again.';
    }
  });

  // Disable notifications button
  disableBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to disable notifications? You will stop receiving tournament updates.')) {
      try {
        // Remove FCM token from server
        await fetch("/save-token", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API.token}`
          },
          body: JSON.stringify({ token: null }),
        });

        statusEl.textContent = 'Notifications disabled.';
        enableBtn.style.display = 'inline-block';
        disableBtn.style.display = 'none';
        helpEl.textContent = 'Click "Enable Notifications" to receive updates again.';
      } catch (err) {
        console.error('Error disabling notifications:', err);
        statusEl.textContent = 'Failed to disable notifications. Please try again.';
      }
    }
  });
}

async function loadMyProfile() {
  const profileUsername = document.getElementById('profileUsername');
  const profileEmail = document.getElementById('profileEmail');

  // Load user info
  try {
    const user = await API.request('/api/auth/me');
    if (user && user.username) profileUsername.textContent = user.username;
    if (user && user.email) profileEmail.textContent = user.email;
  } catch (err) {
    msg.textContent = 'Failed to load profile: ' + err.message;
  }
  if (!API.token) {
    window.location.href = '/login.html';
    return;
  }
  const wrap = document.getElementById('myTours');
  const earnWrap = document.getElementById('myEarnings');
  const msg = document.getElementById('profileMsg');

  // Load registrations
  try {
    const regs = await API.request('/api/tournaments/me/registrations/list');
    if (!regs.length) {
      msg.textContent = 'No registrations yet.';
    } else {
      msg.textContent = '';
    }
    wrap.innerHTML = '';
    regs.forEach(t => {
      const banner = t.bannerPath ? t.bannerPath : '/img/placeholder-banner.jpg';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <img class="tour-banner" src="${banner}" alt="${t.title}"/>
        <h3>${t.title}</h3>
        <div class="tour-row">
          <span class="pill">${t.mode}</span>
          <span class="pill">${t.map}</span>
          <span class="pill">${fmtDate(t.dateTime)}</span>
        </div>
        <p class="small">Registered at ${fmtDate(t.registeredAt)}</p>
        <button class="btn small" style="margin-top:8px;" data-tid="${t.id}">View Details</button>
      `;
      // Add event listener for View Details button
      card.querySelector('button[data-tid]').addEventListener('click', async (e) => {
        const tid = t.id;
        try {
          const details = await API.request(`/api/tournaments/${tid}`);
          let info = `<strong>${details.title}</strong><br/>`;
          info += `Date: ${fmtDate(details.dateTime)}<br/>Map: ${details.map}<br/>Mode: ${details.mode}<br/>`;
          if (details.roomId || details.roomPassword) {
            info += `<br/><b>Room ID:</b> ${details.roomId || 'N/A'}<br/><b>Password:</b> ${details.roomPassword || 'N/A'}`;
          } else {
            info += `<br/><i>Room ID and Password not set yet.</i>`;
          }
          showModal('Tournament Details', info);
        } catch (err) {
          showModal('Tournament Details', 'Failed to load details: ' + err.message);
        }
      });
      wrap.appendChild(card);
// Simple modal utility for details
function showModal(title, content) {
  let modal = document.getElementById('profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'profile-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100vw';
    modal.style.height = '100vh';
    modal.style.background = 'rgba(0,0,0,0.4)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '9999';
    modal.innerHTML = `<div style="background:#fff;color:#111;padding:24px 32px;border-radius:8px;max-width:90vw;min-width:300px;box-shadow:0 2px 16px #0002;position:relative;">
      <button id="close-profile-modal" style="position:absolute;top:8px;right:12px;font-size:1.5em;background:none;border:none;cursor:pointer;">&times;</button>
      <h2 style="margin-top:0;">${title}</h2>
      <div>${content}</div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#close-profile-modal').onclick = () => modal.remove();
  } else {
    modal.querySelector('h2').textContent = title;
    modal.querySelector('div > div').innerHTML = content;
    modal.style.display = 'flex';
    modal.querySelector('#close-profile-modal').onclick = () => modal.remove();
  }
}
    });
  } catch (err) {
    msg.textContent = 'Failed to load registrations: ' + err.message;
    wrap.innerHTML = '<p>Error loading tournaments.</p>';
  }

  // Load earnings
  try {
    const earnings = await API.request('/api/auth/me/earnings');
    if (!earnings.length) {
      earnWrap.textContent = 'No earnings yet.';
    } else {
      const rows = earnings.map(e => `
        <tr>
          <td>${fmtDate(e.dateTime)}</td>
          <td>₹${e.amount}</td>
          <td>${e.description}</td>
        </tr>
      `).join('');
      earnWrap.innerHTML = `
        <table class="table small" style="width: 100%; border-collapse: collapse;">
          <thead style="background: #f5f5f5;">
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }
  } catch (err) {
    earnWrap.innerHTML = '<p>Error loading earnings: ' + err.message + '</p>';
  }
}

document.addEventListener('DOMContentLoaded', loadMyProfile);
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('logoutBtnProfile');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      API.token = '';
      window.location.href = '/';
    });
  }
});

// Initialize notification settings after profile loads
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initializeNotificationSettings();
  }, 500);
});
