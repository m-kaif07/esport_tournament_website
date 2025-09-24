const API = {
  // Dynamically set API base for local network/mobile access
  base: (function() {
    // If running on localhost, use relative path
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') return '';
    // If running on a local IP, use that IP and port
    if (/^192\.168\./.test(location.hostname) || /^10\./.test(location.hostname) || /^172\./.test(location.hostname)) {
      return location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '');
    }
    // Otherwise, fallback to relative path
    return '';
  })(),
  tokenKey: 'ararena_token',

  get token() {
    return localStorage.getItem(this.tokenKey);
  },
  set token(val) {
    if (!val) localStorage.removeItem(this.tokenKey);
    else localStorage.setItem(this.tokenKey, val);
  },

  async request(path, { method='GET', headers={}, body, isForm=false } = {}) {
    const url = this.base + path;
    console.log('API request:', method, url);
    const h = { ...headers };
    if (!isForm) h['Content-Type'] = 'application/json';
    if (this.token) h['Authorization'] = 'Bearer ' + this.token;
    console.log('Request headers:', h);
    console.log('Request body:', body);
    let res, data;
    try {
      res = await fetch(url, {
        method, headers: h, body: isForm ? body : (body ? JSON.stringify(body) : undefined)
      });
    } catch (err) {
      console.error('Network error:', err);
      throw new Error('Network error: ' + err.message);
    }
    console.log('Response status:', res.status);
    try {
      data = await res.json();
    } catch (err) {
      console.error('Failed to parse JSON:', err);
      data = {};
    }
    console.log('Response data:', data);
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  },

  async me() {
    if (!this.token) return null;
    try { return await this.request('/api/auth/me'); } catch { return null; }
  }
};

// Modal utility
const Modal = {
  show(title, content, onConfirm, onCancel) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content">
        <button class="close-modal">&times;</button>
        <div class="modal-header">
          <h2>${title}</h2>
        </div>
        <div class="modal-body">
          ${content}
        </div>
        <div class="modal-footer">
          ${onCancel ? '<button class="btn secondary" id="modal-cancel">Cancel</button>' : ''}
          <button class="btn" id="modal-confirm">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Prevent Enter key from retriggering underlying focused button
    try {
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    } catch {}

    const keydownHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const btn = modal.querySelector('#modal-confirm');
        if (btn) btn.click();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };

    const closeModal = () => {
      modal.remove();
      document.removeEventListener('keydown', keydownHandler, true);
    };

    modal.querySelector('.close-modal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    // Capture keydown while modal is open
    document.addEventListener('keydown', keydownHandler, true);

    if (onCancel) {
      modal.querySelector('#modal-cancel').addEventListener('click', () => {
        onCancel();
        closeModal();
      });
    }

    modal.querySelector('#modal-confirm').addEventListener('click', () => {
      if (onConfirm) onConfirm();
      closeModal();
    });

    return modal;
  },

  alert(message) {
    return this.show('Notification', `<p>${message}</p>`);
  },

  confirm(message, onConfirm, onCancel) {
    return this.show('Confirm', `<p>${message}</p>`, onConfirm, onCancel);
  },

  prompt(title, fields, onSubmit) {
    const content = fields.map(field => `
      <label>
        ${field.label}
        <input type="${field.type || 'text'}" id="${field.id}" placeholder="${field.placeholder || ''}" required>
      </label>
    `).join('');
    return this.show(title, `<div class="form">${content}</div>`, () => {
      const values = {};
      fields.forEach(field => {
        values[field.id] = document.getElementById(field.id).value.trim();
        if (field.required && !values[field.id]) {
          Modal.alert(`${field.label} is required.`);
          return;
        }
      });
      onSubmit(values);
    });
  }
};
