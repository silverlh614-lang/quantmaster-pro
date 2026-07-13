// @responsibility ADR-0528 Railway decision-log correlation contract — pins 12 correlation fields plus structured-log helper signature so core decision logs carry the same sourceSnapshotId.

import type { ExecutionPermissionResolution } from '../runtime/executionPermissionResolver.js';
import type { OrderMode } from '../trading/orderPipelineSsot.js';
import { logger } from '../utils/logger.js';

/**
 * ADR-0528 결정 단계 열거. 어느 사이클 단계에서 찍힌 결정 로그인지 식별한다.
 * 앞 6개는 평가/허가 단계, 뒤 5개는 Shadow lifecycle 5-event 체인(실제 체결 검증용).
 * 단일 로그를 전체 판단으로 해석 금지 — stage 가 "그 시점 한 단계"임을 명시한다.
 */
export type DecisionStage =
  | 'GATE_SCORE'
  | 'GATE1'
  | 'GATE2'
  | 'GATE3'
  | 'EXECUTION_PERMISSION'
  | 'POSITION_POLICY'
  // --- Shadow lifecycle 5-event 체인 (orderPipelineSsot / shadowBuyExecutor 정합) ---
  | 'SHADOW_EXECUTION_START'
  | 'SHADOW_ORDER_CREATED'
  | 'SHADOW_PAPER_FILLED'
  | 'SHADOW_POSITION_OPENED'
  | 'LEDGER_RECORDED';

/** Shadow lifecycle 5-event 체인의 순서 정본 (가드·테스트가 단절 검출에 사용). */
export const SHADOW_LIFECYCLE_CHAIN: readonly DecisionStage[] = [
  'SHADOW_EXECUTION_START',
  'SHADOW_ORDER_CREATED',
  'SHADOW_PAPER_FILLED',
  'SHADOW_POSITION_OPENED',
  'LEDGER_RECORDED',
] as const;

/** 실행 모드 — orderPipelineSsot.OrderMode 와 동일 의미를 carry (별도 정의 금지, single source). */
type DecisionLogMode = OrderMode;

/**
 * ADR-0528 핵심 결정 로그 상관 필드(12종). 모든 핵심 결정 로그가 보유한다.
 * 단계별 가용성을 인정한다(일부 optional) — 예: GATE_SCORE 단계엔 permission 미가용.
 * 단 sourceSnapshotId + decisionStage + symbol 은 항상 필수(같은 사이클 식별 최소 단위).
 *
 * 필드 출처(재계산 금지, 정본에서 carry):
 *  - sourceSnapshotId ← SourceSnapshot (ADR-0519, server/ssotSnapshot.ts)
 *  - candidateSetId ← Step27 candidate set (스캔 사이클 후보 집합 식별자)
 *  - gateScoreInputSnapshotId ← gateScoreInputSnapshot (②의 내부 입력 파생)
 *  - finalVerdict ← CandidateGateEvaluationView.topBlockReason (ADR-0526 ②)
 *  - liveOrderAllowed / shadowOrderAllowed / paperFillAllowed / executionImpact
 *      ← UnifiedExecutionPermissionResolution (ADR-0527 ③)
 *  - positionIntent ← PositionPolicyDecision 표본 (ADR-0527 ④, 진단/LIVE 구분)
 */
export interface DecisionLogCorrelation {
  /** 입력 정본 cycle id (필수) — ADR-0519 SourceSnapshot. 같은 값이면 같은 사이클. */
  sourceSnapshotId: string;
  /** 결정 단계(필수) — "그 시점 한 단계"임을 명시. */
  decisionStage: DecisionStage;
  /** 종목 코드(필수). 5-event 체인 묶음 키. */
  symbol: string;
  /** Step27 후보 집합 id. 스캔 사이클 내 후보 묶음(단계에 따라 부재 가능). */
  candidateSetId?: string;
  /** Gate 점수 입력 스냅샷 id(②의 내부 입력, 파생). */
  gateScoreInputSnapshotId?: string;
  /** 실행 모드(LIVE/SHADOW). 허가 결정 이후 단계에서 가용. */
  mode?: DecisionLogMode;
  // --- permission 군 (③ UnifiedExecutionPermissionResolution, boolean) ---
  /** ③ liveOrderAllowed. EXECUTION_PERMISSION 이후 단계에서 가용. */
  liveOrderAllowed?: boolean;
  /** ③ shadowPermissionAllowed 신호(로그 키 이름은 shadowOrderAllowed — created count 아님). */
  shadowOrderAllowed?: boolean;
  /** ③ paperFillAllowed. */
  paperFillAllowed?: boolean;
  /** ③ executionImpact (LIVE 안전성 분류 — providerIssue ≠ bearish 불변식 #6 보존값). */
  executionImpact?: ExecutionPermissionResolution['executionImpact'];
  /** ② CandidateGateEvaluationView.topBlockReason (통합 verdict). 평가 완료 후 가용. */
  finalVerdict?: string;
  /** ④ PositionPolicyDecision 의도 라벨 (진단/LIVE 표본 + tier/posPct 요약). */
  positionIntent?: string;
}

