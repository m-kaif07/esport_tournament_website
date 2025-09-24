class NotificationManager {
  constructor() {
    this.messaging = firebase.messaging();
    this.initialized = false;
    this.notificationPermission = false;
  }

  async init() {
    if (this.initialized) return;

    try {
      await this.checkNotificationSupport();
      await this.requestNotificationPermission();
      await this.setupMessaging();
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize notifications:', error);
      throw error;
    }
  }

  async checkNotificationSupport() {
    if (!('Notification' in window)) {
      throw new Error('This browser does not support notifications');
    }
    if (!('serviceWorker' in navigator)) {
      throw new Error('This browser does not support service workers');
    }
  }

  async requestNotificationPermission() {
    const permission = await Notification.requestPermission();
    this.notificationPermission = permission === 'granted';
    if (!this.notificationPermission) {
      throw new Error('Notification permission denied');
    }
  }

  async setupMessaging() {
    try {
      const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      const token = await this.messaging.getToken({
        vapidKey: 'YOUR_VAPID_KEY_HERE', // Replace with your VAPID key
        serviceWorkerRegistration: registration
      });

      if (token) {
        await this.updateTokenOnServer(token);
        this.setupMessageHandlers();
      }
    } catch (error) {
      console.error('Failed to setup messaging:', error);
      throw error;
    }
  }

  async updateTokenOnServer(token) {
    try {
      await API.request('/api/notifications/register', {
        method: 'POST',
        body: JSON.stringify({ token })
      });
    } catch (error) {
      console.error('Failed to update notification token:', error);
    }
  }

  setupMessageHandlers() {
    // Handle foreground messages
    this.messaging.onMessage((payload) => {
      this.showNotification(payload.notification);
    });

    // Handle token refresh
    this.messaging.onTokenRefresh(async () => {
      try {
        const token = await this.messaging.getToken();
        await this.updateTokenOnServer(token);
      } catch (error) {
        console.error('Failed to refresh token:', error);
      }
    });
  }

  showNotification({ title, body, icon = '/img/logo.png', data = {} }) {
    // Show custom notification UI if user is on the website
    if (document.visibilityState === 'visible') {
      showCustomAlert(body, 'info');
      return;
    }

    // Otherwise, show system notification
    if (this.notificationPermission) {
      const options = {
        body,
        icon,
        badge: '/img/logo.png',
        vibrate: [200, 100, 200],
        data: {
          ...data,
          clickAction: data.url || window.location.origin
        }
      };

      navigator.serviceWorker.ready.then(registration => {
        registration.showNotification(title, options);
      });
    }
  }

  async scheduleReminder(tournament) {
    if (!this.initialized || !this.notificationPermission) return;

    const startTime = new Date(tournament.dateTime);
    const now = new Date();
    const notifyTimes = [
      { minutes: 30, message: '30 minutes until tournament start!' },
      { minutes: 15, message: '15 minutes until tournament start!' },
      { minutes: 5, message: '5 minutes until tournament start!' },
      { minutes: 1, message: '1 minute until tournament start!' }
    ];

    notifyTimes.forEach(({ minutes, message }) => {
      const notifyTime = new Date(startTime.getTime() - minutes * 60000);
      if (notifyTime > now) {
        const timeout = notifyTime.getTime() - now.getTime();
        setTimeout(() => {
          this.showNotification({
            title: tournament.title,
            body: message,
            data: {
              tournamentId: tournament.id,
              url: `/tournaments.html?id=${tournament.id}`
            }
          });
        }, timeout);
      }
    });
  }
}

// Create global instance
window.notificationManager = new NotificationManager();

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await window.notificationManager.init();
  } catch (error) {
    console.log('Notification initialization failed:', error.message);
  }
});