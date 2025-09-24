document.addEventListener('DOMContentLoaded', () => {
  const forgotPasswordForm = document.getElementById('forgotPasswordForm');
  const forgotPasswordMsg = document.getElementById('forgotPasswordMsg');

  if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(forgotPasswordForm);
      const email = form.get('email');

      try {
        forgotPasswordMsg.textContent = 'Sending reset link...';
        forgotPasswordMsg.style.color = 'var(--muted)';

        const data = await API.request('/api/auth/forgot-password', {
          method: 'POST',
          body: { email }
        });

        forgotPasswordMsg.textContent = 'Reset link sent! Check your email for instructions.';
        forgotPasswordMsg.style.color = 'var(--success)';
        forgotPasswordForm.reset();
      } catch (err) {
        forgotPasswordMsg.textContent = 'Error: ' + (err.message || err);
        forgotPasswordMsg.style.color = 'var(--danger)';
        console.error('Forgot password error:', err);
      }
    });
  }
});
