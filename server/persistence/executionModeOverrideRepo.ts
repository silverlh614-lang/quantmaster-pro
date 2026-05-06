// @responsibility executionModeOverrideRepo 영속 저장소 — ADR-0395 P2 ExecutionMode 영속 override SSOT
//
// 목적: Kill Switch / 운영자 명령으로 강등된 ExecutionMode 를 디스크에 영속 →
//       Railway 재배포 / 컨테이너 재시작 후에도 강등 상태 유지.
//
// 우선순위 (ADR-0395 §2):
//   1. RUNTIME_EXECUTION_MODE (메모리 — Kill Switch 즉시 강등) → setExecutionMode
//   2. 본 파일 (디스크 — 운영자 영속 강등) → loadPersistentExecutionMode
//   3. env (EXECUTION_MODE / AUTO_TRADE_MODE) → readEnvExecutionMode
//
// 영속 정책:
//   - 단일 파일: data/execution_mode_override.json
//   - atomic write (tmp → rename) — race 시 이전 정상 본 보존
//   - 손상 JSON → null fallback (env 로 복원)
//   - 부재 파일 → null (uninitialized 정상)
//   - 단일 호출자: state.ts setPersistentExecutionMode / clearPersistentExecutionMode
//
// 안전 invariant (ADR-0395 §"안전 invariant"):
//   - 본 모듈 외부에서 EXECUTION_MODE_OVERRIDE_FILE 직접 fs.writeFileSync 금지 (SSOT 위반)
//   - 다른 영속 모듈 import 0건 (순환 의존 차단)
//   - 외부 호출 0건 (KIS/KRX 와 무관)

import fs from 'fs';
import path from 'path';
import { EXECUTION_MODE_OVERRIDE_FILE } from './paths.js';

/**
 * ExecutionMode 3-state union — state.ts 와 동일 정의 (순환 import 차단을 위해 자체 사본).
 */
export type PersistentExecutionMode = 'OFF' | 'PAPER' | 'LIVE';

export interface ExecutionModeOverrideRecord {
  /** 영속된 ExecutionMode 값 */
  mode: PersistentExecutionMode;
  /** 강등 사유 (운영자 / Kill Switch / 자동 강등) — 사람이 읽을 수 있는 문구 */
  reason?: string;
  /** 설정자 — 'operator' / 'kill-switch' / 'system' / 'test' */
  setBy?: string;
  /** 설정 시각 (ISO 8601) */
  setAt: string;
}

/**
 * ExecutionMode 정확 비교 — runtime 입력 검증 (env / 사용자 입력 / 영속 데이터 모두).
 */
function isValidMode(value: unknown): value is PersistentExecutionMode {
  return value === 'OFF' || value === 'PAPER' || value === 'LIVE';
}

/**
 * 영속 override read SSOT.
 *
 * - 파일 부재 → null
 * - 손상 JSON → null (env 로 복원)
 * - 잘못된 mode 값 → null (안전 fallback)
 * - 잘못된 setAt → 빈 문자열 fallback (record 자체는 유지)
 */
export function loadPersistentExecutionMode(): ExecutionModeOverrideRecord | null {
  if (!fs.existsSync(EXECUTION_MODE_OVERRIDE_FILE)) return null;
  try {
    const raw = fs.readFileSync(EXECUTION_MODE_OVERRIDE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    if (!isValidMode(obj.mode)) return null;
    const setAt = typeof obj.setAt === 'string' ? obj.setAt : '';
    return {
      mode: obj.mode,
      reason: typeof obj.reason === 'string' ? obj.reason : undefined,
      setBy: typeof obj.setBy === 'string' ? obj.setBy : undefined,
      setAt,
    };
  } catch {
    return null;
  }
}

/**
 * 영속 override write SSOT — atomic (tmp → rename).
 *
 * 호출자: state.ts `setPersistentExecutionMode` (단일 진입점).
 * 외부에서 직접 호출 금지 — ADR-0395 §"안전 invariant".
 */
export function savePersistentExecutionMode(record: Omit<ExecutionModeOverrideRecord, 'setAt'> & { setAt?: string }): void {
  const finalRecord: ExecutionModeOverrideRecord = {
    mode: record.mode,
    reason: record.reason,
    setBy: record.setBy,
    setAt: record.setAt ?? new Date().toISOString(),
  };
  ensureDir();
  const tmp = `${EXECUTION_MODE_OVERRIDE_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(finalRecord, null, 2), 'utf-8');
  fs.renameSync(tmp, EXECUTION_MODE_OVERRIDE_FILE);
}

/**
 * 영속 override 제거 — 영속 강등 해제.
 *
 * 호출자: state.ts `clearPersistentExecutionMode` (단일 진입점).
 * 파일 부재 시 idempotent (ENOENT silent).
 */
export function clearPersistentExecutionMode(): void {
  try {
    fs.unlinkSync(EXECUTION_MODE_OVERRIDE_FILE);
  } catch {
    // 파일 부재 또는 권한 결손 — idempotent.
  }
}

/**
 * 테스트 격리 헬퍼 — 영속 파일 강제 삭제.
 * 운영 코드는 호출 금지 (clearPersistentExecutionMode 사용).
 */
export function __resetPersistentExecutionModeForTests(): void {
  clearPersistentExecutionMode();
}

function ensureDir(): void {
  const dir = path.dirname(EXECUTION_MODE_OVERRIDE_FILE);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // idempotent
  }
}
