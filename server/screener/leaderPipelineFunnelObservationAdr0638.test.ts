// @responsibility ADR-0638 회귀 — flag OFF skip·cacheEmpty/cacheStale 분기·OVEREXTENDED 컷 카운트·funnel 합 정합·dominantCutReason·ledger FIFO/upsert/손상 fallback·섹션 출력.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DynamicStock } from './dynamicUniverseExpander.js';
import {
  isLeaderPipelineFunnelObservationEnabled,
  computeLeaderCacheFreshness,
  computeLeaderPipelineFunnelObservation,
  appendLeaderPipelineFunnelLedger,
  loadLeaderPipelineFunnelLedger,
  loadLatestLeaderPipelineFunnelRow,
  formatLeaderPipelineFunnelSection,
  LEADER_PIPELINE_FUNNEL_WINDOW_SCANS,
  type LeaderPipelineFunnelObservation,
} from './leaderPipelineFunnelObservationAdr0638.js';

// ── fixtures ────────────────────────────────────────────────────────────────────

function tmpFile(): string {
  return path.join(os.tmpdir(), `lpf-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function leaderStock(
  code: string,
  source: DynamicStock['source'],
  addedAt: string,
): DynamicStock {
  return {
    symbol: `${code}.KS`,
    code,
    name: code,
    source,
    addedAt,
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
}

const NOW = new Date('2026-06-19T05:00:00.000Z'); // KST 2026-06-19 14:00
const ISO_NOW = NOW.toISOString();
const ISO_4D_AGO = new Date(NOW.getTime() - 4 * 86_400_000).toISOString(); // > TTL(3d) → stale
const ISO_8H_AGO = new Date(NOW.getTime() - 8 * 3_600_000).toISOString();  // fresh

function baseObservation(
  overrides: Partial<LeaderPipelineFunnelObservation> = {},
): LeaderPipelineFunnelObservation {
  return computeLeaderPipelineFunnelObservation({
    cacheFreshness: computeLeaderCacheFreshness([leaderStock('005930', 'FOREIGN_NET_BUY', ISO_8H_AGO)], NOW),
    cacheLeaderCodeCount: 1,
    leaderCodesEnteredStage1: 1,
    leaderCodesPassedStage1: 1,
    leaderStage1Cut: { byOverextended: 0, byOverheat: 0, byOther: 0 },
    leaderPreservedIntoPool: 1,
    enabled: true,
    now: NOW,
    ...overrides,
  } as Parameters<typeof computeLeaderPipelineFunnelObservation>[0]);
}

// ── flag SSOT ─────────────────────────────────────────────────────────────────

describe('ADR-0638 flag SSOT (default OFF)', () => {
  it('미설정 → OFF', () => {
    expect(isLeaderPipelineFunnelObservationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
  it("정확비교 'true' 만 ON", () => {
    expect(isLeaderPipelineFunnelObservationEnabled({ LEADER_PIPELINE_FUNNEL_OBS_ENABLED: 'TRUE' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLeaderPipelineFunnelObservationEnabled({ LEADER_PIPELINE_FUNNEL_OBS_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isLeaderPipelineFunnelObservationEnabled({ LEADER_PIPELINE_FUNNEL_OBS_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

// ── (1) 캐시 신선도 ─────────────────────────────────────────────────────────────

describe('ADR-0638 computeLeaderCacheFreshness', () => {
  it('leader entry 0 → cacheEmpty=true, cacheStale=false', () => {
    const cf = computeLeaderCacheFreshness([], NOW);
    expect(cf.cacheEmpty).toBe(true);
    expect(cf.cacheStale).toBe(false);
    expect(cf.leaderEntryCount).toBe(0);
    expect(cf.oldestLeaderAddedAt).toBeNull();
    expect(cf.oldestLeaderAgeHours).toBeNull();
  });

  it('비주도 source 만 있으면 cacheEmpty=true (leader 만 카운트)', () => {
    const cf = computeLeaderCacheFreshness(
      [leaderStock('111111', '52W_HIGH' as DynamicStock['source'], ISO_8H_AGO)],
      NOW,
    );
    expect(cf.totalEntryCount).toBe(1);
    expect(cf.leaderEntryCount).toBe(0);
    expect(cf.cacheEmpty).toBe(true);
  });

  it('모든 leader entry 가 TTL 초과 → cacheStale=true', () => {
    const cf = computeLeaderCacheFreshness(
      [
        leaderStock('005930', 'FOREIGN_NET_BUY', ISO_4D_AGO),
        leaderStock('000660', 'INST_NET_BUY', ISO_4D_AGO),
      ],
      NOW,
    );
    expect(cf.cacheEmpty).toBe(false);
    expect(cf.staleLeaderCount).toBe(2);
    expect(cf.cacheStale).toBe(true);
  });

  it('일부만 stale → cacheStale=false (전건 stale 만 stale 판정)', () => {
    const cf = computeLeaderCacheFreshness(
      [
        leaderStock('005930', 'FOREIGN_NET_BUY', ISO_4D_AGO), // stale
        leaderStock('000660', 'INST_NET_BUY', ISO_8H_AGO),    // fresh
      ],
      NOW,
    );
    expect(cf.staleLeaderCount).toBe(1);
    expect(cf.cacheStale).toBe(false);
    expect(cf.leaderEntryDist.FOREIGN_NET_BUY).toBe(1);
    expect(cf.leaderEntryDist.INST_NET_BUY).toBe(1);
  });

  it('age 산출 — oldest 기준 시간', () => {
    const cf = computeLeaderCacheFreshness([leaderStock('005930', 'MARKET_CAP', ISO_8H_AGO)], NOW);
    expect(cf.oldestLeaderAgeHours).toBeCloseTo(8, 1);
    expect(cf.oldestLeaderAddedAt).toBe(ISO_8H_AGO);
    expect(cf.newestLeaderAddedAt).toBe(ISO_8H_AGO);
  });
});

// ── (2) funnel 산출 ─────────────────────────────────────────────────────────────

describe('ADR-0638 computeLeaderPipelineFunnelObservation', () => {
  it('OVEREXTENDED 컷 카운트 → dominantLeaderCutReason=OVEREXTENDED', () => {
    const obs = baseObservation({
      leaderCodesEnteredStage1: 9,
      leaderCodesPassedStage1: 2,
      leaderStage1Cut: { byOverextended: 5, byOverheat: 1, byOther: 1 },
    });
    expect(obs.dominantLeaderCutReason).toBe('OVEREXTENDED');
    expect(obs.leaderStage1Cut.byOverextended).toBe(5);
  });

  it('funnel 합 정합 — entered = passed + cut 총합', () => {
    const cut = { byOverextended: 5, byOverheat: 1, byOther: 1 };
    const obs = baseObservation({
      leaderCodesEnteredStage1: 9,
      leaderCodesPassedStage1: 2,
      leaderStage1Cut: cut,
    });
    const cutTotal = cut.byOverextended + cut.byOverheat + cut.byOther;
    expect(obs.leaderCodesPassedStage1 + cutTotal).toBe(obs.leaderCodesEnteredStage1);
  });

  it('cut 합 0 → dominantLeaderCutReason=null', () => {
    const obs = baseObservation({
      leaderCodesEnteredStage1: 3,
      leaderCodesPassedStage1: 3,
      leaderStage1Cut: { byOverextended: 0, byOverheat: 0, byOther: 0 },
    });
    expect(obs.dominantLeaderCutReason).toBeNull();
  });

  it('executionImpact 항상 NONE·observationOnly true (관측 전용 불변)', () => {
    const obs = baseObservation();
    expect(obs.executionImpact).toBe('NONE');
    expect(obs.observationOnly).toBe(true);
  });

  it('leaderPreservedIntoPool 은 입력 그대로 carry (0617 재사용)', () => {
    const obs = baseObservation({ leaderPreservedIntoPool: 7 });
    expect(obs.leaderPreservedIntoPool).toBe(7);
  });
});

// ── ledger I/O ──────────────────────────────────────────────────────────────────

describe('ADR-0638 ledger FIFO/upsert/손상 fallback', () => {
  const files: string[] = [];
  afterEach(() => {
    for (const f of files) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    files.length = 0;
  });

  it('append → load 왕복', () => {
    const file = tmpFile(); files.push(file);
    const obs = baseObservation();
    appendLeaderPipelineFunnelLedger(obs, NOW, file);
    const rows = loadLeaderPipelineFunnelLedger(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].scanDateKey).toBe(obs.scanDateKey);
    expect(rows[0].appendedAt).toBe(ISO_NOW);
  });

  it('동일 scanDateKey upsert (중복 누적 아님)', () => {
    const file = tmpFile(); files.push(file);
    appendLeaderPipelineFunnelLedger(baseObservation({ cacheLeaderCodeCount: 1 }), NOW, file);
    appendLeaderPipelineFunnelLedger(baseObservation({ cacheLeaderCodeCount: 9 }), NOW, file);
    const rows = loadLeaderPipelineFunnelLedger(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].cacheLeaderCodeCount).toBe(9);
  });

  it(`FIFO 캡 ${LEADER_PIPELINE_FUNNEL_WINDOW_SCANS} 유지`, () => {
    const file = tmpFile(); files.push(file);
    for (let i = 0; i < LEADER_PIPELINE_FUNNEL_WINDOW_SCANS + 10; i += 1) {
      const day = new Date(NOW.getTime() + i * 86_400_000);
      appendLeaderPipelineFunnelLedger(baseObservation({ now: day } as Partial<LeaderPipelineFunnelObservation>), day, file);
    }
    const rows = loadLeaderPipelineFunnelLedger(file);
    expect(rows.length).toBe(LEADER_PIPELINE_FUNNEL_WINDOW_SCANS);
  });

  it('손상 JSON → 빈 배열 fallback (시스템 무중단)', () => {
    const file = tmpFile(); files.push(file);
    fs.writeFileSync(file, '{not-json');
    expect(loadLeaderPipelineFunnelLedger(file)).toEqual([]);
    // 손상 위에 append 해도 동작
    appendLeaderPipelineFunnelLedger(baseObservation(), NOW, file);
    expect(loadLeaderPipelineFunnelLedger(file)).toHaveLength(1);
  });

  it('loadLatest → 최신행 1개 / 미존재 → null', () => {
    const file = tmpFile(); files.push(file);
    expect(loadLatestLeaderPipelineFunnelRow(file)).toBeNull();
    const d1 = new Date(NOW.getTime());
    const d2 = new Date(NOW.getTime() + 86_400_000);
    appendLeaderPipelineFunnelLedger(baseObservation({ now: d1 } as Partial<LeaderPipelineFunnelObservation>), d1, file);
    appendLeaderPipelineFunnelLedger(baseObservation({ now: d2, cacheLeaderCodeCount: 42 } as Partial<LeaderPipelineFunnelObservation>), d2, file);
    const latest = loadLatestLeaderPipelineFunnelRow(file);
    expect(latest?.cacheLeaderCodeCount).toBe(42);
  });
});

// ── section formatter ─────────────────────────────────────────────────────────

describe('ADR-0638 formatLeaderPipelineFunnelSection', () => {
  it('flag OFF → null (섹션 미출력, byte-identical)', () => {
    expect(formatLeaderPipelineFunnelSection(baseObservation() as never, false)).toBeNull();
  });

  it('row null → null', () => {
    expect(formatLeaderPipelineFunnelSection(null, true)).toBeNull();
  });

  it('OVEREXTENDED 주컷 → 가설(a) 힌트', () => {
    const row = { ...baseObservation({
      leaderStage1Cut: { byOverextended: 5, byOverheat: 1, byOther: 0 },
    }), appendedAt: ISO_NOW };
    const out = formatLeaderPipelineFunnelSection(row, true);
    expect(out).toContain('ADR-0638');
    expect(out).toContain('(a)');
    expect(out).toContain('OVEREXTENDED 5');
  });

  it('cacheEmpty + refresh ON → 가설(b) 힌트 + EMPTY', () => {
    const row = { ...computeLeaderPipelineFunnelObservation({
      cacheFreshness: computeLeaderCacheFreshness([], NOW),
      cacheLeaderCodeCount: 0,
      leaderCodesEnteredStage1: 0,
      leaderCodesPassedStage1: 0,
      leaderStage1Cut: { byOverextended: 0, byOverheat: 0, byOther: 0 },
      leaderPreservedIntoPool: 0,
      enabled: true,
      now: NOW,
    }), appendedAt: ISO_NOW };
    const out = formatLeaderPipelineFunnelSection(row, true, true);
    expect(out).toContain('EMPTY');
    expect(out).toContain('(b)');
  });

  it('cacheStale + refresh ON → 가설(b) 힌트 + STALE', () => {
    const row = { ...computeLeaderPipelineFunnelObservation({
      cacheFreshness: computeLeaderCacheFreshness([leaderStock('005930', 'FOREIGN_NET_BUY', ISO_4D_AGO)], NOW),
      cacheLeaderCodeCount: 1,
      leaderCodesEnteredStage1: 1,
      leaderCodesPassedStage1: 0,
      leaderStage1Cut: { byOverextended: 0, byOverheat: 0, byOther: 1 },
      leaderPreservedIntoPool: 0,
      enabled: true,
      now: NOW,
    }), appendedAt: ISO_NOW };
    const out = formatLeaderPipelineFunnelSection(row, true, true);
    expect(out).toContain('STALE');
    expect(out).toContain('(b)');
  });

  it('cacheEmpty + refresh OFF → 가설(c) 힌트 (충전 cron OFF 식별)', () => {
    const row = { ...computeLeaderPipelineFunnelObservation({
      cacheFreshness: computeLeaderCacheFreshness([], NOW),
      cacheLeaderCodeCount: 0,
      leaderCodesEnteredStage1: 0,
      leaderCodesPassedStage1: 0,
      leaderStage1Cut: { byOverextended: 0, byOverheat: 0, byOther: 0 },
      leaderPreservedIntoPool: 0,
      enabled: true,
      now: NOW,
    }), appendedAt: ISO_NOW };
    const out = formatLeaderPipelineFunnelSection(row, true, false);
    expect(out).toContain('EMPTY');
    expect(out).toContain('(c)');
    expect(out).toContain('LEADER_DAILY_REFRESH_ENABLED');
    expect(out).not.toContain('(b)');
  });
});
