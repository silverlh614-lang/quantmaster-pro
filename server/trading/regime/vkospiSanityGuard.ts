// @responsibility VKOSPI 값 1건의 신뢰 상태를 VIX·KOSPI 교차검증으로 분류한다(불변식 #6: provider 장애 ≠ market signal).
/**
 * ADR-0530: VKOSPI stale/implausible 신뢰 가드.
 *
 * VKOSPI 가 VIX·KOSPI 수익률과 명백히 모순(구현 불가능한 괴리)이면 해당 값 1건을
 * UNTRUSTED_IMPLAUSIBLE 로 강등해 R6-recovery 의 vkospiOk level gate 에서 격리한다.
 * 진짜 폭락(KOSPI 급락 동반)은 절대 마스킹하지 않는다 — G2(KOSPI 비스트레스)가 1차 안전판.
 *
 * 정책 원칙(불변식 #6): VKOSPI 값 자체를 보정·0 치환하지 않는다(null≠0). 신뢰 *상태*만 분류.
 * implausible VKOSPI 는 marketSignal=true/bearish 로 변환되지 않는다(marketSignal: false literal).
 *
 * 비상 롤백(kill-switch): VKOSPI_SANITY_GUARD_DISABLED=true 면 가드 미발동(legacy 동작 복원).
 * 가드는 기본 ON — 활성화용 ENV 없이도 동작한다(운영자 override: env on/off 분기 금지).
 * 튜닝용 숫자 ENV: VKOSPI_VIX_DIVERGENCE_CAP(25), VKOSPI_GUARD_KOSPI_FLOOR(-1.0).
 */
import type { MacroState } from '../../persistence/macroStateRepo.js';
import type { VkospiSanityVerdict } from '../../../src/types/gate0Regime.js';
import { isVkospiStaleGuardEnabled, detectVkospiFlatDuringMove } from './vkospiFreshness.js';

/** G3 intraday 비스트레스 임계(%). 장중 패닉 저점이 이보다 깊으면 진짜 스트레스로 간주. */
const INTRADAY_STRESS_FLOOR_PCT = -3.0;

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 음수 허용 숫자 ENV 파서 — VKOSPI_GUARD_KOSPI_FLOOR 처럼 음수 임계를 읽기 위해 envInt(>=0) 대신 사용. */
function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

/** 가드 강제 비활성 여부(비상 롤백 kill-switch). 기본 미설정 = 가드 ON. */
function isGuardDisabled(): boolean {
  return process.env.VKOSPI_SANITY_GUARD_DISABLED === 'true';
}

/**
 * VKOSPI 신뢰 상태를 분류한다.
 *
 * 발동(격리) 조건 = AND (전부 충족):
 *   G1 VIX 괴리:        vix != null && (vkospi - vix) > VKOSPI_VIX_DIVERGENCE_CAP(25)
 *   G2 KOSPI 비스트레스: (kospiCloseReturn ?? kospiDayReturn) > VKOSPI_GUARD_KOSPI_FLOOR(-1.0)
 *   G3 intraday 비스트레스: kospiIntradayLowReturn == null || kospiIntradayLowReturn > -3.0
 *
 * - vkospi == null              → MISSING (기존 fallback 유지)
 * - guardTriggered              → UNTRUSTED_IMPLAUSIBLE (level gate 격리 대상)
 * - freshness stale & 미발동     → UNTRUSTED_STALE (reasons 라벨만; level gate 격리는 implausible 에만)
 * - 그 외                        → TRUSTED
 *
 * @param now  freshness 진단용(현재 미사용 — sourceFreshness 는 macroState 표기 우선). 시그니처 계약 유지.
 */
