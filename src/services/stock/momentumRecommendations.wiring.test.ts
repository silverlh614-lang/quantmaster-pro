/**
 * @responsibility momentumRecommendations PR-25-B wiring 단위 테스트 — ADR-0011
 */
import { describe, it, expect } from 'vitest';
import { flattenCandidates, toUniverseMode } from './momentumRecommendations';
import type { AiUniverseDiscoverResult } from '../../api/aiUniverseClient';

describe('momentumRecommendations — toUniverseMode (PR-25-B)', () => {
  it('EARLY_DETECT 는 그대로', () => {
    expect(toUniverseMode('EARLY_DETECT')).toBe('EARLY_DETECT');
  });

  it('MOMENTUM / SMALL_MID_CAP / 기타 → MOMENTUM', () => {
    expect(toUniverseMode('MOMENTUM')).toBe('MOMENTUM');
    expect(toUniverseMode('SMALL_MID_CAP')).toBe('MOMENTUM');
    expect(toUniverseMode('UNKNOWN_MODE')).toBe('MOMENTUM');
  });
});

describe('momentumRecommendations — flattenCandidates (PR-25-B)', () => {
  it('null universe 는 빈 배열', () => {
    expect(flattenCandidates(null)).toEqual([]);
  });

  it('snapshot 있으면 PER/PBR/시총/등락률 매핑', () => {
    const universe: AiUniverseDiscoverResult = {
      mode: 'MOMENTUM',
      candidates: [
        {
          code: '005930', name: '삼성전자', market: 'KOSPI',
          discoveredFrom: ['m.stock.naver.com', 'hankyung.com'],
          snapshot: {
            code: '005930', name: '삼성전자',
            per: 12.5, pbr: 1.3, eps: 5000, bps: 50000,
            marketCap: 480_0000_0000_0000, marketCapDisplay: '480조',
            dividendYield: 1.8, foreignerOwnRatio: 52.5,
            closePrice: 75000, changeRate: 2.5,
            found: true, source: 'NAVER_MOBILE',
          },
        },
      ],
      fetchedAt: Date.now(),
      diagnostics: {
        googleQueries: 2, googleHits: 5, masterMisses: 0,
        enrichSucceeded: 1, enrichFailed: 0, budgetExceeded: false, sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
      },
    };
    const flat = flattenCandidates(universe);
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      changePercent: 2.5,
      rank: 1,
      source: 'm.stock.naver.com',
      per: 12.5,
      pbr: 1.3,
      marketCapDisplay: '480조',
    });
  });

  it('snapshot 없으면 0/빈 문자열로 fallback', () => {
    const universe: AiUniverseDiscoverResult = {
      mode: 'MOMENTUM',
      candidates: [
        {
          code: '999999', name: '테스트', market: 'KOSPI',
          discoveredFrom: [],
          snapshot: null,
        },
      ],
      fetchedAt: Date.now(),
      diagnostics: {
        googleQueries: 1, googleHits: 1, masterMisses: 0,
        enrichSucceeded: 0, enrichFailed: 1, budgetExceeded: false, sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
      },
    };
    const flat = flattenCandidates(universe);
    expect(flat[0]).toMatchObject({
      code: '999999',
      changePercent: 0,
      per: 0,
      pbr: 0,
      marketCapDisplay: '',
      source: 'google_search',
    });
  });

  it('rank 는 배열 인덱스 + 1', () => {
    const universe: AiUniverseDiscoverResult = {
      mode: 'MOMENTUM',
      candidates: [
        { code: '001', name: 'A', market: 'KOSPI', discoveredFrom: ['x'], snapshot: null },
        { code: '002', name: 'B', market: 'KOSPI', discoveredFrom: ['y'], snapshot: null },
        { code: '003', name: 'C', market: 'KOSPI', discoveredFrom: ['z'], snapshot: null },
      ],
      fetchedAt: Date.now(),
      diagnostics: {
        googleQueries: 1, googleHits: 3, masterMisses: 0,
        enrichSucceeded: 0, enrichFailed: 3, budgetExceeded: false, sourceStatus: 'GOOGLE_OK', fallbackUsed: false,
      },
    };
    const flat = flattenCandidates(universe);
    expect(flat.map(c => c.rank)).toEqual([1, 2, 3]);
  });
});
