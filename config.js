// 정적 사이트(GitHub Pages)라 서버에 키를 숨길 수 없음 — Tmap API는 CORS를 지원해
// 브라우저에서 직접 호출 가능하므로 클라이언트에 공개된 키를 그대로 사용한다.
// (Naver 지도 키도 이미 HTML에 공개되어 있는 것과 같은 신뢰 수준)
const TMAP_APP_KEY = '6g29sYRBVT6u92nJyTpJw7TC1SObqdIo4C5JK0bq';

// Kakao 지도 JavaScript 키 (로드뷰용). developers.kakao.com에서 발급 후 교체.
// 도메인 등록 필요(앱 설정 > 플랫폼 > Web > 사이트 도메인).
const KAKAO_JS_KEY = '29faf74ff8f5d44f6dfe3d28079b18a2';

// Firebase 프로젝트 설정 (신호 보정 실시간 공유용 Firestore).
// Firebase 클라이언트 config는 비밀키가 아니라 공개되어도 되는 식별자다 — 보안은 Firestore 보안규칙이 담당.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAJICx8kH_21l4o4NzqfnYd8_7ujjlOCBg',
  authDomain: 'hanam-signal-nav.firebaseapp.com',
  projectId: 'hanam-signal-nav',
  storageBucket: 'hanam-signal-nav.firebasestorage.app',
  messagingSenderId: '643780453745',
  appId: '1:643780453745:web:adeb2c30b91163e7ea02d0',
};
