const CACHE_NAME = 'namhan-go';
const urlsToCache = [
    'naver_map.html',
    'manifest.json',
    'signals.json',
    'signal.js',
    'https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=u2z8etsnaf',
    'image/apple-touch-icon-144x144.png',
    'image/apple-touch-icon-152x152.png',
    'https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png', // 외부 마커 아이콘
    'https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png'   // 외부 마커 아이콘
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })  
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames.map(name => {
          if (!cacheWhitelist.includes(name)) {
            return caches.delete(name);
          }
        })
      )
    )
  );
});
