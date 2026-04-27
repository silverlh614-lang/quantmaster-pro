// @responsibility sizingTierDecider 회귀 테스트 — tier 미달 / PROBING 슬롯 포화 / 통과 3 분기

import { describe, expect, it } from 'vitest';
import { sizingTierDecider } from '../sizingTierDecider.js';
import type { BanditDecision } from '../../../../learning/probingBandit.js';
import type { MacroState } from '../../../../persistence/macroStateRepo.js';

const baseInput = {
  stockName: '삼성전자',
  liveGateScore: 8.5,
  reCheckGate: { mtas: 9, conditionKeys: ['ICHIMOKU', 'MACD', 'BB', 'RS'] },
  regime: 'R2_BULL',
  macroState: { leadingSectorRS: 70, sectorCycleStage: 'EARLY' } as MacroState,
  banditDecision: { budget: 2, arms: [], rationale: 'test' } as BanditDecision,
  probingReservedSlots: 0,
};

describe('sizingTierDecider', () => {
  it('정상 입력 — ok=true + tier + logMessages', () => {
    const result = sizingTierDecider(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tierDecision.tier).not.toBeNull();
    expect(result.logMessages).toHaveLength(1);
    expect(result.logMessages[0]).toMatch(/^\[AutoTrade\/SizingTier\] 삼성전자 → /);
  });

  it('liveGate 매우 낮음 — tier=null 차단', () => {
    const result = sizingTierDecider({
      ...baseInput,
      liveGateScore: 0,
      reCheckGate: { mtas: 0, conditionKeys: [] },
      macroState: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.logMessage).toMatch(/^\[AutoTrade\/SizingTier\] 삼성전자 티어 미달 — /);
  });

  it('PROBING 슬롯 포화 — 차단', () => {
    // PROBING 티어에 들어가도록 약한 입력 사용 + 슬롯 포화로 차단
    const result = sizingTierDecider({
      ...baseInput,
      liveGateScore: 5, // PROBING 영역
      reCheckGate: { mtas: 4, conditionKeys: ['MACD'] },
      macroState: { leadingSectorRS: 30 } as MacroState, // sectorAligned=false
      banditDecision: { budget: 1, arms: [], rationale: 'tight' } as BanditDecision,
      probingReservedSlots: 1, // 이미 차 있음
    });
    // PROBING 티어로 분류되면 슬롯 포화 차단 발생
    if (!result.ok) {
      expect(result.logMessage).toMatch(/PROBING 슬롯 포화|티어 미달/);
    } else {
      expect(result.tierDecision.tier).not.toBe('PROBING');
    }
  });
});
