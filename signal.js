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

// 정적 사이트라 서버 저장이 없음 — 이 기기(브라우저)의 localStorage에만 보정값을 저장한다.
// 즉 보정은 다른 사람과 공유되지 않고, 이 폰/PC에서 이전에 입력한 값만 반영된다.
const CALIBRATION_STORAGE_KEY = 'signalCalibrations';

function loadCalibrations() {
  try {
    return JSON.parse(localStorage.getItem(CALIBRATION_STORAGE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveCalibration(id, state, remaining) {
  const calibrations = loadCalibrations();
  calibrations[id] = {
    calibratedAt: new Date().toISOString(),
    state,
    remaining,
  };
  localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrations));
  return calibrations[id];
}
