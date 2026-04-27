/**
 * @responsibility trailingPeakUpdate (L3-a) 단위 테스트 — 고점 갱신 mutation 검증
 */

import { describe, it, expect } from 'vitest';
import { trailingPeakUpdate } from '../trailingPeakUpdate.js';
import { makeMockShadow, makeMockCtx } from './_testHelpers.js';

describe('trailingPeakUpdate (L3-a)', () => {
  it('trailingEnabled=false 면 mutation 없음', async () => {
    const shadow = makeMockShadow({ trailingEnabled: false, trailingHighWaterMark: 110 });
    const ctx = makeMockCtx({ shadow, currentPrice: 130 });
    const r = await trailingPeakUpdate(ctx);
    expect(r.skipRest).toBe(false);
    expect(shadow.trailingHighWaterMark).toBe(110); // 갱신 안 됨
  });

  it('trailingEnabled=true + currentPrice > HWM → HWM 갱신', async () => {
    const shadow = makeMockShadow({ trailingEnabled: true, trailingHighWaterMark: 110 });
    const ctx = makeMockCtx({ shadow, currentPrice: 130 });
    await trailingPeakUpdate(ctx);
    expect(shadow.trailingHighWaterMark).toBe(130);
  });

  it('trailingEnabled=true + currentPrice ≤ HWM → HWM 유지 (래칫)', async () => {
    const shadow = makeMockShadow({ trailingEnabled: true, trailingHighWaterMark: 130 });
    const ctx = makeMockCtx({ shadow, currentPrice: 120 });
    await trailingPeakUpdate(ctx);
    expect(shadow.trailingHighWaterMark).toBe(130); // 하락은 무시
  });

  it('HWM 미설정 (undefined) 일 때 ?? 0 fallback 으로 첫 가격이 HWM 이 됨', async () => {
    const shadow = makeMockShadow({ trailingEnabled: true, trailingHighWaterMark: undefined });
    const ctx = makeMockCtx({ shadow, currentPrice: 110 });
    await trailingPeakUpdate(ctx);
    expect(shadow.trailingHighWaterMark).toBe(110);
  });

  it('항상 skipRest=false 반환 (후속 규칙 평가 계속)', async () => {
    const shadow = makeMockShadow({ trailingEnabled: true });
    const ctx = makeMockCtx({ shadow, currentPrice: 200 });
    const r = await trailingPeakUpdate(ctx);
    expect(r.skipRest).toBe(false);
    expect(r.hardStopLossUpdate).toBeUndefined();
  });
});
