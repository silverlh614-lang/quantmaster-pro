// @responsibility ADR-0398 STRONG_BUY 4 조건 OR confidence gate 회귀
import { describe, it, expect, afterEach } from 'vitest';
import {
  CONFIDENCE_GATE_THRESHOLD,
  evaluateSectorEnergyStrongBuyGate,
  isSectorEnergyStrongBuyGateDisabled,
} from './sectorEnergyStrongBuyGate.js';

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('ADR-0398: CONFIDENCE_GATE_THRESHOLD SSOT 사용자 명시', () => {
  it('임계값 0.6 정확 (사용자 명시 절대 변경 금지)', () => {
    expect(CONFIDENCE_GATE_THRESHOLD).toBe(0.6);
  });
});

describe('ADR-0398: 4 조건 OR 차단 결정 SSOT', () => {
  it('모든 조건 통과 (KRX_CODE + OK + confidence=0.8) → forbidStrongBuy=false', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.8,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('조건 1: confidence < 0.6 (사용자 명시 임계) → 차단', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.59,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('confidence'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('0.6'))).toBe(true);
  });

  it('조건 1 boundary: confidence === 0.6 → 통과 (strict less than)', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.6,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(false);
  });

  it('조건 2: dataQuality=DEGRADED → 차단', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.8,
      dataQuality: 'DEGRADED',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('DEGRADED'))).toBe(true);
  });

  it('조건 3: dataQuality=FAILED → 차단', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.8,
      dataQuality: 'FAILED',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('FAILED'))).toBe(true);
  });

  it('조건 4: sourceTier=YAHOO_ETF → 차단', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.8,
      dataQuality: 'OK',
      sourceTier: 'YAHOO_ETF',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('YAHOO_ETF'))).toBe(true);
  });

  it('STALE 단독 → 차단 (ADR-0415 정합 정정 — ADR-0398 누락 결함 차단)', () => {
    // ADR-0415 (사용자 명시) — STALE 도 STRONG_BUY 차단 6 조건 OR 에 추가.
    // 이전 ADR-0398 *원래 가정* (STALE 6-8 섹터 fallback 충분 → 통과) 은
    // "Defensive Cascade Failure 입력 layer" 보호 측면에서 보수적 격상 — 사용자 자본 보호.
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.7,
      dataQuality: 'STALE',
      sourceTier: 'STOCK_DAILY',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('STALE'))).toBe(true);
  });

  it('PARTIAL 단독 → 통과', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.7,
      dataQuality: 'PARTIAL',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(false);
  });

  it('다중 조건 동시 충족 → reasons 모두 포함', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.3, // 조건 1
      dataQuality: 'DEGRADED', // 조건 2
      sourceTier: 'YAHOO_ETF', // 조건 4
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.length).toBe(3);
    expect(result.reasons.some((r) => r.includes('confidence'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('DEGRADED'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('YAHOO_ETF'))).toBe(true);
  });

  it('NaN confidence → 보수적 차단 (안전 fallback)', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: NaN,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(true);
    expect(result.reasons.some((r) => r.includes('NaN') || r.includes('보수'))).toBe(true);
  });

  it('Infinity confidence → 보수적 차단', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: Infinity,
      dataQuality: 'OK',
      sourceTier: 'KRX_CODE',
    });
    expect(result.forbidStrongBuy).toBe(true);
  });
});

describe('ADR-0398: ENV gate `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED` SSOT', () => {
  it('default OFF → 차단 활성', () => {
    delete process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED;
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(false);
  });

  it('"true" 명시 → 차단 비활성 (즉시 STRONG_BUY 자유)', () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'true';
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(true);
  });

  it('ENV 활성 시 STRONG_BUY 게이트 통과 (4 조건 모두 충족이어도 forbidStrongBuy=false)', () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'true';
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.1,
      dataQuality: 'FAILED',
      sourceTier: 'YAHOO_ETF',
    });
    expect(result.forbidStrongBuy).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it('"1" / "TRUE" / "yes" → false (정확 비교 ADR-0157)', () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = '1';
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'TRUE';
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'yes';
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(false);
  });

  it('"false" / 빈 문자열 → false', () => {
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = 'false';
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(false);
    process.env.SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED = '';
    expect(isSectorEnergyStrongBuyGateDisabled()).toBe(false);
  });
});

describe('ADR-0398: 안전 invariant — 일반 BUY 차단 금지', () => {
  it('함수 시그니처 → STRONG_BUY 결정만 (forbidBuy 필드 부재)', () => {
    const result = evaluateSectorEnergyStrongBuyGate({
      confidence: 0.1,
      dataQuality: 'FAILED',
      sourceTier: 'YAHOO_ETF',
    });
    // 결과 객체에 forbidStrongBuy 만 존재, forbidBuy 부재
    expect('forbidStrongBuy' in result).toBe(true);
    expect('forbidBuy' in result).toBe(false);
  });
});

describe('ADR-0398: KIS 주문 함수 import 0건 (정적 grep 가드)', () => {
  it('sectorEnergyStrongBuyGate.ts 는 KIS 주문 함수 5종 import 부재', async () => {
    const KIS_ORDER_PATTERNS = [
      'placeKisMarketOrder',
      'placeKisSellOrder',
      'cancelKisOrder',
      'placeKisStopLossOrder',
      'placeKisTakeProfitOrder',
    ];
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('./sectorEnergyStrongBuyGate.ts', import.meta.url),
      'utf-8',
    );
    for (const pattern of KIS_ORDER_PATTERNS) {
      expect(src).not.toContain(pattern);
    }
  });
});
