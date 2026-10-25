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

/* Always ask the server for the newest app files (falls back to the saved copy when offline),
   so an installed app picks up updates the next time it opens. */
self.addEventListener("fetch", function (event) {
  var req = event.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  if (req.mode === "navigate" || /\.(js|webmanifest|html)$/.test(url.pathname)) {
    event.respondWith(fetch(req, { cache: "no-cache" }).catch(function () { return caches.match(req); }));
  }
});

/* Tapping the notification opens (or focuses) the app on the check-in. */
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var tag = event.notification.tag || "";
  /* idea alerts (for the app's owner) open the ideas list in the Firebase console */
  if (tag.indexOf("breakfree-idea") === 0) {
    event.waitUntil(self.clients.openWindow("https://console.firebase.google.com/project/break-free-9722f/firestore/databases/-default-/data/~2Ffeedback"));
    return;
  }
  /* encouragement reminders open the Why page; the daily question opens the check-in */
  var isBoost = tag.indexOf("breakfree-boost") === 0;
  var target = new URL(isBoost ? "./#why" : "./#checkin", self.registration.scope).href;
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
