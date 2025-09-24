importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBQDNxx8_9DFVOsJ5c4pn9kuzNxX6AxU0k",
  authDomain: "ak-arena.firebaseapp.com",
  projectId: "ak-arena",
  storageBucket: "ak-arena.firebasestorage.app",
  messagingSenderId: "883603092694",
  appId: "1:883603092694:web:238973cdc2057ae26b8577",
  measurementId: "G-MGTPR6RGT0"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
  const title = (payload.notification && payload.notification.title) || 'Notification';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, { body });
});
