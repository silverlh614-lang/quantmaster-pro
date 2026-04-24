/**
 * @responsibility Naver snapshot supply stub 변환 회귀 테스트 — PR-25-C, ADR-0011
 */
import { describe, it, expect } from 'vitest';
import { buildSnapshotSupplyStub } from './enrichment';
import type { AiUniverseValuation } from '../../api/aiUniverseClient';

function mkSnap(overrides: Partial<AiUniverseValuation> = {}): AiUniverseValuation {
  return {
    code: '005930', name: '삼성전자',
    per: 12.5, pbr: 1.3, eps: 5000, bps: 50000,
    marketCap: 480_0000_0000_0000, marketCapDisplay: '480조',
    dividendYield: 1.8, foreignerOwnRatio: 52.5,
    closePrice: 75000, changeRate: 1.2,
    found: true, source: 'NAVER_MOBILE',
    ...overrides,
  };
}

describe('enrichment.buildSnapshotSupplyStub (PR-25-C)', () => {
  it('null snapshot → null', () => {
    expect(buildSnapshotSupplyStub(null)).toBeNull();
  });

  it('found=true 는 dataSource=NAVER_SNAPSHOT + foreignerOwnRatio 보존', () => {
    const stub = buildSnapshotSupplyStub(mkSnap());
    expect(stub).toMatchObject({
      dataSource: 'NAVER_SNAPSHOT',
      foreignerOwnRatio: 52.5,
    });
  });

  it('found=false 는 dataSource=NONE', () => {
    const stub = buildSnapshotSupplyStub(mkSnap({ found: false, foreignerOwnRatio: 0 }));
    expect(stub?.dataSource).toBe('NONE');
  });

  it('일별 순매수·연속일수 필드는 0/빈 배열 (AI 자체 판단 영역)', () => {
    const stub = buildSnapshotSupplyStub(mkSnap());
    expect(stub).toMatchObject({
      foreignNet: 0,
      institutionNet: 0,
      individualNet: 0,
      foreignConsecutive: 0,
      institutionalDailyAmounts: [],
      isPassiveAndActive: false,
    });
  });
});
