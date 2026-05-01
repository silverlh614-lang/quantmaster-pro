/**
 * @responsibility ADR-0151 Phase 2 KIS Supply Audit 회귀 — silent degradation 차단 +
 * audit findings 권고 정정 + buildConditionSourceTiers 의미 정합 보호.
 *
 * 본 테스트는 정적 grep 으로 enrichment.ts 의 결함 패턴 (0 박제) 부재 + ADR-0151
 * 의도 (AI 추정 보존) 가 두 path 모두 적용됨을 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { buildConditionSourceTiers, buildSnapshotSupplyStub } from './enrichment';

describe('ADR-0151 — Phase 2 KIS Supply Audit silent degradation 차단', () => {
  it('buildSnapshotSupplyStub: ADR-0011 정합 — foreignNet/institutionNet 영원히 0', () => {
    // Naver snapshot 모의 — found=true 시에도 stub 가 0 박제 (ADR-0011 PR-25-C 정책)
    const snap: any = {
      foreignerOwnRatio: 35.5,
      found: true,
      per: 12, pbr: 1.2, eps: 5000, bps: 50000, marketCap: 1e12, marketCapDisplay: '1조',
    };
    const stub = buildSnapshotSupplyStub(snap);
    expect(stub).not.toBeNull();
    expect(stub!.foreignNet).toBe(0);          // ← ADR-0011 정책으로 0 박제
    expect(stub!.institutionNet).toBe(0);      // ← 동일
    expect(stub!.individualNet).toBe(0);
    expect(stub!.foreignConsecutive).toBe(0);
    expect(stub!.institutionalDailyAmounts).toEqual([]);
    expect(stub!.foreignerOwnRatio).toBe(35.5); // ← 정적 % 만 보존
    expect(stub!.dataSource).toBe('NAVER_SNAPSHOT');
  });

  it('buildSnapshotSupplyStub null snapshot → null 반환', () => {
    expect(buildSnapshotSupplyStub(null)).toBeNull();
  });

  it('buildSnapshotSupplyStub found=false → dataSource=NONE', () => {
    const snap: any = { foreignerOwnRatio: 0, found: false, per: 0, pbr: 0, eps: 0, bps: 0, marketCap: 0, marketCapDisplay: '' };
    const stub = buildSnapshotSupplyStub(snap);
    expect(stub!.dataSource).toBe('NONE');
  });

  it('buildConditionSourceTiers: hasKisSupply=true 여도 institutionalBuying / supplyInflow → AI_INFERRED 유지', () => {
    // ADR-0151: hasKisSupply 후방호환 인자, 라벨 부여 0
    const meta = buildConditionSourceTiers({
      hasDartFinancials: false,
      hasKisSupply: true,
      hasVcpComputed: false,
    });
    expect(meta.institutionalBuying).toBe('AI_INFERRED');
    expect(meta.supplyInflow).toBe('AI_INFERRED');
  });

  it('buildConditionSourceTiers: hasKisSupply=false 동일 — AI_INFERRED', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: false,
      hasKisSupply: false,
      hasVcpComputed: false,
    });
    expect(meta.institutionalBuying).toBe('AI_INFERRED');
    expect(meta.supplyInflow).toBe('AI_INFERRED');
  });

  it('buildConditionSourceTiers: 27 키 모두 정의 (보존 회귀)', () => {
    const meta = buildConditionSourceTiers({
      hasDartFinancials: true,
      hasKisSupply: true,
      hasVcpComputed: true,
    });
    expect(Object.keys(meta)).toHaveLength(27);
    // ADR-0151 정합 — API 카운트 5 (DART), COMPUTED 1 (VCP), AI_INFERRED 21
    const apiCount = Object.values(meta).filter((v) => v === 'API').length;
    const aiCount = Object.values(meta).filter((v) => v === 'AI_INFERRED').length;
    const computedCount = Object.values(meta).filter((v) => v === 'COMPUTED').length;
    expect(apiCount).toBe(5);
    expect(computedCount).toBe(1);
    expect(aiCount).toBe(21);
  });
});

describe('ADR-0151 — enrichment.ts 정적 grep 가드 (silent degradation 회귀 차단)', () => {
  it('main path: 0 박제 패턴 (kisSupply?.foreignNet ?? 0) > 0 부재', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    // 이전 잘못된 패턴이 다시 등장하면 fail
    expect(src).not.toMatch(/\(kisSupply\?\.foreignNet\s*\?\?\s*0\)\s*>\s*0/);
    expect(src).not.toMatch(/\(kisSupply\?\.institutionNet\s*\?\?\s*0\)\s*>\s*0/);
  });

  it('main path: AI 추정 보존 패턴 stock.checklist?.supplyInflow 적용', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    // ADR-0151 정합 패턴 — supplyInflow / institutionalBuying 가 stock.checklist 보존
    expect(src).toContain('stock.checklist?.institutionalBuying');
    expect(src).toContain('stock.checklist?.supplyInflow');
  });

  it('buildConditionSourceTiers: hasKisSupply 분기에 \'API\' 라벨 부여 코드 부재', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    // hasKisSupply 분기에 'API' 부여하는 패턴이 없음 (의미 mismatch 차단)
    const matches = src.match(/if\s*\(\s*ctx\.hasKisSupply\s*\)[\s\S]{0,200}meta\.\w+\s*=\s*'API'/g);
    expect(matches?.length ?? 0).toBe(0);
  });

  it('ADR-0151 주석이 enrichment.ts 에 등장 (트레이서빌리티)', async () => {
    const { readFileSync } = await import('fs');
    const src = readFileSync('src/services/stock/enrichment.ts', 'utf-8');
    expect(src).toContain('ADR-0151');
  });
});
