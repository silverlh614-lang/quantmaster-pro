// @responsibility ADR-0571 producer 회귀 — 후보 sector→canonical 정규화 + Gate2 sectorThemeCycle.sector 합성 진리표.
import { describe, it, expect } from 'vitest';
import {
  canonicalizeSectorName,
  produceSectorThemeCycleForGate2,
  KRX_SECTOR_CANONICAL,
} from './sectorThemeCycleProducer.js';

describe('ADR-0571 canonicalizeSectorName — 세분화 라벨 → canonical KRX 섹터명', () => {
  it('이미 canonical 이면 그대로 통과한다', () => {
    for (const name of KRX_SECTOR_CANONICAL) {
      expect(canonicalizeSectorName(name)).toBe(name);
    }
  });

  it('세분화 라벨을 canonical 로 귀속한다 (sectorMap 어휘 커버리지)', () => {
    expect(canonicalizeSectorName('반도체소재')).toBe('반도체');
    expect(canonicalizeSectorName('반도체장비')).toBe('반도체');
    expect(canonicalizeSectorName('전자부품')).toBe('반도체');
    expect(canonicalizeSectorName('2차전지소재')).toBe('이차전지');
    expect(canonicalizeSectorName('제약')).toBe('바이오/헬스케어');
    expect(canonicalizeSectorName('헬스케어')).toBe('바이오/헬스케어');
    expect(canonicalizeSectorName('IT서비스')).toBe('인터넷/플랫폼');
    expect(canonicalizeSectorName('게임')).toBe('인터넷/플랫폼');
    expect(canonicalizeSectorName('자동차부품')).toBe('자동차');
    expect(canonicalizeSectorName('조선기자재')).toBe('조선');
    expect(canonicalizeSectorName('원자력')).toBe('방산');
    expect(canonicalizeSectorName('증권')).toBe('금융');
    expect(canonicalizeSectorName('화장품')).toBe('유통/소비재');
    expect(canonicalizeSectorName('건설기계')).toBe('건설/부동산');
    expect(canonicalizeSectorName('철강')).toBe('에너지/화학');
    expect(canonicalizeSectorName('전력기기')).toBe('에너지/화학');
    expect(canonicalizeSectorName('통신장비')).toBe('통신/유틸리티');
  });

  it('미분류·빈값·UNKNOWN·미지 라벨 → undefined (FIELD_MISSING graceful)', () => {
    expect(canonicalizeSectorName('미분류')).toBeUndefined();
    expect(canonicalizeSectorName('')).toBeUndefined();
    expect(canonicalizeSectorName('  ')).toBeUndefined();
    expect(canonicalizeSectorName('UNKNOWN')).toBeUndefined();
    expect(canonicalizeSectorName(null)).toBeUndefined();
    expect(canonicalizeSectorName(undefined)).toBeUndefined();
    expect(canonicalizeSectorName('Semiconductor')).toBeUndefined(); // 영문 미지 라벨
  });
});

describe('ADR-0571 produceSectorThemeCycleForGate2 — 후보별 sector 합성', () => {
  it('stockSector(세분화) 를 canonical 로 합성한다', () => {
    expect(produceSectorThemeCycleForGate2({ symbol: '005930', stockSector: '반도체소재' })).toEqual({
      sector: '반도체',
    });
  });

  it('stockSector 매칭 실패 시 종목코드(getSectorByCode) 로 fallback 한다', () => {
    // 005930 삼성전자 → getSectorByCode → 반도체(또는 canonical 귀속) 합성.
    const produced = produceSectorThemeCycleForGate2({ symbol: '005930', stockSector: 'Semiconductor' });
    expect(produced?.sector).toBe('반도체');
  });

  it('stockSector·코드 모두 매칭 실패 → undefined (normalizer fallback 보존)', () => {
    expect(produceSectorThemeCycleForGate2({ symbol: undefined, stockSector: '미분류' })).toBeUndefined();
    expect(produceSectorThemeCycleForGate2({ symbol: '', stockSector: null })).toBeUndefined();
  });

  it('호출자가 이미 sectorThemeCycle 을 제공하면 override 하지 않는다(undefined 반환)', () => {
    expect(
      produceSectorThemeCycleForGate2({
        symbol: '005930',
        stockSector: '반도체',
        existingSectorThemeCycle: { sector: '반도체', stockReturn20d: 0.1 },
      }),
    ).toBeUndefined();
    // 빈 객체는 미제공으로 간주 → 합성 진행.
    expect(
      produceSectorThemeCycleForGate2({ symbol: '005930', stockSector: '반도체', existingSectorThemeCycle: {} }),
    ).toEqual({ sector: '반도체' });
  });
});
