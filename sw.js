// 설치 가능한 앱으로 인식되기 위한 최소 서비스 워커. 데이터는 캐시하지 않고 항상 최신으로 불러옵니다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
