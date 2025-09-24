document.addEventListener('DOMContentLoaded', () => {
  const resetPasswordForm = document.getElementById('resetPasswordForm');
  const resetPasswordMsg = document.getElementById('resetPasswordMsg');

  // Get token from URL parameters
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  if (!token) {
    resetPasswordMsg.textContent = 'Invalid or missing reset token.';
    resetPasswordMsg.style.color = 'var(--danger)';
    resetPasswordForm.style.display = 'none';
    return;
  }

  if (resetPasswordForm) {
    resetPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(resetPasswordForm);
      const password = form.get('password');
      const confirmPassword = form.get('confirmPassword');

      if (password !== confirmPassword) {
        resetPasswordMsg.textContent = 'Passwords do not match.';
        resetPasswordMsg.style.color = 'var(--danger)';
        return;
      }

      if (password.length < 6) {
        resetPasswordMsg.textContent = 'Password must be at least 6 characters long.';
        resetPasswordMsg.style.color = 'var(--danger)';
        return;
      }

      try {
        resetPasswordMsg.textContent = 'Resetting password...';
        resetPasswordMsg.style.color = 'var(--muted)';

        const data = await API.request('/api/auth/reset-password', {
          method: 'POST',
          body: { token, password }
        });

        resetPasswordMsg.textContent = 'Password updated successfully! Please login again.';
        resetPasswordMsg.style.color = 'var(--success)';
        resetPasswordForm.reset();
        
        // Redirect to login page after 2 seconds
        setTimeout(() => {
          window.location.href = '/login.html';
        }, 2000);
      } catch (err) {
        resetPasswordMsg.textContent = 'Error: ' + (err.message || err);
        resetPasswordMsg.style.color = 'var(--danger)';
        console.error('Reset password error:', err);
      }
    });
  }
});
