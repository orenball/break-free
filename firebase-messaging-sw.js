/* Break Free — service worker: receives the daily check-in push while the app is closed. */
importScripts("firebase-config.js");

if (self.BF_FIREBASE_CONFIG) {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js"
  );
  firebase.initializeApp(self.BF_FIREBASE_CONFIG);
  /* Messages that carry a "notification" part are shown automatically by Firebase. */
  firebase.messaging();
}

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });

/* Tapping the notification opens (or focuses) the app on the check-in. */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = new URL("./#checkin", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.registration.scope) === 0 && "focus" in list[i]) {
          return list[i].navigate(target).then(function (c) { return c && c.focus(); });
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
