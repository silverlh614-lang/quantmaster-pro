// @responsibility /vkospi_index_dump 포맷터 회귀 — substring 매칭 행 강조 + 전체 덤프 (read-only 진단).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../commandRegistry.js', () => ({ commandRegistry: { register: vi.fn() } }));

const row = (o: Record<string, unknown>) => ({
  baseDate: '20260607', indexCode: '?', indexName: '', close: 0, change: 0, changePct: 0,
  open: 0, high: 0, low: 0, volume: 0, value: 0, marketCap: 0, ...o,
});

vi.mock('../../../clients/krxOpenApi.js', () => ({
  fetchDerivativesIndexDaily: vi.fn(async () => [
    // 엉뚱/stale 후보(~73, flat) — 현 substring 이 줍는 행
    row({ indexCode: 'V001', indexName: '코스피 200 변동성지수(stale)', close: 73.4, change: -0.04, changePct: 0.0, baseDate: '20260605' }),
    // 진짜 VKOSPI 후보(~16, VIX 근처, spike) — 같은 응답 안에 존재(wrong-row 가설)
    row({ indexCode: 'V002', indexName: 'VKOSPI', close: 16.2, change: 1.1, changePct: 7.3 }),
    // 무관 파생지수
    row({ indexCode: 'F001', indexName: '코스피200 선물지수', close: 340, change: -18, changePct: -5.0 }),
  ]),
  // production 과 동일 SSOT predicate (krxOpenApi.isVkospiIndexName) — 실제 구현과 일치.
  isVkospiIndexName: (name: string) =>
    name.includes('VKOSPI') ||
    name.includes('코스피 200 변동성지수') ||
    name.includes('코스피200변동성지수') ||
    name.includes('코스피변동성'),
}));

vi.mock('../../../persistence/macroStateRepo.js', () => ({ loadMacroState: vi.fn(() => ({ vix: 16.1 })) }));

import { formatVkospiIndexDump } from './vkospiIndexDump.cmd.js';

describe('formatVkospiIndexDump — KRX 파생지수 덤프 진단', () => {
  it('rowCount·VIX·substring 매칭·코드·전체행을 모두 노출', async () => {
    const out = await formatVkospiIndexDump();
    expect(out).toContain('rowCount=3');
    expect(out).toContain('VIX=16.1');
    // 두 변동성 행 모두 substring 매칭(=ambiguity 노출) + IDX_IND_CD 표시
    expect(out).toContain('[V001] 코스피 200 변동성지수(stale)');
    expect(out).toContain('[V002] VKOSPI');
    expect(out).toContain('close=73.40');
    expect(out).toContain('close=16.20');
    // 무관 행도 전체 덤프에 포함
    expect(out).toContain('[F001] 코스피200 선물지수');
    expect(out).toContain('executionImpact=NONE');
  });
});
