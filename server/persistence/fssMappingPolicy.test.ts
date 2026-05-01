// @responsibility fssMappingPolicy 회귀 테스트 — ADR-0142 매핑 helper.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mapPassiveActive,
  isFssMappingEnabled,
  FSS_PASSIVE_CATEGORIES,
  FSS_ACTIVE_CATEGORIES,
  FSS_FOREIGN_CATEGORIES,
} from './fssMappingPolicy.js';
import type { KrxInvestorDetailRow } from '../clients/krxClient.js';

describe('fssMappingPolicy (ADR-0142)', () => {
  const originalEnv = process.env.FSS_MAPPING_ENABLED;

  beforeEach(() => {
    delete process.env.FSS_MAPPING_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FSS_MAPPING_ENABLED;
    else process.env.FSS_MAPPING_ENABLED = originalEnv;
  });

  describe('상수 SSOT', () => {
    it('FSS_PASSIVE_CATEGORIES = 투신/연기금/보험', () => {
      expect(FSS_PASSIVE_CATEGORIES).toEqual(['투신', '연기금 등', '보험']);
    });

    it('FSS_ACTIVE_CATEGORIES = 금융투자/사모/은행/기타금융', () => {
      expect(FSS_ACTIVE_CATEGORIES).toEqual(['금융투자', '사모', '은행', '기타금융']);
    });

    it('FSS_FOREIGN_CATEGORIES = 외국인/기타외국인', () => {
      expect(FSS_FOREIGN_CATEGORIES).toEqual(['외국인', '기타외국인']);
    });
  });

  describe('mapPassiveActive', () => {
    it('11 카테고리 정상 입력 — Passive/Active/Foreign 합산 정확', () => {
      const rows: KrxInvestorDetailRow[] = [
        { category: '투신', netBuyQty: 0, netBuyKrw: 1_000_000_000 },     // +10억 passive
        { category: '연기금 등', netBuyQty: 0, netBuyKrw: 2_000_000_000 }, // +20억 passive
        { category: '보험', netBuyQty: 0, netBuyKrw: 500_000_000 },        // +5억 passive
        { category: '금융투자', netBuyQty: 0, netBuyKrw: -3_000_000_000 }, // -30억 active
        { category: '사모', netBuyQty: 0, netBuyKrw: 800_000_000 },        // +8억 active
        { category: '은행', netBuyQty: 0, netBuyKrw: 100_000_000 },        // +1억 active
        { category: '기타금융', netBuyQty: 0, netBuyKrw: -200_000_000 },   // -2억 active
        { category: '외국인', netBuyQty: 0, netBuyKrw: 5_000_000_000 },    // +50억 foreign
        { category: '기타외국인', netBuyQty: 0, netBuyKrw: -1_000_000_000 }, // -10억 foreign
        { category: '개인', netBuyQty: 0, netBuyKrw: 999_999_999 },         // unmatched
        { category: '기타법인', netBuyQty: 0, netBuyKrw: 100_000 },          // unmatched
      ];
      const result = mapPassiveActive(rows, '2026-04-29');
      expect(result.date).toBe('2026-04-29');
      expect(result.passiveNetBuy).toBe(35);   // 10+20+5
      expect(result.activeNetBuy).toBe(-23);   // -30+8+1-2
      expect(result.foreignNetBuy).toBe(40);   // 50-10
      expect(result.unmatched).toEqual(['개인', '기타법인']);
    });

    it('카테고리 일부 누락 → 누락분 0 합산 (안전 fallback)', () => {
      const rows: KrxInvestorDetailRow[] = [
        { category: '투신', netBuyQty: 0, netBuyKrw: 1_000_000_000 },
        { category: '외국인', netBuyQty: 0, netBuyKrw: 2_000_000_000 },
      ];
      const result = mapPassiveActive(rows, '2026-04-29');
      expect(result.passiveNetBuy).toBe(10);
      expect(result.activeNetBuy).toBe(0);   // 누락 → 0
      expect(result.foreignNetBuy).toBe(20);
      expect(result.unmatched).toEqual([]);
    });

    it('빈 입력 → 모두 0 + unmatched 빈 배열', () => {
      const result = mapPassiveActive([], '2026-04-29');
      expect(result.passiveNetBuy).toBe(0);
      expect(result.activeNetBuy).toBe(0);
      expect(result.foreignNetBuy).toBe(0);
      expect(result.unmatched).toEqual([]);
    });

    it('잘못된 카테고리 → unmatched 분류', () => {
      const rows: KrxInvestorDetailRow[] = [
        { category: '미상', netBuyQty: 0, netBuyKrw: 1_000_000_000 },
        { category: 'UNKNOWN', netBuyQty: 0, netBuyKrw: 500_000_000 },
      ];
      const result = mapPassiveActive(rows, '2026-04-29');
      expect(result.passiveNetBuy).toBe(0);
      expect(result.activeNetBuy).toBe(0);
      expect(result.foreignNetBuy).toBe(0);
      expect(result.unmatched).toEqual(['미상', 'UNKNOWN']);
    });

    it('NaN netBuyKrw → 0 fallback (안전)', () => {
      const rows: KrxInvestorDetailRow[] = [
        { category: '투신', netBuyQty: 0, netBuyKrw: Number.NaN },
        { category: '연기금 등', netBuyQty: 0, netBuyKrw: 1_000_000_000 },
      ];
      const result = mapPassiveActive(rows, '2026-04-29');
      expect(result.passiveNetBuy).toBe(10);  // 0 + 10
    });

    it('억원 환산 정확 (소수점 2자리 절삭)', () => {
      const rows: KrxInvestorDetailRow[] = [
        { category: '투신', netBuyQty: 0, netBuyKrw: 1_234_567_890 },  // 12.345...억원
      ];
      const result = mapPassiveActive(rows, '2026-04-29');
      expect(result.passiveNetBuy).toBe(12.35);  // toFixed(2)
    });

    it('date 파라미터 그대로 반환 (호출자 책임)', () => {
      const result = mapPassiveActive([], 'invalid-date');
      expect(result.date).toBe('invalid-date');
    });
  });

  describe('isFssMappingEnabled — ENV gate', () => {
    it('default OFF (ENV 미설정)', () => {
      delete process.env.FSS_MAPPING_ENABLED;
      expect(isFssMappingEnabled()).toBe(false);
    });

    it('FSS_MAPPING_ENABLED=true 명시 → ON', () => {
      process.env.FSS_MAPPING_ENABLED = 'true';
      expect(isFssMappingEnabled()).toBe(true);
    });

    it('FSS_MAPPING_ENABLED=false 명시 → OFF', () => {
      process.env.FSS_MAPPING_ENABLED = 'false';
      expect(isFssMappingEnabled()).toBe(false);
    });

    it('FSS_MAPPING_ENABLED=1 또는 yes → OFF (정확히 "true" 만)', () => {
      process.env.FSS_MAPPING_ENABLED = '1';
      expect(isFssMappingEnabled()).toBe(false);
      process.env.FSS_MAPPING_ENABLED = 'yes';
      expect(isFssMappingEnabled()).toBe(false);
    });
  });
});
