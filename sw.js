// オフラインでも開けるように、アプリのファイルだけをこのiPhoneに保存する。
// お金のデータはここでは扱わない（localStorage にある）。外部への通信もしない。
const CACHE = "dividend-memo-v1";
const FILES = ["./", "index.html", "app.css", "app.js", "lib/store.js", "lib/calc.js", "lib/csv.js", "manifest.webmanifest", "icon-180.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 新しい版があればそれを使い、通信できなければ保存した版を使う
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request)),
  );
});
