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
 */

import fs from 'fs';
import { GATE_AUDIT_FILE, ensureDataDir } from './paths.js';
import { CONDITION_KEYS, type ConditionKey } from '../quantFilter.js';

export interface GateConditionStats {
  passed: number;
  failed: number;
}

export type GateAuditStore = Record<string, GateConditionStats>;

export function loadGateAudit(): GateAuditStore {
  ensureDataDir();
  if (!fs.existsSync(GATE_AUDIT_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(GATE_AUDIT_FILE, 'utf-8')) as GateAuditStore;
  } catch {
    return {};
  }
}

export function saveGateAudit(store: GateAuditStore): void {
  ensureDataDir();
  fs.writeFileSync(GATE_AUDIT_FILE, JSON.stringify(store, null, 2));
}

/**
 * 단일 종목의 Gate 평가 결과를 누적 기록.
 * passedKeys: evaluateServerGate가 반환한 conditionKeys (통과한 조건)
 * 전체 조건 키 목록에서 통과하지 못한 조건은 failed로 카운트.
 */
export function recordGateAudit(passedKeys: string[]): void {
  const store = loadGateAudit();
  const passedSet = new Set(passedKeys);
  const allKeys = Object.values(CONDITION_KEYS) as string[];

  for (const key of allKeys) {
    if (!store[key]) {
      store[key] = { passed: 0, failed: 0 };
    }
    if (passedSet.has(key)) {
      store[key].passed++;
    } else {
      store[key].failed++;
    }
  }

  saveGateAudit(store);
}
