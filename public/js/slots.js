function q(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function renderGrid(slots) {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  slots.forEach(s => {
    const card = document.createElement('div');
    card.className = `slot-card ${s.status}`;
    const names = [s.p1, s.p2, s.p3, s.p4].filter(Boolean);
    card.innerHTML = `
      <div class="slot-title">Slot ${s.slotNumber}</div>
      <div class="small">${s.status.toUpperCase()}</div>
      <div class="small">${names.join(', ') || '—'}</div>
    `;
    grid.appendChild(card);
  });
}

async function loadSlots(tournamentId) {
  try {
    const slots = await API.request(`/api/tournaments/${tournamentId}/slots`);
    renderGrid(slots);
  } catch (e) {
    document.getElementById('msg').textContent = e.message;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const tournamentId = q('id');
  if (!tournamentId) {
    document.getElementById('msg').textContent = 'Missing tournament id';
    return;
  }
  await loadSlots(tournamentId);

  const socket = io();
  const room = `tournament:${tournamentId}`;
  socket.emit('subscribe', room);
  socket.on('slot_update', (payload) => {
    if (!payload || String(payload.tournamentId) !== String(tournamentId)) return;
    // Refresh by patching in-place for simplicity
    loadSlots(tournamentId);
  });
  // Also listen for payment confirmations for current user
  const me = await API.me();
  if (me) {
    const userRoom = `user:${me.id}`;
    socket.emit('subscribe', userRoom);
    socket.on('payment_confirmed', (payload) => {
      if (payload && payload.tournamentId && String(q('id')) === String(payload.tournamentId)) {
        alert('Your payment is successful, and your slot has been confirmed.');
        loadSlots(tournamentId);
      }
    });
  }
});


