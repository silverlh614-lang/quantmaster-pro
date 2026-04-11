/**
 * regimeBridge.ts — MacroState → RegimeVariables 변환 + 라이브 레짐 판정
 *
 * 역할: 서버 측 MacroState(지속적으로 축적되는 거시 지표)를
 *       프론트엔드 classifyRegime()이 요구하는 RegimeVariables 7축으로 매핑.
 *
 * 효과: backtestPortfolio()와 라이브 signalScanner가 동일한 classifyRegime()를
 *       공유 → 검증한 것과 실행하는 것이 일치하는 시스템.
 */

import type { RegimeVariables, RegimeLevel } from '../../src/types/core.js';
import { classifyRegime } from '../../src/services/quant/regimeEngine.js';
import type { MacroState } from '../persistence/macroStateRepo.js';

/**
 * MacroState → RegimeVariables
 * 누락 필드는 보수적 중립값으로 fallback — 판정을 보수적 방향으로 편향.
 */
export function buildRegimeVars(macroState: MacroState): RegimeVariables {
  return {
    // ① 변동성
    vkospi:          macroState.vkospi          ?? 20,
    vkospiDayChange: macroState.vkospiDayChange  ?? 0,
    vkospi5dTrend:   macroState.vkospi5dTrend   ?? 0,

    // ② 거시 (MHS·환율)
    mhsScore:        macroState.mhs              ?? 50,
    usdKrw:          macroState.usdKrw           ?? 1300,
    usdKrw20dChange: macroState.usdKrw20dChange  ?? 0,
    usdKrwDayChange: macroState.usdKrwDayChange  ?? 0,

    // ③ 수급
    foreignNetBuy5d:  macroState.foreignNetBuy5d  ?? 0,
    passiveActiveBoth: macroState.passiveActiveBoth ?? false,

    // ④ 지수 기술적
    kospiAbove20MA:  macroState.kospiAbove20MA   ?? true,
    kospiAbove60MA:  macroState.kospiAbove60MA   ?? true,
    kospi20dReturn:  macroState.kospi20dReturn   ?? 0,
    kospiDayReturn:  macroState.kospiDayReturn   ?? 0,

    // ⑤ 사이클
    leadingSectorRS:  macroState.leadingSectorRS  ?? 50,
    sectorCycleStage: macroState.sectorCycleStage ?? 'MID',

    // ⑥ 신용·심리
    marginBalance5dChange: macroState.marginBalance5dChange ?? 0,
    shortSellingRatio:     macroState.shortSellingRatio     ?? 5,

    // ⑦ 글로벌
    spx20dReturn: macroState.spx20dReturn ?? 0,
    vix:          macroState.vix          ?? 20,
    dxy5dChange:  macroState.dxy5dChange  ?? 0,
  };
}

/**
 * MacroState → RegimeLevel
 * macroState가 null이면 R4_NEUTRAL 반환 (신호 스캔 일시 중단 없음, 보수적 운용).
 */
export function getLiveRegime(macroState: MacroState | null): RegimeLevel {
  if (!macroState) return 'R4_NEUTRAL';
  return classifyRegime(buildRegimeVars(macroState));
}
