/**
 * @responsibility ConditionEvaluator 인터페이스와 평가 컨텍스트·결과 타입 정의
 *
 * 27조건 평가기를 if 체인 거대 함수에서 플러그인 가능한 단일 책임 객체로 분리한다.
 * 각 조건은 자신이 사용하는 입력 필드(`inputs`)를 선언해 정적 분석을 가능하게 한다.
 */

import type { YahooQuoteExtended } from '../../screener/stockScreener.js';
import type { DartFinancials } from '../../clients/dartFinancialClient.js';
import type { KisInvestorFlow } from '../../clients/kisClient.js';
import type { ConditionKey, ConditionWeights } from '../../quantFilter.js';

/** 평가기에 주입되는 read-only 컨텍스트 — 실행 중 변경 금지 */
export interface ConditionEvalContext {
  readonly quote: YahooQuoteExtended;
  readonly weights: ConditionWeights;
  /**
   * KOSPI 20거래일 누적 수익률 (%) — relative_strength 조건의 벤치마크.
   *
   * Phase 1 B3 후속(공선성 제거): momentum 은 당일 +2% 이상을,
   * relative_strength 는 20일 누적 초과수익률을 측정하여 입력을 완전 분리한다.
   * 과거 1일 기준 구현은 changePercent 와 70% 이상 동시발화해 Gate 2/24
   * 이중 기여 문제를 일으켰다. 이 필드가 undefined 이면 relative_strength 는
   * 발화하지 않는다(안전 기본).
   */
  readonly kospi20dReturn?: number;
  readonly dartFin?: DartFinancials | null;
  readonly kisFlow?: KisInvestorFlow | null;
}

/**
 * ADR-0387 (2026-05-06) + ADR-0388 (2026-05-06 확장) — 평가 결과 status 분류 SSOT.
 *
 * 사용자 명시 + 외부 분석 권고: "데이터 부재" vs "임계 미달" 구분 필수.
 * `null` 만으로는 두 케이스 표현 불가 → recordGateAudit 가 둘 다 failed 로 카운트 →
 * 포스트모템이 "per 100% 실패" 로 잘못 보고 → 운영자 confirmation bias 연쇄.
 *
 * ADR-0388 확장 — 6 status 분류로 격상 (ERROR 별도 카운트 의무):
 *   - FIRED              — 점수 부여 (임계 통과)
 *   - THRESHOLD_NOT_MET  — 정상 평가 + 임계 미달 (진짜 종목 결함)
 *   - DATA_UNAVAILABLE   — 입력 데이터 부재 (PER 없음, KIS 일시 500 등)
 *   - PROVIDER_DEGRADED  — 데이터 신뢰성 손상 (Yahoo stale, KRX indexCode 누락 등 layer 3·9·10)
 *   - SKIPPED_BY_POLICY  — 정책상 평가 생략 (Volume Clock, R6 차단 등)
 *   - SANITY_REJECTED    — 데이터 비정상 영역 (drift 데드존, layer 8)
 *   - ERROR              — evaluator 예외 (try/catch 잡힘) — failed 와 분리 의무
 *
 * 사용자 명시 핵심 — ERROR 를 failed 로 합산 시 "evaluator 깨짐" vs "임계 미달"
 * 구분 손실 → 진단 오염의 작은 버전 재발. 별도 `error` 카운터 의무.
 */
export type ConditionEvalStatus =
  | 'FIRED'
  | 'THRESHOLD_NOT_MET'
  | 'DATA_UNAVAILABLE'
  | 'PROVIDER_DEGRADED'
  | 'SKIPPED_BY_POLICY'
  | 'SANITY_REJECTED'
  | 'ERROR';

/**
 * 평가 결과 — null 이면 "조건 미충족, 점수 0, detail 없음".
 * 가중치는 평가기 내부에서 이미 적용된 score 를 반환하므로 orchestrator 는 단순 합산만.
 *
 * ADR-0387: `status` 옵셔널 필드 추가 — 후방호환 (기존 evaluator 무수정).
 * status 미명시 시 score>0 → FIRED, score=0 → THRESHOLD_NOT_MET 추정 (legacy 호환).
 */
export interface ConditionEvalOutput {
  /** 가중치 적용 score (부분 점수 포함). orchestrator 는 이 값을 그대로 가산. */
  readonly score: number;
  /** UI/로깅용 상세 문구 */
  readonly detail: string;
  /** 통과한 조건 키 — 보통 evaluator.key 와 동일 */
  readonly conditionKey: ConditionKey;
  /** ADR-0387 — 평가 status 분류 (옵셔널, 기존 evaluator 후방호환). */
  readonly status?: ConditionEvalStatus;
}

/**
 * 입력 필드 식별자.
 *   - `quote.<fieldname>` : YahooQuoteExtended 의 필드
 *   - `ctx.kospi20dReturn` / `ctx.kisFlow.<...>` / `ctx.dartFin.<...>` : 외부 데이터
 *   - `ctx.<key>` : 기타 컨텍스트 키
 *
 * 정적 분석(findSharedInputs) 에서 동일 입력을 참조하는 evaluator 들을 자동 발견한다.
 */
export type EvaluatorInput = `quote.${keyof YahooQuoteExtended & string}` | `ctx.${string}`;

/**
 * 단일 조건 평가기.
 *
 * 규약:
 *   - 평가기는 ctx 를 절대 변경하지 않는다(read-only).
 *   - inputs 에 선언되지 않은 필드를 평가에서 사용하지 않는다 — 정적 분석 신뢰성.
 *   - evaluate 가 null 을 반환하면 score 합산 / details push 모두 발생하지 않는다.
 */
export interface ConditionEvaluator {
  readonly key: ConditionKey;
  /** 한국어 설명 — 디버그/대시보드용 */
  readonly description: string;
  /** 정적 분석을 위해 사용 입력을 선언 */
  readonly inputs: readonly EvaluatorInput[];
  /** 평가 본체. null = 조건 미충족. */
  evaluate(ctx: ConditionEvalContext): ConditionEvalOutput | null;
}
