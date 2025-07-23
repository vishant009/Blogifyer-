self.addEventListener('push', (event) => {
  const data = event.data.json();
  const { title, body, url, image, timestamp } = data;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/images/default.png',
      badge: '/images/default.png',
      image: image || '/images/default.png',
      data: { url },
      requireInteraction: true,
      timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(),
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const url = event.notification.data.url || '/';
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
