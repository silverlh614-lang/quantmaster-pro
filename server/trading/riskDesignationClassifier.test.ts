// @responsibility ADR-0658 위험·경고 지정 분류기 단위 테스트.

import { describe, it, expect } from 'vitest';
import { isRiskDesignatedStock } from './riskDesignationClassifier.js';

describe('isRiskDesignatedStock (ADR-0658)', () => {
  it('거래정지 → excluded', () => {
    const r = isRiskDesignatedStock({ tradingHalt: true });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('거래정지');
  });

  it('정리매매 → excluded', () => {
    const r = isRiskDesignatedStock({ liquidation: true });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('정리매매');
  });

  it('관리종목 → excluded', () => {
    const r = isRiskDesignatedStock({ managementIssue: true });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('관리종목');
  });

  it('투자주의(01) → excluded', () => {
    const r = isRiskDesignatedStock({ marketWarnCode: '01' });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('투자주의');
  });

  it('투자경고(02) → excluded (서산 사례)', () => {
    const r = isRiskDesignatedStock({ marketWarnCode: '02' });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('투자경고');
  });

  it('투자위험(03) → excluded', () => {
    const r = isRiskDesignatedStock({ marketWarnCode: '03' });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('투자위험');
  });

  it('단기과열(shortOverheated) → excluded', () => {
    const r = isRiskDesignatedStock({ shortOverheated: true });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('단기과열');
  });

  it('위험 종목상태코드(iscd_stat 58 거래정지) → excluded', () => {
    const r = isRiskDesignatedStock({ iscdStatCode: '58' });
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('58');
  });

  it('위험 종목상태코드(iscd_stat 51 관리) → excluded', () => {
    const r = isRiskDesignatedStock({ iscdStatCode: '51' });
    expect(r.excluded).toBe(true);
  });

  it('정상 — 시장경고 00 + 종목상태 00 + 모든 플래그 false → not excluded', () => {
    const r = isRiskDesignatedStock({
      marketWarnCode: '00',
      iscdStatCode: '00',
      shortOverheated: false,
      managementIssue: false,
      tradingHalt: false,
      liquidation: false,
    });
    expect(r.excluded).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('benign 신용가능 종목상태(55) → not excluded (over-filter 회피)', () => {
    const r = isRiskDesignatedStock({ iscdStatCode: '55' });
    expect(r.excluded).toBe(false);
  });

  it('빈 designation 객체 → not excluded', () => {
    const r = isRiskDesignatedStock({});
    expect(r.excluded).toBe(false);
  });

  it('미존재 designation (undefined) → not excluded (graceful, 결손≠위험)', () => {
    expect(isRiskDesignatedStock(undefined).excluded).toBe(false);
    expect(isRiskDesignatedStock(null).excluded).toBe(false);
  });
});
