self.addEventListener("push", async (event) => {
  const data = event.data.json();
  const { title, body, url } = data;

  const options = {
    body,
    icon: "/images/notification-icon.png", // Optional: Add an icon
    data: { url },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data.url));
});
