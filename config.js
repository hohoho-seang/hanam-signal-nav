// 정적 사이트(GitHub Pages)라 서버에 키를 숨길 수 없음 — Tmap API는 CORS를 지원해
// 브라우저에서 직접 호출 가능하므로 클라이언트에 공개된 키를 그대로 사용한다.
// (Naver 지도 키도 이미 HTML에 공개되어 있는 것과 같은 신뢰 수준)
const TMAP_APP_KEY = '6g29sYRBVT6u92nJyTpJw7TC1SObqdIo4C5JK0bq';
