/**
 * @responsibility addBuyBlockGate 단위 테스트 — addBuyBlocked 플래그 분기
 */

import { describe, it, expect } from 'vitest';
import { addBuyBlockGate } from '../addBuyBlockGate.js';
import { makeMockCtx, makeMockStock, makeMockShadow } from './_testHelpers.js';

describe('addBuyBlockGate', () => {
  it('shadows 빈 배열 → pass=true', async () => {
    const r = await addBuyBlockGate(makeMockCtx({ shadows: [] }));
    expect(r.pass).toBe(true);
  });

  it('동일 종목 shadow + addBuyBlocked=true → pass=false', async () => {
    const stock = makeMockStock({ code: '005930' });
    const shadow = makeMockShadow({ stockCode: '005930', addBuyBlocked: true });
    const r = await addBuyBlockGate(makeMockCtx({ stock, shadows: [shadow] }));
    expect(r.pass).toBe(false);
    if (!r.pass) {
      expect(r.logMessage).toContain('추가 매수 차단');
      expect(r.logMessage).toContain('Cascade -7%');
    }
  });

  it('addBuyBlocked=false → pass=true (플래그 미설정 시나리오)', async () => {
    const shadow = makeMockShadow({ stockCode: '005930', addBuyBlocked: false });
    const r = await addBuyBlockGate(makeMockCtx({ shadows: [shadow] }));
    expect(r.pass).toBe(true);
  });

  it('다른 종목 shadow 가 차단 플래그여도 본 종목은 통과', async () => {
    const stock = makeMockStock({ code: '005930' });
    const otherShadow = makeMockShadow({ stockCode: '000660', addBuyBlocked: true });
    const r = await addBuyBlockGate(makeMockCtx({ stock, shadows: [otherShadow] }));
    expect(r.pass).toBe(true);
  });

  it('동일 종목 다중 shadows 중 하나라도 addBuyBlocked → pass=false', async () => {
    const stock = makeMockStock({ code: '005930' });
    const s1 = makeMockShadow({ stockCode: '005930', addBuyBlocked: false });
    const s2 = makeMockShadow({ stockCode: '005930', addBuyBlocked: true });
    const r = await addBuyBlockGate(makeMockCtx({ stock, shadows: [s1, s2] }));
    expect(r.pass).toBe(false);
  });
});
