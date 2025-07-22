// public/js/push.js
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => console.log('SW registered', reg));
}

// Ask permission + subscribe
async function subscribeToPush() {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return;

  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(document.querySelector('meta[name="vapid-pub"]').content)
  });

  await fetch('/notificationPush/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub })
  });
}

// Utility
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

// Auto-subscribe on first load
subscribeToPush();
