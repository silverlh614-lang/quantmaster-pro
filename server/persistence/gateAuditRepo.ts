// @responsibility gateAuditRepo 영속화 저장소 모듈
/**
 * gateAuditRepo.ts — 아이디어 11: Gate 조건 통과율 누적 기록
 *
 * autoPopulateWatchlist 실행 시마다 각 종목의 각 Gate 조건
 * 통과/탈락 여부를 gate-audit.json에 누적 기록한다.
 *
 * 구조:
 *   { [conditionKey]: { passed: number, failed: number } }
 *
 * UI에서 히트맵으로 시각화 → "어떤 조건이 가장 타이트한가" 한눈에 파악.
 *
 * I/O 최적화:
 *   - _auditCache: 런타임 단일 인스턴스 메모리 캐시
 *   - recordGateAudit: 메모리만 갱신 (파일 쓰기 없음)
 *   - flushGateAudit:  스캔 루프 완료 후 1회 파일 저장
 *   → 80종목 스캔 시 160회 I/O → 2회(최초 load 1 + flush 1)로 절감
 */

import fs from 'fs';
import { GATE_AUDIT_FILE, ensureDataDir } from './paths.js';
import { CONDITION_KEYS } from '../quantFilter.js';
import type { ConditionEvalOutput, ConditionEvalStatus } from '../quant/conditions/types.js';

/**
 * ADR-0387 — `unavailable` 신규 필드 (옵셔널, 기존 영속 파일 후방호환).
 *
 * - passed       : status='FIRED' (점수 부여)
 * - failed       : status='THRESHOLD_NOT_MET' (진짜 임계 미달)
 * - unavailable? : status='DATA_UNAVAILABLE' or 'SANITY_REJECTED' (데이터 부재/비정상)
 *
 * 기존 영속 파일에 `unavailable` 부재 시 `??= 0` 로 자동 채움.
 */
export interface GateConditionStats {
  passed: number;
  failed: number;
  unavailable?: number;
}

export type GateAuditStore = Record<string, GateConditionStats>;

// ── 런타임 단일 메모리 캐시 ────────────────────────────────────────────────────
let _auditCache: GateAuditStore | null = null;

export function loadGateAudit(): GateAuditStore {
  if (_auditCache) return _auditCache;
  ensureDataDir();
  if (!fs.existsSync(GATE_AUDIT_FILE)) return (_auditCache = {});
  try {
    _auditCache = JSON.parse(fs.readFileSync(GATE_AUDIT_FILE, 'utf-8')) as GateAuditStore;
    return _auditCache;
  } catch {
    return (_auditCache = {});
  }
}

export function saveGateAudit(store: GateAuditStore): void {
  ensureDataDir();
  fs.writeFileSync(GATE_AUDIT_FILE, JSON.stringify(store, null, 2));
}

/**
 * 단일 종목의 Gate 평가 결과를 메모리 캐시에만 누적 (legacy — passedKeys 기반).
 *
 * @deprecated ADR-0387 — `recordGateAuditByStatus` 사용 권장 (DATA_UNAVAILABLE 분리).
 * passedKeys 만으로는 "실패" 가 데이터 부재인지 임계 미달인지 구분 불가.
 * 본 함수는 backward compat 보존 — passedKeys 외 모두 `failed` 로 카운트.
 */
export function recordGateAudit(passedKeys: string[]): void {
  const store = loadGateAudit();
  const passedSet = new Set(passedKeys);
  const allKeys = Object.values(CONDITION_KEYS) as string[];

  for (const key of allKeys) {
    if (!store[key]) store[key] = { passed: 0, failed: 0, unavailable: 0 };
    store[key].unavailable ??= 0; // 기존 영속 파일 후방호환
    if (passedSet.has(key)) {
      store[key].passed++;
    } else {
      store[key].failed++;
    }
  }
  // _auditCache === store (같은 참조) — 별도 할당 불필요
}

/**
 * ADR-0387 — status 기반 정밀 audit 기록.
 *
 * 평가 outputs 배열 입력 → status 별 분기:
 *   - FIRED              → passed++
 *   - DATA_UNAVAILABLE   → unavailable++ (데이터 부재 — 종목 결함 아님)
 *   - SANITY_REJECTED    → unavailable++ (데이터 비정상 — 종목 결함 아님)
 *   - THRESHOLD_NOT_MET  → failed++ (진짜 임계 미달)
 *   - 그 외 (legacy null / status 미명시) → score>0 ? passed++ : failed++
 *
 * @param outputs registry.run(...).outputs 형식 — `{ key, output: {status?, score} | null }[]`
 */
export function recordGateAuditByStatus(
  outputs: Array<{ key: string; output: Pick<ConditionEvalOutput, 'score' | 'status'> | null }>,
): void {
  const store = loadGateAudit();
  for (const { key, output } of outputs) {
    if (!store[key]) store[key] = { passed: 0, failed: 0, unavailable: 0 };
    store[key].unavailable ??= 0; // 기존 영속 파일 후방호환

    const status: ConditionEvalStatus | undefined = output?.status;
    if (status === 'FIRED') {
      store[key].passed++;
    } else if (status === 'DATA_UNAVAILABLE' || status === 'SANITY_REJECTED') {
      // 데이터 부재 / 비정상 — 종목 결함 아님, 별도 카운트
      store[key].unavailable = (store[key].unavailable ?? 0) + 1;
    } else if (status === 'THRESHOLD_NOT_MET') {
      store[key].failed++;
    } else if (output && output.score > 0) {
      // legacy 호환 — status 미명시 + 점수>0 → passed
      store[key].passed++;
    } else {
      // legacy 호환 — status 미명시 + null/score=0 → failed
      store[key].failed++;
    }
  }
}

/**
 * 메모리 캐시를 파일에 플러시.
 * autoPopulateWatchlist 등 스캔 루프 완료 후 1회 호출.
 */
export function flushGateAudit(): void {
  if (!_auditCache) return;
  saveGateAudit(_auditCache);
  console.log('[GateAudit] 플러시 완료');
}

/**
 * 여러 종목의 Gate 평가 결과를 한 번의 파일 I/O로 일괄 기록.
 * recordGateAudit + flushGateAudit 패턴을 선호하지만,
 * 외부에서 keys 배열을 직접 넘기고 싶을 때 사용.
 */
export function recordGateAuditBatch(allPassedKeys: string[][]): void {
  if (allPassedKeys.length === 0) return;
  for (const passedKeys of allPassedKeys) {
    recordGateAudit(passedKeys);
  }
  flushGateAudit();
}
