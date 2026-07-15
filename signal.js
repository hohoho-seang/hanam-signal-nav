// 신호 상태/잔여시간 계산.
// 실측 보정(calibration)이 있으면 그 시점을 기준으로 정확히 계산하고,
// 없으면 "오전 6시에 모든 신호가 동시에 시작한다"는 추정 가정으로 대체한다.
// atDate를 미래 시각으로 주면 그 시각의 예측 상태도 계산할 수 있다(내비게이션 도착예측용).

const FALLBACK_REF_HOUR = 6;

// signals.json의 cycle 형태 3가지: ①{green,red} 단일 객체(대부분) ②[{green,red},...] 후보 배열
// (좌표는 같은데 실측값이 크게 갈리는 소수 — 첫 후보를 기본값으로) ③null(주기 미상 —
// 전국횡단보도표준데이터에서 위치만 확보되고 신호시간이 비어있는 지점, 위치 표시만 하고 카운트다운 없음).
function normalizeCycle(cycle) {
  return Array.isArray(cycle) ? cycle[0] : (cycle || null);
}

function hasCycle(cycle) {
  const c = normalizeCycle(cycle);
  return !!(c && Number.isFinite(c.green) && Number.isFinite(c.red) && c.green + c.red > 0);
}

function totalCycleOf(cycle) {
  const c = normalizeCycle(cycle);
  if (!c) return 0;
  return c.green + c.red;
}

// (state, remaining) 실측 한 건을 "주기 내 위상"(0~totalCycle, 초 단위)으로 환산.
// 위상 0 = 초록이 막 시작되는 순간.
function phaseFromReading(cycle, state, remaining) {
  const c = normalizeCycle(cycle);
  return state === 'green'
    ? c.green - remaining
    : c.green + (c.red - remaining);
}

function wrapPhase(phase, totalCycle) {
  return ((phase % totalCycle) + totalCycle) % totalCycle;
}

// phase가 fromDate 시점의 위상일 때, toDate 시점으로 시간 경과를 반영해 위상을 전파(순환 wrap).
function propagatePhase(phase, fromDate, toDate, totalCycle) {
  const elapsed = (toDate - fromDate) / 1000;
  return wrapPhase(phase + elapsed, totalCycle);
}

// 순환평균(circular mean): 위상들을 각도(0~2π)로 변환해 단위벡터 합의 방향을 구한 뒤 위상으로 역변환.
// 산술평균과 달리 "totalCycle-1초"와 "1초"의 평균이 0초 근방으로 나온다(wrap-around 정상 처리).
function circularMeanPhase(phases, totalCycle) {
  let sumSin = 0, sumCos = 0;
  phases.forEach(p => {
    const angle = (p / totalCycle) * 2 * Math.PI;
    sumSin += Math.sin(angle);
    sumCos += Math.cos(angle);
  });
  const meanAngle = Math.atan2(sumSin, sumCos);
  return wrapPhase((meanAngle / (2 * Math.PI)) * totalCycle, totalCycle);
}

// 두 위상 사이의 순환 거리(짧은 쪽, 0~totalCycle/2 범위).
function circularDistance(a, b, totalCycle) {
  const diff = Math.abs(a - b) % totalCycle;
  return Math.min(diff, totalCycle - diff);
}

const OUTLIER_RATIO = 0.3; // 기존 평균과 30% 이상(순환거리 기준) 벗어나면 이상치로 간주

// 기존 순환통계(existing: {sampleCount, meanPhase, phaseAt} 또는 구버전/없음)에 새 위상 샘플 1건을
// 반영해 갱신된 통계를 반환한다. Firestore runTransaction 안에서도, 로컬 폴백에서도 동일하게 쓴다.
function combineCalibrationSample(existing, newPhase, totalCycle, now) {
  const hasValidStats = existing
    && Number.isFinite(existing.sampleCount) && existing.sampleCount >= 1
    && Number.isFinite(existing.meanPhase) && existing.phaseAt;

  if (!hasValidStats) {
    return { sampleCount: 1, meanPhase: newPhase, phaseAt: now.toISOString(), outlierCount: 0 };
  }

  // 기존 평균 위상을 "지금" 시점 기준으로 전파한 뒤 새 샘플과 비교/결합해야 서로 다른 시각에
  // 관측된 값들을 같은 기준선에서 순환평균할 수 있다.
  const existingPhaseNow = propagatePhase(existing.meanPhase, new Date(existing.phaseAt), now, totalCycle);
  const dist = circularDistance(existingPhaseNow, newPhase, totalCycle);

  if (dist > totalCycle * OUTLIER_RATIO) {
    // 이상치: 평균에는 반영하지 않고 카운트만 남긴다(원본은 raw calibratedAt/state/remaining으로 별도 보존됨).
    return {
      sampleCount: existing.sampleCount,
      meanPhase: existing.meanPhase,
      phaseAt: existing.phaseAt,
      outlierCount: (existing.outlierCount || 0) + 1,
    };
  }

  const w = existing.sampleCount;
  const eAngle = (existingPhaseNow / totalCycle) * 2 * Math.PI;
  const nAngle = (newPhase / totalCycle) * 2 * Math.PI;
  const sumSin = Math.sin(eAngle) * w + Math.sin(nAngle);
  const sumCos = Math.cos(eAngle) * w + Math.cos(nAngle);
  const meanAngle = Math.atan2(sumSin, sumCos);
  const meanPhase = wrapPhase((meanAngle / (2 * Math.PI)) * totalCycle, totalCycle);

  return {
    sampleCount: w + 1,
    meanPhase,
    phaseAt: now.toISOString(),
    outlierCount: existing.outlierCount || 0,
  };
}

