/**
 * @responsibility ConditionEvaluator 들을 등록·실행·정적 분석하는 Open-Closed 호환 레지스트리
 *
 * 사용:
 *   const reg = new ConditionRegistry();
 *   reg.register(momentumEvaluator).register(maAlignmentEvaluator);
 *   const { totalScore, conditionKeys, details } = reg.run({ quote, weights, ... });
 *
 * 신규 조건 추가 = 새 evaluator 파일 + index.ts 한 줄 register 추가. 기존 코드 0줄 수정.
 */

import type {
  ConditionEvaluator,
  ConditionEvalContext,
  ConditionEvalOutput,
  EvaluatorInput,
} from './types.js';
import type { ConditionKey } from '../../quantFilter.js';

export interface ConditionRunResult {
  totalScore: number;
  details: string[];
  conditionKeys: string[];
  /** 각 evaluator 의 raw 결과 — 디버그·테스트·정적 분석용 */
  outputs: { key: ConditionKey; output: ConditionEvalOutput | null }[];
}

export interface SharedInputReport {
  input: EvaluatorInput;
  evaluators: ConditionKey[];
}

export class ConditionRegistry {
  private readonly evaluators = new Map<ConditionKey, ConditionEvaluator>();

  /**
   * 평가기 등록. 같은 key 의 중복 등록은 즉시 throw — 우연한 덮어쓰기 차단.
   * Fluent API 로 체이닝 가능: reg.register(a).register(b);
   */
  register(evaluator: ConditionEvaluator): this {
    if (this.evaluators.has(evaluator.key)) {
      throw new Error(`[ConditionRegistry] 중복 등록: key=${evaluator.key}`);
    }
    this.evaluators.set(evaluator.key, evaluator);
    return this;
  }

  list(): readonly ConditionEvaluator[] {
    return [...this.evaluators.values()];
  }

  has(key: ConditionKey): boolean {
    return this.evaluators.has(key);
  }

  /** 등록된 모든 평가기를 순서대로 실행하고 결과를 합산 */
  run(ctx: ConditionEvalContext): ConditionRunResult {
    let totalScore = 0;
    const details: string[] = [];
    const conditionKeys: string[] = [];
    const outputs: ConditionRunResult['outputs'] = [];

    for (const ev of this.evaluators.values()) {
      const out = ev.evaluate(ctx);
      outputs.push({ key: ev.key, output: out });
      if (!out) continue;
      totalScore += out.score;
      details.push(out.detail);
      conditionKeys.push(out.conditionKey);
    }

    return { totalScore, details, conditionKeys, outputs };
  }

  /**
   * 정적 분석: 같은 입력을 2개 이상의 evaluator 가 참조하는 항목 목록.
   *
   * 예시 결과:
   *   [{ input: 'quote.changePercent', evaluators: ['momentum', 'relative_strength', 'volume_surge'] }]
   *
   * 용도:
   *   - 조건 간 의존성 가시화 (한 필드 변경의 파급 범위 파악)
   *   - 중복 평가 비용 진단 (같은 필드를 N번 읽음 → 캐싱 후보)
   *   - 의도치 않은 결합 발견
   */
  findSharedInputs(): SharedInputReport[] {
    const map = new Map<EvaluatorInput, ConditionKey[]>();
    for (const ev of this.evaluators.values()) {
      for (const input of ev.inputs) {
        const list = map.get(input) ?? [];
        list.push(ev.key);
        map.set(input, list);
      }
    }
    return [...map.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([input, evaluators]) => ({ input, evaluators }));
  }
}