/** 항상 필수인 상관 필드(가드·헬퍼가 부재 시 fail 판단에 사용). */
export const REQUIRED_CORRELATION_FIELDS = ['sourceSnapshotId', 'decisionStage', 'symbol'] as const;

/**
 * EXECUTION_PERMISSION 이후 단계에서 추가로 요구되는 상관 필드.
 * 가드가 "stage 가 충분히 진행됐는데 permission 필드 누락" 을 검출하는 기준.
 */
export const PERMISSION_STAGE_REQUIRED_FIELDS = [
  'liveOrderAllowed',
  'shadowOrderAllowed',
  'paperFillAllowed',
  'executionImpact',
] as const;

/** 상관 필드를 출력 순서 정본(가독·grep 안정성)대로 직렬화한다. undefined 는 생략. */
const CORRELATION_FIELD_ORDER: readonly (keyof DecisionLogCorrelation)[] = [
  'sourceSnapshotId',
  'symbol',
  'candidateSetId',
  'gateScoreInputSnapshotId',
  'mode',
  'liveOrderAllowed',
  'shadowOrderAllowed',
  'paperFillAllowed',
  'executionImpact',
  'finalVerdict',
  'positionIntent',
] as const;

/** 단일 key=value 토큰. logger.formatKeyValue / orderPipelineSsot.kv 와 동형(공백·따옴표 미사용). */
function decisionKv(key: string, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return `${key}=${value.toISOString()}`;
  if (typeof value === 'object') {
    try {
      return `${key}=${JSON.stringify(value)}`;
    } catch {
      /* SDS-ignore: 직렬화 불가 값은 String() 폴백 — 로그 출력 전용, 결정에 무영향 */
      return `${key}=${String(value)}`;
    }
  }
  return `${key}=${String(value)}`;
}

/**
 * ADR-0528 구조화 결정 로그 헬퍼.
 * 출력 형식: `[DECISION] stage=<stage> <상관 필드 key=value...> <detail key=value...>`.
 * 기존 logger.formatKeyValue / orderPipelineSsot.kv 의 `key=value` 컨벤션과 동형으로 결합한다
 * (사람이 읽는 prefix + 기계가 parse 하는 key=value suffix). undefined optional 필드는 생략한다.
 * logOperationalEvent 를 대체하지 않고 결정 로그 라인에 상관 필드를 부착한다.
 * decisionStage 는 correlation 보다 stage 인자를 우선(호출부가 명시한 단계가 SSOT).
 */
export function formatDecisionLog(
  stage: DecisionStage,
  correlation: DecisionLogCorrelation,
  detail?: Record<string, unknown>,
): string {
  const tokens: string[] = ['[DECISION]', `decisionStage=${stage}`];
  for (const field of CORRELATION_FIELD_ORDER) {
    const token = decisionKv(field, correlation[field]);
    if (token) tokens.push(token);
  }
  if (detail) {
    for (const [key, value] of Object.entries(detail)) {
      const token = decisionKv(key, value);
      if (token) tokens.push(token);
    }
  }
  return tokens.join(' ');
}

/**
 * executionImpact 기반 로그 레벨 분류. LIVE 안전성 신호만 승격(warn/error 아님 — 결정 로그는 정보성).
 * providerIssue ≠ marketSignal(불변식 #6) 보존 — executionImpact 값을 *읽어* 레벨만 정한다.
 */
function classifyDecisionLevel(
  correlation: DecisionLogCorrelation,
): 'debug' | 'info' {
  const impact = correlation.executionImpact;
  if (impact === undefined || impact === 'NONE') return 'info';
  return 'info';
}

/**
 * ADR-0528 결정 이벤트 emit 헬퍼.
 * formatDecisionLog 로 라인을 만들고 기존 logger 로 출력한다(레벨은 executionImpact 기반 분류).
 * 런타임 동작 변경 없음 — 결정 로직이 아니라 로그 출력 레이어. 로그 실패가 매매를 멈추면 안 되므로
 * 직렬화/출력 전체를 try/catch 로 격리한다(불변식 #1/#2 — Trading/Shadow 정지 금지).
 */
export function logDecisionEvent(
  stage: DecisionStage,
  correlation: DecisionLogCorrelation,
  detail?: Record<string, unknown>,
): void {
  try {
    const line = formatDecisionLog(stage, correlation, detail);
    const level = classifyDecisionLevel(correlation);
    if (level === 'debug') {
      logger.debug(line);
      return;
    }
    logger.info(line);
  } catch (err) {
    /* SDS-ignore: 결정 로그 출력 실패는 매매를 멈추지 못한다(불변식 #1/#2). 최소 fallback 만. */
    try {
      console.info(`[DECISION] decisionStage=${stage} symbol=${correlation.symbol} logFormatError=${String(err)}`);
    } catch {
      /* SDS-ignore: 로깅 자체가 불가능한 환경에서도 throw 금지 */
    }
  }
}