// 현재 시각 기준 기본 시간대 태그 추천(등하교/낮/저녁/심야). 사용자가 폼에서 수정 가능.
function suggestTimeBucket(atDate) {
  atDate = atDate || new Date();
  const h = atDate.getHours();
  if (h >= 22 || h < 6) return 'night';
  if ((h >= 7 && h < 9) || (h >= 14 && h < 16)) return 'commute';
  if (h >= 18) return 'evening';
  return 'day';
}

const TIME_BUCKET_LABELS = { commute: '등하교', day: '낮', evening: '저녁', night: '심야' };

function cyclePositionAt(cycle, calibration, atDate) {
  const c = normalizeCycle(cycle);
  if (!c) return null; // 주기 미상(cycle:null) — 위치만 아는 신호
  const totalCycle = c.green + c.red;
  if (!totalCycle || totalCycle <= 0) return null;

  // 우선순위 1: 순환통계(meanPhase/phaseAt, 여러 사람의 실측을 정제한 값) — sampleCount 있는 신버전 문서.
  if (calibration && Number.isFinite(calibration.sampleCount) && calibration.sampleCount >= 1
      && Number.isFinite(calibration.meanPhase) && calibration.phaseAt) {
    const phaseAt = new Date(calibration.phaseAt);
    const position = propagatePhase(calibration.meanPhase, phaseAt, atDate, totalCycle);
    return { position, totalCycle, source: 'calibrated', calibratedAt: phaseAt };
  }

  // 우선순위 2: 구버전 원본 필드(calibratedAt/state/remaining) — sampleCount 없는 기존 로컬/원격 데이터 하위호환.
  if (calibration && calibration.calibratedAt) {
    const calibratedAt = new Date(calibration.calibratedAt);
    const anchorPos = calibration.state === 'green'
      ? c.green - calibration.remaining
      : c.green + (c.red - calibration.remaining);
    const position = propagatePhase(anchorPos, calibratedAt, atDate, totalCycle);
    return { position, totalCycle, source: 'calibrated', calibratedAt };
  }

  // 우선순위 3: 추정치 폴백.
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
  const c = normalizeCycle(cycle);
  let state, remaining;
  if (position < c.green) {
    state = '초록';
    remaining = c.green - position;
  } else {
    state = '빨강';
    remaining = totalCycle - position;
  }
  const sampleCount = (calibration && calibration.sampleCount) || 0;
  return { state, remaining, source, calibratedAt, sampleCount };
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

// 실측 한 건을 저장한다. 여러 사람이 제출한 값을 "덮어쓰기"가 아니라 순환평균으로 누적 정제한다.
// cycle: 해당 신호의 signal.js cycle(단일 객체 또는 배열 — normalizeCycle이 처리)
// timeBucket: 'commute'|'day'|'evening'|'night' 중 하나(생략시 현재 시각 기반 자동 추천).
// Firestore가 설정되어 있으면 동시 제출 경합을 막기 위해 runTransaction으로 원자적으로 읽고 쓴다.
// 반환값은 Promise<entry> (entry는 로컬 캐시에도 즉시 반영됨).
function saveCalibration(id, cycle, state, remaining, timeBucket) {
  const now = new Date();
  const totalCycle = totalCycleOf(cycle);
  const newPhase = phaseFromReading(cycle, state, remaining);
  const rawEntry = {
    calibratedAt: now.toISOString(),
    state,
    remaining,
    timeBucket: timeBucket || suggestTimeBucket(now),
  };

  function saveLocally(existing) {
    const stats = combineCalibrationSample(existing, newPhase, totalCycle, now);
    const entry = Object.assign({}, rawEntry, stats);
    const calibrations = loadCalibrations();
    calibrations[id] = entry;
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrations));
    return entry;
  }

  if (firestoreDb) {
    const docRef = firestoreDb.collection('calibrations').doc(id);
    return firestoreDb.runTransaction(tx => {
      return tx.get(docRef).then(doc => {
        const existing = doc.exists ? doc.data() : null;
        const stats = combineCalibrationSample(existing, newPhase, totalCycle, now);
        const entry = Object.assign({}, rawEntry, stats);
        tx.set(docRef, entry);
        return entry;
      });
    }).then(entry => {
      const calibrations = loadCalibrations();
      calibrations[id] = entry;
      localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrations));
      return entry;
    }).catch(e => {
      console.error('보정 공유 실패(로컬에만 저장):', e);
      return saveLocally(loadCalibrations()[id]);
    });
  }
  return Promise.resolve(saveLocally(loadCalibrations()[id]));
}
