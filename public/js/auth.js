const firebaseConfig = {
  apiKey: "AIzaSyBQDNxx8_9DFVOsJ5c4pn9kuzNxX6AxU0k",
  authDomain: "ak-arena.firebaseapp.com",
  projectId: "ak-arena",
  storageBucket: "ak-arena.firebasestorage.app",
  messagingSenderId: "883603092694",
  appId: "1:883603092694:web:238973cdc2057ae26b8577",
  measurementId: "G-MGTPR6RGT0"
};

let messaging = null;
try {
  if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    if (!firebase.apps || !firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    messaging = firebase.messaging();
  }
} catch {}

document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(loginForm);
      try {
        const data = await API.request('/api/auth/login', {
          method: 'POST',
          body: { email: form.get('email'), password: form.get('password') }
        });
        API.token = data.token;
        document.getElementById('loginMsg').textContent = 'Logged in! Redirecting...';
        // Try to capture notification permission/token on login too (helps older accounts)
        try {
          if (messaging) {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
              const token = await messaging.getToken({ vapidKey: "BLjD_rqopmKcujWud5s2M2cJrL6HUS156HJkbAGkflQV0wAHIIoAIf4dbbv2vpyDOQutvfMFf3-ATQBi3T9CbX8" });
              if (token) {
                await fetch("/save-token", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${API.token}` },
                  body: JSON.stringify({ token })
                });
              }
            }
          }
        } catch {}
        const redirectUrl = data.user.role === 'admin' ? '/admin.html' : '/tournaments.html';
        setTimeout(() => { window.location.href = redirectUrl; }, 600);
      } catch (err) {
          document.getElementById('loginMsg').textContent = 'Login failed: ' + (err.message || err);
          alert('Login failed: ' + (err.message || err));
          console.error('Login error:', err);
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      console.log('Signup form submit event triggered');
      const form = new FormData(signupForm);
      console.log('Signup form data:', {
        username: form.get('username'),
        email: form.get('email'),
        phone: form.get('phone'),
        password: form.get('password') ? '***' : ''
      });
      try {
        const payload = {
          username: form.get('username'),
          email: form.get('email'),
          phone: form.get('phone'),
          password: form.get('password')
        };
        console.log('Sending signup request to /api/auth/signup');
        const data = await API.request('/api/auth/signup', { method: 'POST', body: payload });
        console.log('Signup response received:', data);
        API.token = data.token;

        // Delay notification permission request slightly to ensure UI updates
        setTimeout(async () => {
          if (messaging && 'Notification' in window && 'serviceWorker' in navigator) {
            try {
              console.log("Requesting notification permission for new user...");
              const permission = await Notification.requestPermission();
              if (permission === 'granted') {
                console.log("Notification permission granted, getting FCM token...");
                const token = await messaging.getToken({ vapidKey: "BLjD_rqopmKcujWud5s2M2cJrL6HUS156HJkbAGkflQV0wAHIIoAIf4dbbv2vpyDOQutvfMFf3-ATQBi3T9CbX8" });
                if (token) {
                  console.log("FCM Token obtained, saving to server...");
                  const saveResponse = await fetch("/save-token", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${API.token}`
                    },
                    body: JSON.stringify({ token }),
                  });
                  if (saveResponse.ok) {
                    console.log("FCM token saved successfully");
                  } else {
                    console.error("Failed to save FCM token:", saveResponse.status);
                  }
                } else {
                  console.warn("Failed to obtain FCM token");
                }
              } else if (permission === 'denied') {
                console.log("Notification permission denied by user");
                setTimeout(() => {
                  alert("Notifications are disabled. You can enable them later from your browser settings.");
                }, 800);
              } else {
                console.log("Notification permission defaulted");
              }
            } catch (err) {
              console.error("Notification setup failed:", err);
              // Don't show error to user as it's not critical for basic functionality
            }
          } else {
            console.warn("Firebase messaging not available, notifications not supported, or service workers not supported");
          }
        }, 1000);

          document.getElementById('signupMsg').textContent = 'Account created! Redirecting...';
          // If admin, show admin login info
          if (data.user && data.user.role === 'admin') {
            document.getElementById('signupMsg').textContent += '\nAdmin account created. Use admin@ararena.com / admin123 to login.';
          }
          setTimeout(() => { window.location.href = (data.user && data.user.role === 'admin') ? '/admin.html' : '/tournaments.html'; }, 600);
      } catch (err) {
          console.log('Signup error:', err);
          document.getElementById('signupMsg').textContent = 'Signup failed: ' + (err.message || err);
          alert('Signup failed: ' + (err.message || err));
          console.error('Signup error:', err);
      }
    });
  }

  // Handle forgot password link
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = '/forgot-password.html';
    });
  }
});
