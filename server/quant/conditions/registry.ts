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

/**
 * ADR-0411 — Yahoo 시계열 파생 지표 (closes[]/highs[]/volumes[]/MA/RSI/MACD/ATR/BB/MTAS)
 * 의존 evaluator 카탈로그 SSOT. quote.yahooDerivedIndicatorsReliable=false 시 registry.run
 * 진입부에서 자동 PROVIDER_DEGRADED 강등 → score / details / conditionKeys 미합산.
 *
 * 비포함 (yahooDerivedIndicatorsReliable 무관):
 *   - per                — Yahoo PER (가격 *시점* derived 가 아닌 fundamental, ADR-0387 P0-3 별도 처리)
 *   - supply_confluence  — KIS Investor Flow (Yahoo 무관)
 *   - earnings_quality   — DART 재무 (Yahoo 무관)
 *
 * 포함 (14 evaluator):
 *   - momentum / vcp / volume_surge (ADR-0389 status 적용)
 *   - ma_alignment / volume_breakout / turtle_high / relative_strength / breakout_momentum (ADR-0390)
 *   - rsi_zone / macd_bull / pullback / ma60_rising / weekly_rsi_zone / trend_acceleration (status 미적용 — legacy null fallback)
 */
export const TIMESERIES_DEPENDENT_EVALUATORS: ReadonlySet<ConditionKey> = new Set<ConditionKey>([
  'momentum',
  'vcp',
  'volume_surge',
  'ma_alignment',
  'volume_breakout',
  'turtle_high',
  'relative_strength',
  'breakout_momentum',
  'rsi_zone',
  'macd_bull',
  'pullback',
  'ma60_rising',
  'weekly_rsi_zone',
  'trend_acceleration',
]);

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

  /**
   * 등록된 모든 평가기를 순서대로 실행하고 결과를 합산.
   *
   * ADR-0388: evaluator 예외 try/catch 격리 — 한 evaluator 의 throw 가 전체 run 차단 안 함.
   * 잡힌 예외는 `{score: 0, status: 'ERROR', detail}` 로 변환 → recordGateAuditByStatus 가
   * `error` 카운터에 별도 누적 (failed 와 분리, "evaluator 깨짐" vs "임계 미달" 구분 의무).
   *
   * ENV `CONDITION_REGISTRY_THROW_DISABLED=true` (default OFF — try/catch 활성) 시
   * 기존 동작 (예외 그대로 throw) 복원. default 는 ADR-0388 안전 정책 적용.
   */
  run(ctx: ConditionEvalContext): ConditionRunResult {
    let totalScore = 0;
    const details: string[] = [];
    const conditionKeys: string[] = [];
    const outputs: ConditionRunResult['outputs'] = [];
    const isThrowMode = process.env.CONDITION_REGISTRY_THROW_DISABLED === 'true';

    // ADR-0411: yahooDerivedIndicatorsReliable=false 시 시계열 의존 evaluator 자동 PROVIDER_DEGRADED.
    // ENV `ADR_0411_PROVIDER_DEGRADED_DISABLED=true` 우회 (default OFF, ADR-0157 정합) — 강등 비활성화.
    // - 미설정 (legacy quote — yahooDerivedIndicatorsReliable undefined): 강등 미적용 (기존 동작 보존).
    // - true: evaluator 호출 자체 skip + PROVIDER_DEGRADED status output 영속 (recordGateAuditByStatus 가
    //   `unavailable` 카운터 누적 — `failed` 와 분리, 진단 오염 차단).
    const isProviderDegradedDisabled = process.env.ADR_0411_PROVIDER_DEGRADED_DISABLED === 'true';
    const yahooDerivedReliable = ctx.quote?.yahooDerivedIndicatorsReliable;
    const downgradeTimeseriesEvaluators = !isProviderDegradedDisabled
      && yahooDerivedReliable === false;

    for (const ev of this.evaluators.values()) {
      let out: ConditionEvalOutput | null = null;
      // ADR-0411 — 시계열 의존 evaluator + Yahoo derived 신뢰성 손상 시 evaluator 호출 자체 skip
      // (evaluator 가 stale closes[] 로 잘못된 점수 산출하기 전 차단).
      if (downgradeTimeseriesEvaluators && TIMESERIES_DEPENDENT_EVALUATORS.has(ev.key)) {
        const dataQualityLabel = ctx.quote?.dataQuality ?? 'unknown';
        out = {
          score: 0,
          conditionKey: ev.key,
          detail: `Yahoo 시계열 신뢰성 손상 (dataQuality=${dataQualityLabel}) — PROVIDER_DEGRADED`,
          status: 'PROVIDER_DEGRADED',
        };
        outputs.push({ key: ev.key, output: out });
        // PROVIDER_DEGRADED 는 score / details / conditionKeys 미합산 (아래 분기와 동일).
        continue;
      }
      try {
        out = ev.evaluate(ctx);
      } catch (err) {
        if (isThrowMode) throw err; // ENV 우회 — legacy 동작 복원
        // ADR-0388 default — ERROR status 로 변환, run 자체는 계속.
        const errMsg = err instanceof Error ? err.message : String(err);
        out = {
          score: 0,
          conditionKey: ev.key,
          detail: `evaluator 예외: ${errMsg}`,
          status: 'ERROR',
        };
        console.warn(
          `[ConditionRegistry] evaluator ${ev.key} 예외 — ERROR status 로 변환 (ADR-0388): ${errMsg}`,
        );
      }
      outputs.push({ key: ev.key, output: out });
      if (!out) continue;
      // ADR-0388: ERROR status 는 score / details / conditionKeys 모두 제외.
      if (out.status === 'ERROR') continue;
      // ADR-0387/0389: status 명시 + non-FIRED 시 score/details/conditionKeys 미합산.
      // (DATA_UNAVAILABLE/THRESHOLD_NOT_MET/PROVIDER_DEGRADED/SKIPPED_BY_POLICY/SANITY_REJECTED)
      // legacy null/status 미명시 시 후방호환 — 기존 score>0 동작 보존.
      if (out.status !== undefined && out.status !== 'FIRED') continue;
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
