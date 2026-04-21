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
 * 평가 결과 — null 이면 "조건 미충족, 점수 0, detail 없음".
 * 가중치는 평가기 내부에서 이미 적용된 score 를 반환하므로 orchestrator 는 단순 합산만.
 */
export interface ConditionEvalOutput {
  /** 가중치 적용 score (부분 점수 포함). orchestrator 는 이 값을 그대로 가산. */
  readonly score: number;
  /** UI/로깅용 상세 문구 */
  readonly detail: string;
  /** 통과한 조건 키 — 보통 evaluator.key 와 동일 */
  readonly conditionKey: ConditionKey;
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
