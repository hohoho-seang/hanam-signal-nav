// 신호 상태/잔여시간 계산.
// 실측 보정(calibration)이 있으면 그 시점을 기준으로 정확히 계산하고,
// 없으면 "오전 6시에 모든 신호가 동시에 시작한다"는 추정 가정으로 대체한다.
// atDate를 미래 시각으로 주면 그 시각의 예측 상태도 계산할 수 있다(내비게이션 도착예측용).

const FALLBACK_REF_HOUR = 6;

function cyclePositionAt(cycle, calibration, atDate) {
  const totalCycle = cycle.green + cycle.red;
  if (!totalCycle || totalCycle <= 0) return null;

  if (calibration && calibration.calibratedAt) {
    const calibratedAt = new Date(calibration.calibratedAt);
    const anchorPos = calibration.state === 'green'
      ? cycle.green - calibration.remaining
      : cycle.green + (cycle.red - calibration.remaining);
    const elapsed = (atDate - calibratedAt) / 1000;
    const position = (((anchorPos + elapsed) % totalCycle) + totalCycle) % totalCycle;
    return { position, totalCycle, source: 'calibrated', calibratedAt };
  }

  let start = new Date(atDate.getFullYear(), atDate.getMonth(), atDate.getDate(), FALLBACK_REF_HOUR, 0, 0);
  if (atDate < start) start.setDate(start.getDate() - 1);
  const elapsed = Math.floor((atDate - start) / 1000);
  const position = ((elapsed % totalCycle) + totalCycle) % totalCycle;
  return { position, totalCycle, source: 'estimated' };
}

function getSignalState(cycle, calibration, atDate) {
  atDate = atDate || new Date();
  const result = cyclePositionAt(cycle, calibration, atDate);
  if (!result) return { state: '알수없음', remaining: 0, source: 'unknown' };
  const { position, totalCycle, source, calibratedAt } = result;
  let state, remaining;
  if (position < cycle.green) {
    state = '초록';
    remaining = cycle.green - position;
  } else {
    state = '빨강';
    remaining = totalCycle - position;
  }
  return { state, remaining, source, calibratedAt };
}

function calibrationAgeLabel(calibratedAt, atDate) {
  atDate = atDate || new Date();
  const hours = (atDate - calibratedAt) / 3600000;
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}분 전 실측`;
  return `${Math.round(hours)}시간 전 실측`;
}

// 기본은 이 기기(브라우저)의 localStorage — 오프라인에서도 즉시 읽고 쓸 수 있는 캐시 역할.
// FIREBASE_CONFIG가 설정되어 있으면 Firestore와 실시간 동기화되어 다른 사용자와 보정값을 공유한다.
const CALIBRATION_STORAGE_KEY = 'signalCalibrations';
let firestoreDb = null;

function loadCalibrations() {
  try {
    return JSON.parse(localStorage.getItem(CALIBRATION_STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function firebaseConfigured() {
  return typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey
    && !FIREBASE_CONFIG.apiKey.startsWith('YOUR_');
}

// 설정되어 있으면 Firestore 'calibrations' 컬렉션을 구독해 변경이 생길 때마다 onRemoteUpdate(전체 보정맵)를 호출한다.
// 설정 안 돼있으면 조용히 아무 것도 하지 않고 localStorage만 쓰는 이전 동작으로 남는다.
function initCalibrationSync(onRemoteUpdate) {
  if (!firebaseConfigured() || typeof firebase === 'undefined') return;
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    firestoreDb = firebase.firestore();
    firestoreDb.collection('calibrations').onSnapshot(snapshot => {
      const remote = {};
      snapshot.forEach(doc => { remote[doc.id] = doc.data(); });
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(remote)); // 오프라인 폴백용 캐시 갱신
      onRemoteUpdate(remote);
    }, err => console.error('보정 동기화 실패(로컬 데이터로 계속 동작):', err));
  } catch (e) {
    console.error('Firebase 초기화 실패(로컬 전용으로 동작):', e);
  }
}

function saveCalibration(id, state, remaining) {
  const calibrations = loadCalibrations();
  const entry = {
    calibratedAt: new Date().toISOString(),
    state,
    remaining,
  };
  calibrations[id] = entry;
  localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrations));
  if (firestoreDb) {
    firestoreDb.collection('calibrations').doc(id).set(entry)
      .catch(e => console.error('보정 공유 실패(이 기기에는 저장됨):', e));
  }
  return entry;
}
