// public/js/push.js
// Utility to convert base64 VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String) {
  try {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
  } catch (err) {
    console.error('Error converting VAPID key:', err);
    return null;
  }
}

// Check if push notifications are supported
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications are not supported in this browser');
    return;
  }

  try {
    // Register service worker
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    console.log('Service Worker registered:', registration);

    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission denied');
      return;
    }

    // Get VAPID public key from meta tag
    const vapidMeta = document.querySelector('meta[name="vapid-pub"]');
    if (!vapidMeta) {
      console.error('VAPID public key not found in meta tag');
      return;
    }
    const applicationServerKey = urlBase64ToUint8Array(vapidMeta.content);
    if (!applicationServerKey) {
      console.error('Failed to convert VAPID public key');
      return;
    }

    // Subscribe to push notifications
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // Get user ID from meta tag
    const userIdMeta = document.querySelector('meta[name="user-id"]');
    const userId = userIdMeta ? userIdMeta.content : null;

    if (!userId) {
      console.warn('User ID not found, cannot subscribe to push notifications');
      return;
    }

    // Send subscription to server
    const response = await fetch('/notificationPush/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    });

    const result = await response.json();
    if (result.success) {
      console.log('Subscribed to push notifications');
    } else {
      console.error('Subscription failed:', result.error);
    }
  } catch (err) {
    console.error('Error subscribing to push notifications:', err);
  }
}

// Poll for unread notifications
async function pollNotifications() {
  try {
    const userIdMeta = document.querySelector('meta[name="user-id"]');
    const userId = userIdMeta ? userIdMeta.content : null;

    if (!userId) return;

    const response = await fetch('/notification/unread-count', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await response.json();
    if (result.success && result.count > 0) {
      const notificationLink = document.querySelector('a[href="/notification"]');
      if (notificationLink) {
        notificationLink.innerHTML = `<i class="fas fa-bell"></i> Notifications (${result.count})`;
      }
    }
  } catch (err) {
    console.error('Error polling notifications:', err);
  }
}

// Run subscription and polling
if (document.readyState === 'complete') {
  subscribeToPush();
  setInterval(pollNotifications, 30000); // Poll every 30 seconds
} else {
  window.addEventListener('load', () => {
    subscribeToPush();
    setInterval(pollNotifications, 30000);
  });
}
