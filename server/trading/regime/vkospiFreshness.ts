// @responsibility ADR-0584 VKOSPI 신선도 판정 SSOT — KOSPI 급변 중 flat(frozen) stale 감지 + 격리 가드 flag.
//
// 배경: VKOSPI 가 KRX 일별 파생지수에서 stale/오류 값(예: 73.4)으로 들어와도 "fresh"로 표기되던
// silent degradation([[fred-ecos-connectivity]] 계열, ADR-0530 후속). ADR-0530 가드는 G2(KOSPI
// 비스트레스)를 1차 안전판으로 둬 *폭락일엔 일부러 미발동* → 그 틈으로 stale-high 가 통과(73.4).
// 본 모듈은 캘린더 의존 없이 "변동성지수가 KOSPI 급변에도 flat" = frozen 을 잡아 그 갭을 막는다.
import type { MacroState } from '../../persistence/macroStateRepo.js';

/** 가드 flag — default OFF('true'만 활성). OFF면 vkospiSanityGuard flat-during-move 격리 미평가(byte-identical). */
export function isVkospiStaleGuardEnabled(): boolean {
  return process.env.VKOSPI_STALE_GUARD_ENABLED === 'true';
}

function envNumber(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export interface VkospiFlatDuringMove {
  flat: boolean;
  kospiMovePct: number | null;
  vkospiDayChange: number | null;
  movePctThreshold: number;
  flatEps: number;
}

/**
 * "VKOSPI 가 KOSPI 급변에도 flat" 감지 — stale 의 강력한 징후.
 *
 * 변동성지수는 KOSPI 급락 시 *급등*해야 정상. KOSPI |수익률| ≥ 임계인데 VKOSPI 변화 ≈ 0 이면
 * 변동성지수가 frozen(어제 값 그대로) = stale. 진짜 폭락 spike 는 큰 vkospiDayChange 라 flat 이
 * 아니므로 마스킹되지 않는다(오진 방지). 캘린더/거래일 의존 0 — macroState 숫자만 사용.
 *
 * 임계(env 튜닝): VKOSPI_STALE_MOVE_PCT(기본 3, |KOSPI 수익률|) · VKOSPI_STALE_FLAT_EPS(기본 0.5, |VKOSPI 변화|).
 */
export function detectVkospiFlatDuringMove(macroState: MacroState | null): VkospiFlatDuringMove {
  const movePctThreshold = envNumber('VKOSPI_STALE_MOVE_PCT', 3);
  const flatEps = envNumber('VKOSPI_STALE_FLAT_EPS', 0.5);
  const kospiMovePct = finite(macroState?.kospiCloseReturn ?? macroState?.kospiDayReturn);
  const vkospiDayChange = finite(macroState?.vkospiDayChange);
  const flat =
    kospiMovePct != null &&
    vkospiDayChange != null &&
    Math.abs(kospiMovePct) >= movePctThreshold &&
    Math.abs(vkospiDayChange) < flatEps;
  return { flat, kospiMovePct, vkospiDayChange, movePctThreshold, flatEps };
}

export interface VkospiFreshnessView {
  stale: boolean;
  reasons: string[];
  baseDate: string | null;
  fetchedAt: string | null;
}

/**
 * 표시/진단용 freshness 요약(executionImpact=NONE, flag 무관 — 항상 평가).
 * 현재 stale 판정 = flat-during-move(거래일 캘린더 비교는 후속). baseDate/fetchedAt 원시값 동반 노출.
 */
export function classifyVkospiFreshness(macroState: MacroState | null): VkospiFreshnessView {
  const reasons: string[] = [];
  if (detectVkospiFlatDuringMove(macroState).flat) reasons.push('FLAT_DURING_KOSPI_MOVE');
  return {
    stale: reasons.length > 0,
    reasons,
    baseDate: macroState?.vkospiBaseDate ? macroState.vkospiBaseDate : null,
    fetchedAt: macroState?.vkospiFetchedAt ? macroState.vkospiFetchedAt : null,
  };
}
