// @responsibility CATALYST/SWING 섹션별 손절 정책 분리 순수 헬퍼

import { REGIME_CONFIGS } from '../../../../src/services/quant/regimeEngine.js';
import { CATALYST_FIXED_STOP_PCT } from '../../../screener/watchlistManager.js';
import { buildStopLossPlan, type StopLossPlan } from '../../entryEngine.js';

export type ProfileKey = 'profileA' | 'profileB' | 'profileC' | 'profileD';

export interface StopLossPolicyInput {
  profileType?: 'A' | 'B' | 'C' | 'D';
  section?: string;
  regime: keyof typeof REGIME_CONFIGS;
  shadowEntryPrice: number;
  fallbackStopLoss: number;     // stock.stopLoss
  reCheckQuoteAtr?: number;
}

export interface StopLossPolicyOutput {
  profile: 'A' | 'B' | 'C' | 'D';
  profileKey: ProfileKey;
  isCatalyst: boolean;
  regimeStopRate: number;
  entryATR14: number;
  catalystFixedStop: number;
  stopLossPlan: StopLossPlan;
}

/**
 * ADR-0031 PR-64 — 라인 955-966 의 손절 정책 분리 + buildStopLossPlan 호출을 byte-equivalent 추출.
 *
 * CATALYST 섹션: 고정 -5% 타이트 손절 (ATR 동적 손절 비사용)
 * SWING 섹션: 기존 ATR 동적 손절 + 레짐 손절
 *
 * 순수 함수 — 외부 mutation·부수효과 0건. 차단 분기 없음.
 */
export function stopLossPolicyResolver(input: StopLossPolicyInput): StopLossPolicyOutput {
  const profile = input.profileType ?? 'B';
  const profileKey = `profile${profile}` as ProfileKey;
  const isCatalyst = input.section === 'CATALYST';
  const regimeStopRate = isCatalyst
    ? CATALYST_FIXED_STOP_PCT
    : REGIME_CONFIGS[input.regime].stopLoss[profileKey];
  const entryATR14 = isCatalyst ? 0 : (input.reCheckQuoteAtr ?? 0);
  const catalystFixedStop = isCatalyst
    ? Math.round(input.shadowEntryPrice * (1 + CATALYST_FIXED_STOP_PCT))
    : input.fallbackStopLoss;
  const stopLossPlan = buildStopLossPlan({
    entryPrice: input.shadowEntryPrice,
    fixedStopLoss: isCatalyst ? catalystFixedStop : input.fallbackStopLoss,
    regimeStopRate,
    atr14: entryATR14,
    regime: input.regime,
  });

  return { profile, profileKey, isCatalyst, regimeStopRate, entryATR14, catalystFixedStop, stopLossPlan };
}
