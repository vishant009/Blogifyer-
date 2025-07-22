function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.error("Push notifications not supported");
      return;
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.error("Notification permission denied");
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array("BJU6GYgZUA5KOgRvMnSw7KCafl9I2vESjSgVNJktu0gdrdNQ3FHI6StsNN3nygwM09FHuAuGmZ6sU0cCu3Ojxe0"),
    });

    const response = await fetch("/notificationPush/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription }),
    });

    const result = await response.json();
    if (result.success) {
      console.log("Subscribed to push notifications");
    } else {
      console.error("Subscription failed:", result.error);
    }
  } catch (err) {
    console.error("Error subscribing to push notifications:", err);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  subscribeToPush();
});
