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

export interface GateConditionStats {
  passed: number;
  failed: number;
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
 * 단일 종목의 Gate 평가 결과를 메모리 캐시에만 누적.
 * 파일 I/O 없음 — 스캔 루프 종료 후 flushGateAudit() 호출 필요.
 */
export function recordGateAudit(passedKeys: string[]): void {
  const store = loadGateAudit();
  const passedSet = new Set(passedKeys);
  const allKeys = Object.values(CONDITION_KEYS) as string[];

  for (const key of allKeys) {
    if (!store[key]) store[key] = { passed: 0, failed: 0 };
    if (passedSet.has(key)) {
      store[key].passed++;
    } else {
      store[key].failed++;
    }
  }
  // _auditCache === store (같은 참조) — 별도 할당 불필요
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
