/**
 * ocoFillMonitor.test.ts — Phase 3.1 스켈레톤 회귀 테스트
 *
 * 이 스켈레톤은 Shadow 기간 내내 **실주문을 내지 않는** 것이 계약의 핵심.
 * 테스트는 그 계약이 환경변수/플래그 조합에서 절대 깨지지 않음을 검증한다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ocoFillMonitor — Phase 3.1 안전 계약', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OCO_AUTO_REGISTER;
    delete process.env.KIS_IS_REAL;
  });

  it('planOcoRegistration: 유효한 입력으로 계획 생성', async () => {
    const mod = await import('./ocoFillMonitor.js');
    const plan = mod.planOcoRegistration({
      stockCode: '005930',
      filledQty: 10,
      entryPrice: 72000,
      stopLossPrice: 68000,
      takeProfitPrice: 80000,
      tradeId: 't1',
    });
    expect(plan).not.toBeNull();
    expect(plan!.quantity).toBe(10);
    expect(plan!.stopPrice).toBe(68000);
    expect(plan!.targetPrice).toBe(80000);
  });

  it('planOcoRegistration: stopPrice >= targetPrice 면 null', async () => {
    const mod = await import('./ocoFillMonitor.js');
    expect(mod.planOcoRegistration({
      stockCode: '005930', filledQty: 10, entryPrice: 70000,
      stopLossPrice: 80000, takeProfitPrice: 75000,
      tradeId: 't1',
    })).toBeNull();
  });

  it('planOcoRegistration: filledQty 0 이면 null', async () => {
    const mod = await import('./ocoFillMonitor.js');
    expect(mod.planOcoRegistration({
      stockCode: '005930', filledQty: 0, entryPrice: 70000,
      stopLossPrice: 68000, takeProfitPrice: 80000,
      tradeId: 't1',
    })).toBeNull();
  });

  it('flag off → DRY_RUN (실주문 절대 없음)', async () => {
    const mod = await import('./ocoFillMonitor.js');
    expect(mod.OCO_AUTO_REGISTER_ENABLED).toBe(false);
    const plan = mod.planOcoRegistration({
      stockCode: '005930', filledQty: 1, entryPrice: 72000,
      stopLossPrice: 68000, takeProfitPrice: 80000,
      tradeId: 't1',
    })!;
    const result = await mod.registerOcoForFill(plan);
    expect(result.status).toBe('DRY_RUN');
  });

  it('flag on + KIS_IS_REAL=false → SKIPPED (VTS에서 실주문 거부)', async () => {
    process.env.OCO_AUTO_REGISTER = 'true';
    process.env.KIS_IS_REAL = 'false';
    vi.resetModules();
    const mod = await import('./ocoFillMonitor.js');
    expect(mod.OCO_AUTO_REGISTER_ENABLED).toBe(true);
    const plan = mod.planOcoRegistration({
      stockCode: '005930', filledQty: 1, entryPrice: 72000,
      stopLossPrice: 68000, takeProfitPrice: 80000,
      tradeId: 't1',
    })!;
    const result = await mod.registerOcoForFill(plan);
    expect(result.status).toBe('SKIPPED');
  });

  it('flag on + KIS_IS_REAL=true → REJECTED (구현 미완성, 안전장치)', async () => {
    process.env.OCO_AUTO_REGISTER = 'true';
    process.env.KIS_IS_REAL = 'true';
    vi.resetModules();
    const mod = await import('./ocoFillMonitor.js');
    const plan = mod.planOcoRegistration({
      stockCode: '005930', filledQty: 1, entryPrice: 72000,
      stopLossPrice: 68000, takeProfitPrice: 80000,
      tradeId: 't1',
    })!;
    const result = await mod.registerOcoForFill(plan);
    expect(result.status).toBe('REJECTED');
    expect(result.reason).toContain('구현 미완성');
  });
});
