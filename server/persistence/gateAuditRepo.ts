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
 * ADR-0387 + ADR-0388 — 4 카운터 분리 schema (옵셔널 후방호환).
 *
 * - passed        : status='FIRED' (점수 부여)
 * - failed        : status='THRESHOLD_NOT_MET' (진짜 임계 미달, 정상 평가 결과)
 * - unavailable?  : status='DATA_UNAVAILABLE' / 'PROVIDER_DEGRADED' / 'SKIPPED_BY_POLICY' / 'SANITY_REJECTED'
 * - error?        : status='ERROR' (evaluator 예외 — failed 와 분리 의무, ADR-0388)
 *
 * 사용자 명시 (ADR-0388): ERROR 를 failed 와 같은 카운트에 섞으면 "evaluator 깨짐"
 * vs "정상 임계 미달" 구분 손실 → DATA_UNAVAILABLE/failed 합산 결함의 작은 버전 재발.
 *
 * 기존 영속 파일에 `unavailable`/`error` 부재 시 `??= 0` 로 자동 채움.
 */
interface GateConditionStats {
  passed: number;
  failed: number;
  unavailable?: number;
  error?: number;
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
  // ADR-0418 baseline cleanup — saveGateAudit 후 in-memory `_auditCache` 도 동기화.
  // 이전 동작: file 만 갱신 → 다음 loadGateAudit 호출 시 stale `_auditCache` 반환 →
  // 테스트 간 누적 오염 (`expected 1 to be 2` 패턴). 이제 file + memory 동시 갱신.
  _auditCache = store;
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
 * ADR-0388 — null/legacy result → status 추론 방어 헬퍼.
 *
 * 사용자 명시: 일부 evaluator 가 null 을 "데이터 없음" 또는 "평가 생략" 으로 사용하던
 * 관례가 있을 수 있어 단순 `null → THRESHOLD_NOT_MET` 추론은 오염원 위험.
 * `context` 옵션으로 호출자가 상황 정보 제공 가능 — 향후 확장 여지.
 *
 * 우선순위 SSOT:
 *   1. context.skippedByPolicy=true → SKIPPED_BY_POLICY
 *   2. result === null + context.hadRequiredData=false → DATA_UNAVAILABLE
 *   3. result === null + 그 외 → THRESHOLD_NOT_MET (legacy 기본 가정)
 *   4. result.status 명시 → 그대로
 *   5. result.score > 0 → FIRED (legacy 호환)
 *   6. 그 외 → THRESHOLD_NOT_MET
 */
export function inferStatusFromLegacyResult(
  result: Pick<ConditionEvalOutput, 'score' | 'status'> | null,
  context?: {
    evaluatorKey?: string;
    hadRequiredData?: boolean;
    skippedByPolicy?: boolean;
  },
): ConditionEvalStatus {
  if (context?.skippedByPolicy) return 'SKIPPED_BY_POLICY';
  if (result === null) {
    if (context?.hadRequiredData === false) return 'DATA_UNAVAILABLE';
    return 'THRESHOLD_NOT_MET';
  }
  if (result.status) return result.status;
  if (result.score > 0) return 'FIRED';
  return 'THRESHOLD_NOT_MET';
}

/**
 * ADR-0387 + ADR-0388 — status 기반 정밀 audit 기록 (6 분기 + ERROR 별도).
 *
 * 평가 outputs 배열 입력 → status 별 분기:
 *   - FIRED                                                              → passed++
 *   - THRESHOLD_NOT_MET                                                  → failed++
 *   - DATA_UNAVAILABLE / PROVIDER_DEGRADED / SKIPPED_BY_POLICY / SANITY_REJECTED → unavailable++
 *   - ERROR                                                              → error++ (별도 카운트, ADR-0388)
 *   - 그 외 (legacy null / status 미명시) → inferStatusFromLegacyResult 위임
 *
 * @param outputs registry.run(...).outputs 형식 — `{ key, output: {status?, score} | null }[]`
 */
export function recordGateAuditByStatus(
  outputs: Array<{
    key: string;
    output: Pick<ConditionEvalOutput, 'score' | 'status'> | null;
    context?: { evaluatorKey?: string; hadRequiredData?: boolean; skippedByPolicy?: boolean };
  }>,
): void {
  const store = loadGateAudit();
  for (const { key, output, context } of outputs) {
    if (!store[key]) store[key] = { passed: 0, failed: 0, unavailable: 0, error: 0 };
    store[key].unavailable ??= 0; // 기존 영속 파일 후방호환
    store[key].error ??= 0;        // ADR-0388 신규 필드 후방호환

    const status = inferStatusFromLegacyResult(output, context);
    switch (status) {
      case 'FIRED':
        store[key].passed++;
        break;
      case 'THRESHOLD_NOT_MET':
        store[key].failed++;
        break;
      case 'DATA_UNAVAILABLE':
      case 'PROVIDER_DEGRADED':
      case 'SKIPPED_BY_POLICY':
      case 'SANITY_REJECTED':
        store[key].unavailable = (store[key].unavailable ?? 0) + 1;
        break;
      case 'ERROR':
        // ADR-0388: ERROR 는 failed 와 별도 — evaluator 깨짐 vs 임계 미달 구분 의무
        store[key].error = (store[key].error ?? 0) + 1;
        break;
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
