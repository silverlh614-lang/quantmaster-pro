// @responsibility ADR-0658 위험·경고 지정 분류기 단위 테스트.

import { describe, it, expect } from 'vitest';
import {
  isRiskDesignatedStock,
  isFundamentalJunkBelowFloor,
} from './riskDesignationClassifier.js';

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

describe('isFundamentalJunkBelowFloor (ADR-0659)', () => {
  const FLOOR = -20;

  it('ROE -55(서산) → excluded (deep junk)', () => {
    const r = isFundamentalJunkBelowFloor({ roePct: -55.6 }, FLOOR);
    expect(r.excluded).toBe(true);
    expect(r.reason).toContain('FUNDAMENTAL_JUNK_FLOOR');
    expect(r.reason).toContain('-55.6');
    expect(r.reason).toContain('-20');
  });

  it('ROE exactly == floor (-20) → excluded (≤ 경계 포함)', () => {
    const r = isFundamentalJunkBelowFloor({ roePct: -20 }, FLOOR);
    expect(r.excluded).toBe(true);
  });

  it('ROE -19.9 (floor 바로 위) → not excluded', () => {
    const r = isFundamentalJunkBelowFloor({ roePct: -19.9 }, FLOOR);
    expect(r.excluded).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it('경미한 적자 ROE -5 → not excluded (턴어라운드 살림)', () => {
    expect(isFundamentalJunkBelowFloor({ roePct: -5 }, FLOOR).excluded).toBe(false);
  });

  it('흑자 ROE +12 → not excluded', () => {
    expect(isFundamentalJunkBelowFloor({ roePct: 12 }, FLOOR).excluded).toBe(false);
  });

  it('ROE null → not excluded (graceful, 데이터 결손≠junk, 불변식 #6)', () => {
    expect(isFundamentalJunkBelowFloor({ roePct: null }, FLOOR).excluded).toBe(false);
    expect(isFundamentalJunkBelowFloor({ roePct: undefined }, FLOOR).excluded).toBe(false);
    expect(isFundamentalJunkBelowFloor({}, FLOOR).excluded).toBe(false);
  });

  it('ROE NaN / ±Infinity → not excluded (graceful)', () => {
    expect(isFundamentalJunkBelowFloor({ roePct: NaN }, FLOOR).excluded).toBe(false);
    expect(isFundamentalJunkBelowFloor({ roePct: Number.POSITIVE_INFINITY }, FLOOR).excluded).toBe(false);
    expect(isFundamentalJunkBelowFloor({ roePct: Number.NEGATIVE_INFINITY }, FLOOR).excluded).toBe(false);
  });

  it('floor override (-40) → ROE -30 은 미제외, -55 만 제외', () => {
    expect(isFundamentalJunkBelowFloor({ roePct: -30 }, -40).excluded).toBe(false);
    expect(isFundamentalJunkBelowFloor({ roePct: -55 }, -40).excluded).toBe(true);
  });
});
