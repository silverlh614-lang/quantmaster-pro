/**
 * @responsibility buyApproval 카드 표시 포맷/DataQuality 회귀 테스트
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildBuyApprovalMessage, formatPreMortemForDisplay } from './buyApproval.js';
import { buildPreMortem } from '../clients/enemyCheckClient.js';

beforeEach(() => {
  process.env.CARD_HIDE_UNMATERIALIZED_ENEMY_ITEMS = 'false';
  process.env.TELEGRAM_HIDE_UNMATERIALIZED_ENEMY_ITEMS = 'false';
  process.env.DATAQUALITY_BADGE_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.CARD_HIDE_UNMATERIALIZED_ENEMY_ITEMS;
  delete process.env.TELEGRAM_HIDE_UNMATERIALIZED_ENEMY_ITEMS;
  delete process.env.DATAQUALITY_BADGE_ENABLED;
});

describe('buy approval card formatting', () => {
  it('Gate 6.619999999999999는 6.62, RRR 2.6000000000000005는 2.60으로 표시된다', () => {
    const message = buildBuyApprovalMessage({
      stockName: '테스트',
      currentPrice: 17_050,
      quantity: 1,
      stopLoss: 10_000,
      targetPrice: 35_380.000000000004,
      mode: 'SHADOW',
      gateScore: 6.619999999999999,
      timeoutLine: '<i>60초 내 미응답 시 자동 승인</i>',
    });
    expect(message).toContain('현재가: 17,050원');
    expect(message).toContain('RRR: 2.60 | Gate: 6.62');
    expect(message).not.toContain('6.619999999999999');
    expect(message).not.toContain('2.6000000000000005');
  });

  it('AI Pre-Mortem은 Shadow 가설/LOW 및 실거래 미반영 문구로 렌더링된다', () => {
    const pm = buildPreMortem({ lines: ['검증되지 않은 수급 악화 가설'] });
    expect(formatPreMortemForDisplay(pm)).toContain('실패 시나리오(Shadow 가설 / LOW)');
    expect(formatPreMortemForDisplay(pm)).toContain('실거래 판단에는 미반영');
  });

  it('표시 오류가 Trading Engine을 중단시키지 않고 executionImpact=NONE 및 Shadow Learning 무영향 문구를 유지한다', () => {
    const message = buildBuyApprovalMessage({
      stockName: '테스트',
      currentPrice: 17_050,
      quantity: 1,
      stopLoss: 16_000,
      targetPrice: 19_000,
      mode: 'SHADOW',
      gateScore: 6.62,
      enemyCheck: {
        creditRate: null,
        individualDominance: null,
        shortSaleIncreaseRate: -100,
        loanIncreaseRate: null,
        creditIncreaseRate: null,
        shortStatus: 'FIELD_MISMATCH_CONFIRMED',
        flowMaterialized: false,
        priceMaterialized: true,
        source: 'KIS_PARTIAL',
      },
      timeoutLine: '<i>60초 내 미응답 시 자동 승인</i>',
    });
    expect(message).toContain('[Shadow]');
    expect(message).toContain('executionImpact=NONE');
    expect(message).toContain('공매도 증가율: N/A');
  });
});