export function classifyVkospiSanity(macroState: MacroState | null, _now: Date = new Date()): VkospiSanityVerdict {
  void _now;
  const vkospi = finiteOrNull(macroState?.vkospi);
  const vix = finiteOrNull(macroState?.vix);
  const kospiDayReturn = finiteOrNull(macroState?.kospiCloseReturn ?? macroState?.kospiDayReturn);
  const kospiIntradayLowReturn = finiteOrNull(macroState?.kospiIntradayLowReturn);
  const vixDivergence = vkospi != null && vix != null ? vkospi - vix : null;

  // VKOSPI 결손 — 격리도 신뢰도 아닌 MISSING. 기존 vkospiOk fallback(threshold 비교)이 그대로 동작.
  if (vkospi == null) {
    return {
      trustState: 'MISSING',
      vkospi: null,
      vix,
      vixDivergence: null,
      kospiDayReturn,
      guardTriggered: false,
      providerIssue: false,
      marketSignal: false,
      reasons: ['VKOSPI_MISSING'],
    };
  }

  const divergenceCap = envNumber('VKOSPI_VIX_DIVERGENCE_CAP', 25);
  const kospiFloor = envNumber('VKOSPI_GUARD_KOSPI_FLOOR', -1.0);

  // G1: VKOSPI·VIX 괴리가 구현 불가능하게 큼(통상 ±5~10 동행).
  const g1VixDivergence = vix != null && vixDivergence != null && vixDivergence > divergenceCap;
  // G2: KOSPI 가 스트레스 상태가 아님(진짜 변동성 급등이면 KOSPI 동반 급락) — 진짜 폭락 보호 1차 안전판.
  const g2KospiNotStressed = (kospiDayReturn ?? Number.NEGATIVE_INFINITY) > kospiFloor;
  // G3: 장중 패닉 저점 부재(없으면 비스트레스로 간주).
  const g3IntradayNotStressed = kospiIntradayLowReturn == null || kospiIntradayLowReturn > INTRADAY_STRESS_FLOOR_PCT;
  const classicTriggered = g1VixDivergence && g2KospiNotStressed && g3IntradayNotStressed;

  // ADR-0584: flag-gated freshness 격리 — VKOSPI 가 KOSPI 급변에도 flat(frozen)이면 G2(KOSPI 스트레스)와
  // 무관하게 implausible 격리. 폭락일에 stale-high 가 G2(KOSPI 스트레스) 안전판으로 가드를 우회하던 갭을
  // 닫는다(진짜 폭락 spike 는 큰 vkospiDayChange 라 flat 아님 → 마스킹 안 됨). flag OFF(default)=미평가 byte-identical.
  const g4StaleFlat = isVkospiStaleGuardEnabled() && detectVkospiFlatDuringMove(macroState).flat;

  const guardTriggered = !isGuardDisabled() && (classicTriggered || g4StaleFlat);

  const reasons: string[] = [];
  if (guardTriggered) {
    if (g1VixDivergence) reasons.push('VIX_DIVERGENCE');
    if (g2KospiNotStressed) reasons.push('KOSPI_NOT_STRESSED');
    if (g3IntradayNotStressed) reasons.push('INTRADAY_NOT_STRESSED');
    if (g4StaleFlat) reasons.push('VKOSPI_STALE_FLAT_DURING_MOVE');
  }

  if (guardTriggered) {
    return {
      trustState: 'UNTRUSTED_IMPLAUSIBLE',
      vkospi,
      vix,
      vixDivergence,
      kospiDayReturn,
      guardTriggered: true,
      providerIssue: true,
      marketSignal: false,
      reasons,
    };
  }

  // 미발동 — freshness stale 이면 라벨만 부착(level gate 격리는 implausible 에만 적용).
  const freshness = String(
    (macroState as unknown as Record<string, unknown> | null)?.sourceFreshness ?? '',
  ).toUpperCase();
  const isStale = freshness === 'STALE' || freshness === 'HARD_STALE' || freshness === 'EXPIRED';
  if (isStale) {
    return {
      trustState: 'UNTRUSTED_STALE',
      vkospi,
      vix,
      vixDivergence,
      kospiDayReturn,
      guardTriggered: false,
      providerIssue: true,
      marketSignal: false,
      reasons: ['VKOSPI_SOURCE_STALE'],
    };
  }

  return {
    trustState: 'TRUSTED',
    vkospi,
    vix,
    vixDivergence,
    kospiDayReturn,
    guardTriggered: false,
    providerIssue: false,
    marketSignal: false,
    reasons: [],
  };
}
