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
// ADR-0421 — kisFlow semantic availability 검증 SSOT.
import { evaluateInvestorFlowSemanticAvailability } from '../../supply/investorFlowSemanticAvailability.js';

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

/**
 * ADR-0418 (Phase 3, 2026-05-07) — Evaluator data availability metadata SSOT.
 *
 * Evaluator data availability must be declared at the evaluator definition layer.
 * registry.run derives requiredData / availableData / hadRequiredData from evaluator.inputs
 * and attaches that metadata to every gate output.
 *
 * Call sites such as stockScreener must not maintain evaluator-specific inclusion lists.
 * This prevents screening-time missing KIS/DART data from being misdiagnosed as
 * THRESHOLD_NOT_MET while keeping data requirements close to the evaluator that owns them.
 *
 * `requiredData` = `evaluator.inputs` 에서 추출한 외부 데이터 키 목록 (`quote` 제외).
 *   - `'quote.X'` → 무시 (quote 는 항상 가용 — evaluator 실행 자체가 quote 의존).
 *   - `'ctx.kisFlow.X'` → `'kisFlow'` 추가.
 *   - `'ctx.dartFin.X'` → `'dartFin'` 추가.
 *   - `'ctx.kospi20dReturn'` → `'kospi20dReturn'` 추가.
 *
 * `availableData[key]` = ctx 내 해당 키가 *truthy 또는 number* 인지.
 *   - kisFlow / dartFin: `Boolean(ctx[key])` (null/undefined → false).
 *   - kospi20dReturn: `typeof === 'number'` (NaN 도 false).
 *
 * `hadRequiredData` = `requiredData` 가 비었거나 모든 `availableData` true.
 */
export interface EvaluatorRunContext {
  /** evaluator 가 필요로 하는 외부 데이터 키 목록 (quote 제외). 비었으면 순수 기술 evaluator. */
  requiredData: string[];
  /** 각 requiredData 키에 대해 ctx 내 가용 여부. quote 는 항상 가용 — 이 map 에 미포함. */
  availableData: Record<string, boolean>;
  /** 모든 requiredData 가 가용한가. requiredData 가 비었으면 항상 true. */
  hadRequiredData: boolean;
}

export interface ConditionRunResult {
  totalScore: number;
  details: string[];
  conditionKeys: string[];
  /**
   * 각 evaluator 의 raw 결과 — 디버그·테스트·정적 분석·audit 입력용.
   *
   * ADR-0418 Phase 3 — `context` 옵셔널 필드로 `requiredData` / `availableData` /
   * `hadRequiredData` 자동 첨부. 호출자(stockScreener 등)는 이 context 를 그대로
   * `recordGateAuditByStatus` 에 전달하면 되며, evaluator 별 inclusion list 를 가질
   * 필요가 없다.
   */
  outputs: {
    key: ConditionKey;
    output: ConditionEvalOutput | null;
    context?: EvaluatorRunContext;
  }[];
}

export interface SharedInputReport {
  input: EvaluatorInput;
  evaluators: ConditionKey[];
}

/**
 * ADR-0418 — `EvaluatorInput` 문자열에서 외부 데이터 키 추출 SSOT.
 *
 *   - `'quote.X'` → null (quote 는 항상 가용, 외부 데이터로 간주 안 함)
 *   - `'ctx.<key>'` → `<key>` (예: `'ctx.kospi20dReturn'` → `'kospi20dReturn'`)
 *   - `'ctx.<key>.<sub>'` → `<key>` (예: `'ctx.kisFlow.institutionalNetBuy'` → `'kisFlow'`)
 *
 * 호출자가 inline 계산하지 않도록 SSOT 헬퍼로 분리 (drift 차단).
 */
export function extractExternalDataKey(input: EvaluatorInput): string | null {
  if (input.startsWith('quote.')) return null;
  if (!input.startsWith('ctx.')) return null;
  const rest = input.slice('ctx.'.length);
  const dotIdx = rest.indexOf('.');
  return dotIdx === -1 ? rest : rest.slice(0, dotIdx);
}

/**
 * ADR-0418 — ctx 내 외부 데이터 키의 가용 여부 검사 SSOT.
 *
 * 사용자 명시 edge case:
 *   - `ctx.weeklyBars = []` (빈 배열) — truthy 지만 실제 데이터 없음.
 *     본 PR 은 `Array.isArray + length>0` 까지 일반화 (비최소 안전).
 *   - `ctx.kospi20dReturn = NaN` — typeof 는 number 지만 실제 사용 불가.
 *     `Number.isFinite` 로 검증.
 *   - 그 외 객체/문자열 — `Boolean(value)` 단순 검사 (null/undefined → false).
 *
 * ADR-0421 — kisFlow 는 *semantic availability* 검증으로 격상.
 *   객체 truthy 만으로 available=true 판정 시 success=0 + provider mismatch 상태가
 *   audit 에서 unavailable 로 분류되지 않음 (사용자 명시 핵심 불변식 #1).
 *   `evaluateInvestorFlowSemanticAvailability` 위임 — required semantic field
 *   (foreignNetBuy / institutionalNetBuy) 둘 다 number-like 가용 시에만 true.
 */
export function isExternalDataAvailable(ctx: ConditionEvalContext, key: string): boolean {
  const value = (ctx as unknown as Record<string, unknown>)[key];
  if (value == null) return false;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  // ADR-0421 — kisFlow 객체는 semantic availability checker 위임 (객체 존재만으로
  //   available 판정 금지 — required semantic field 검증 의무).
  if (key === 'kisFlow') {
    return evaluateInvestorFlowSemanticAvailability(value).available;
  }
  // 객체 (dartFin 등) — truthy 면 가용으로 간주.
  return Boolean(value);
}

/**
 * ADR-0418 — evaluator 의 `inputs` 메타로부터 `EvaluatorRunContext` 자동 도출 SSOT.
 *
 * 호출자 (stockScreener 등) 는 evaluator 별 knowledge 를 가질 필요 없음 —
 * evaluator 가 자신의 `inputs` 를 선언하면 본 헬퍼가 context 자동 합성.
 */
export function deriveEvaluatorContext(
  evaluator: ConditionEvaluator,
  ctx: ConditionEvalContext,
): EvaluatorRunContext {
  const requiredSet = new Set<string>();
  for (const input of evaluator.inputs) {
    const externalKey = extractExternalDataKey(input);
    if (externalKey) requiredSet.add(externalKey);
  }
  const requiredData = Array.from(requiredSet);
  const availableData: Record<string, boolean> = {};
  for (const key of requiredData) {
    availableData[key] = isExternalDataAvailable(ctx, key);
  }
  const hadRequiredData = requiredData.length === 0
    ? true
    : requiredData.every(k => availableData[k]);
  return { requiredData, availableData, hadRequiredData };
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
      // ADR-0418 (Phase 3) — evaluator 의 inputs 메타로부터 데이터 가용성 context 자동 도출.
      // 호출자 (stockScreener 등) 는 inclusion list 를 가질 필요 없음 — context 가 매 output 에 첨부.
      const evalContext = deriveEvaluatorContext(ev, ctx);

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
        outputs.push({ key: ev.key, output: out, context: evalContext });
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
      outputs.push({ key: ev.key, output: out, context: evalContext });
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
