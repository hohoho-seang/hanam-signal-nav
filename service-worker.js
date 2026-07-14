// 캐시 이름에 버전을 넣어둔다 — urlsToCache 내용이 바뀔 때마다 버전을 올려야
// activate 핸들러가 옛 캐시를 지우고 새로 받아온다(안 올리면 재방문자가 옛 데이터를 계속 봄).
const CACHE_NAME = 'namhan-go-v2';

// 우리가 직접 관리하는 파일(자주 바뀜: 신호 데이터, 로직, 마크업)은 네트워크를 우선 시도하고
// 성공하면 캐시를 갱신한다. 오프라인일 때만 캐시로 폴백한다.
const NETWORK_FIRST = [
    'naver_map.html',
    'manifest.json',
    'signals.json',
    'signal.js',
];

// 거의 안 바뀌는 외부/정적 자산은 캐시 우선(빠르고 오프라인에서도 동작).
const CACHE_FIRST = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'image/apple-touch-icon-144x144.png',
    'image/apple-touch-icon-152x152.png',
    'https://maps.gstatic.com/mapfiles/ms2/micons/green-dot.png',
    'https://maps.gstatic.com/mapfiles/ms2/micons/red-dot.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([...NETWORK_FIRST, ...CACHE_FIRST]))
  );
});

function isNetworkFirst(url) {
  return NETWORK_FIRST.some(name => url.endsWith(name));
}

self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
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
