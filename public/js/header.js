async function renderHeader() {
  const header = document.getElementById('header');
  const footer = document.getElementById('footer');
  const user = await API.me();

  const path = location.pathname.replace(/\\/g, '/');
  function link(href, label, icon) {
    const active = (href === '/' ? path === '/' : path.indexOf(href) === 0) ? 'active' : '';
    const isHome = href === '/';
    return `<a href="${href}" class="nav-link ${active} ${isHome ? 'nav-home' : ''}" data-label="${label}">
      <span class="nav-icon">${icon}</span>
      <span class="nav-text">${label}</span>
    </a>`;
  }

  // Bottom navigation links - Home in center, Tournaments left, Proofs right
  const bottomNavLinks = [
    link('/tournaments.html', 'Tournaments', '🏆'),
    link('/', 'Home', '🏠'),
    link('/proof.html', 'Proofs', '📸')
  ].join('');

  let rightHtml = '';
  if (user) {
    const avatar = user.profilePic ? `<img src="${user.profilePic}" alt="avatar" class="avatar">` : `<div class="avatar avatar-initial">${(user.username || 'U').slice(0,1).toUpperCase()}</div>`;
    rightHtml = `
      <div class="user-box">
        <a href="/profile.html" class="user-link">${avatar}<span class="username">${user.username || 'User'}</span></a>
        <button class="btn small secondary logout-desktop" id="logoutLink">Logout</button>
        ${user.role === 'admin' ? '<a class="btn small admin-link" href="/admin.html" style="margin-left:6px;">Admin</a>' : ''}
      </div>`;
  } else {
    rightHtml = `
      <div class="auth-box">
        <a class="btn small" href="/signup.html">Signup</a>
        <a class="btn small secondary" href="/login.html">Login</a>
      </div>`;
  }

  // Clean header with only logo and profile
  header.innerHTML = `
    <div class="site-header">
      <div class="left">
        <div class="brand-name">SkillzMatter</div>
        <div class="tagline">Because Skillz Matter Most</div>
      </div>
      <div class="right">${rightHtml}</div>
    </div>
  `;

  // Footer with bottom navigation
  footer.innerHTML = `
    <div class="bottom-nav">
      <nav class="bottom-nav-links">${bottomNavLinks}</nav>
    </div>
    <div class="container" style="text-align:center; color:#9ca3af; font-size:12px; margin-top: 20px;">
      <p>Note: AKEsports organizes only skill-based eSports tournaments. This platform does not involve gambling or betting.</p>
      <p>Privacy Policy © AKEsports | Email: <a href="mailto:akteamasupport@gmail.com" style="color:#93c5fd">akteamasupport@gmail.com</a></p>
      <p>
        <a href="/terms.html" style="color:#93c5fd">Terms & Conditions</a> |
        <a href="/privacy.html" style="color:#93c5fd">Privacy Policy</a> |
        <a href="/faq.html" style="color:#93c5fd">FAQ</a> |
        <a href="/contact.html" style="color:#93c5fd">Contact Us</a>
      </p>
    </div>`;

  const logoutLink = document.getElementById('logoutLink');
  if (logoutLink) {
    logoutLink.addEventListener('click', (e) => {
      e.preventDefault();
      API.token = '';
      window.location.href = '/';
    });
  }
}
document.addEventListener('DOMContentLoaded', renderHeader);


// Register Firebase messaging service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/firebase-messaging-sw.js')
    .then(reg => {
      console.log('Service Worker registered successfully:', reg.scope);
      // Check for updates
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('New service worker available. Reloading...');
            window.location.reload();
          }
        });
      });
    })
    .catch(err => {
      console.warn('Service Worker registration failed:', err);
      // Don't show error to user as it's not critical for basic functionality
    });
} else {
  console.warn('Service Workers not supported in this browser');
}
