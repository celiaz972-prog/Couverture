// Service worker minimal : met en cache les fichiers de l'application pour
// qu'elle fonctionne même sans réseau (utile sur les chantiers mal couverts).
// Les photos elles-mêmes ne transitent jamais par le réseau : elles restent
// en local (IndexedDB), ce cache ne concerne que le code de l'application.

var CACHE_NAME = "rapport-photo-v2";
var APP_SHELL = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./vendor/jspdf.umd.min.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", function(event){
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      return cache.addAll(APP_SHELL);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){ return key !== CACHE_NAME; })
            .map(function(key){ return caches.delete(key); })
      );
    }).then(function(){
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function(event){
  if(event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function(cached){
      if(cached) return cached;
      return fetch(event.request).then(function(response){
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function(cache){ cache.put(event.request, copy); });
        return response;
      }).catch(function(){
        return cached;
      });
    })
  );
});
