/**
 * engineSnapshotRepo.ts — 30초 주기 엔진 체크포인트 저장/복원.
 *
 * SessionRecoveryBanner 의 5분 간격 클라이언트 저장은 Railway 재시작 시
 * 최대 5분 손실 위험이 있다. 이 레포는 서버 측에서 30초마다 핵심 상태를
 * JSON 파일로 내려 재시작 후 즉시 복원할 수 있게 한다.
 *
 * 저장 필드:
 *   - runtimeMode         — 강등된 모드 (Kill Switch 발동 결과)
 *   - emergencyStop       — 비상정지 플래그
 *   - dailyLossPct        — 오늘 실현 손실
 *   - ocoCancelFailCount  — Kill Switch 카운터
 *   - lastHeartbeat       — 재시작 감지용 (현재 Date.now - lastHeartbeat)
 *   - killSwitchLast      — 최근 강등 이력
 *
 * 재시작 시점에 restoreEngineSnapshot() 을 호출하면 메모리 state 가 복원된다.
 */

import fs from 'fs';
import path from 'path';
import { DATA_DIR, ensureDataDir } from './paths.js';
import {
  getEmergencyStop, setEmergencyStop,
  getDailyLossPct, setDailyLoss,
  getTradingMode, setTradingMode,
  getLastHeartbeat, getLastHeartbeatSource,
  getKillSwitchLast, setKillSwitchLast,
  type KillSwitchRecord,
} from '../state.js';
import {
  getOcoCancelFailCount,
} from '../trading/killSwitch.js';

const SNAPSHOT_FILE = path.join(DATA_DIR, 'engine-snapshot.json');
const CHECKPOINT_INTERVAL_MS = 30_000;

export interface EngineSnapshot {
  savedAt: string;                  // ISO timestamp
  runtimeMode: 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL';
  emergencyStop: boolean;
  dailyLossPct: number;
  ocoCancelFailCount: number;
  lastHeartbeatAt: number;
  lastHeartbeatSource: string;
  killSwitchLast: KillSwitchRecord | null;
}

export function captureEngineSnapshot(): EngineSnapshot {
  return {
    savedAt: new Date().toISOString(),
    runtimeMode: getTradingMode(),
    emergencyStop: getEmergencyStop(),
    dailyLossPct: getDailyLossPct(),
    ocoCancelFailCount: getOcoCancelFailCount(),
    lastHeartbeatAt: getLastHeartbeat(),
    lastHeartbeatSource: getLastHeartbeatSource(),
    killSwitchLast: getKillSwitchLast(),
  };
}

export function saveEngineSnapshot(snap: EngineSnapshot = captureEngineSnapshot()): void {
  try {
    ensureDataDir();
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snap, null, 2));
  } catch (err) {
    console.error('[EngineSnapshot] save 실패:', err);
  }
}

export function loadEngineSnapshot(): EngineSnapshot | null {
  try {
    if (!fs.existsSync(SNAPSHOT_FILE)) return null;
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf-8')) as EngineSnapshot;
  } catch (err) {
    console.error('[EngineSnapshot] load 실패:', err);
    return null;
  }
}

/**
 * 프로세스 시작 시 호출. 스냅샷이 있으면 메모리 state 를 복원한다.
 *
 * 복원하지 않는 필드:
 *   - heartbeat — 재시작 즉시 새로 갱신됨 (이전 값은 무관)
 *   - runtimeMode=LIVE 로의 역복원 — env 재설정 없이는 강제 SHADOW 유지.
 *     (Kill Switch 로 강등된 상태에서 재시작만으로 LIVE 복귀하면 위험)
 */
export function restoreEngineSnapshot(): EngineSnapshot | null {
  const snap = loadEngineSnapshot();
  if (!snap) return null;

  setEmergencyStop(snap.emergencyStop);
  setDailyLoss(snap.dailyLossPct);
  if (snap.killSwitchLast) setKillSwitchLast(snap.killSwitchLast);

  // 런타임 모드 복원 — 강등 상태만 유지, LIVE 로의 복구는 env 재설정 요구.
  if (snap.runtimeMode === 'SHADOW' && snap.killSwitchLast) {
    setTradingMode('SHADOW');
  }

  console.log(
    `[EngineSnapshot] 복원 완료 savedAt=${snap.savedAt} mode=${snap.runtimeMode} ` +
    `emergencyStop=${snap.emergencyStop} ocoFails=${snap.ocoCancelFailCount}`,
  );
  return snap;
}

/** 프로세스 시작 시 호출 — 30초 주기 자동 저장 시작. */
export function startEngineSnapshotLoop(): NodeJS.Timeout {
  const timer = setInterval(() => {
    saveEngineSnapshot();
  }, CHECKPOINT_INTERVAL_MS);
  timer.unref?.();
  return timer;
}
