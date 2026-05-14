// @responsibility Watchlist soft/hard cap + composite trim score 회귀 테스트 (ADR-0028 §모순9)
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeTrimScore,
  enforceSectionCaps,
  resolveSectionCaps,
  buildWatchlistAutoTrimAlert,
  TTL_NEAR_EXPIRY_MS,
  type WatchlistEntry,
} from './watchlistRepo.js';

const BASE_NOW = new Date('2026-04-28T00:00:00.000Z');

function entry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    code:         '005930',
    name:         '삼성전자',
    entryPrice:   70000,
    stopLoss:     63000,
    targetPrice:  84000,
    addedAt:      BASE_NOW.toISOString(),
    addedBy:      'AUTO',
    section:      'MOMENTUM',
    gateScore:    10,
    ...overrides,
  };
}

describe('computeTrimScore (composite 다축)', () => {
  it('기본 — gateScore 만 영향 (오늘 추가, 실패 0, TTL 부재, bridge 부재)', () => {
    const e = entry({ gateScore: 15, addedAt: BASE_NOW.toISOString() });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(15, 5);
  });

  it('staleness — 5일 경과 → 5.0 페널티', () => {
    const fiveDaysAgo = new Date(BASE_NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
    const e = entry({ gateScore: 15, addedAt: fiveDaysAgo.toISOString() });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(10, 5);
  });

  it('entryFailCount — 2회 실패 → 4.0 페널티', () => {
    const e = entry({ gateScore: 15, entryFailCount: 2 });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(11, 5);
  });

  it('TTL 임박 — 잔여 6h → 3.0 페널티', () => {
    const sixHoursLater = new Date(BASE_NOW.getTime() + 6 * 60 * 60 * 1000);
    const e = entry({ gateScore: 15, expiresAt: sixHoursLater.toISOString() });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(12, 5);
  });

  it('TTL 임계 정확히 12h — 페널티 미적용', () => {
    const twelveHoursLater = new Date(BASE_NOW.getTime() + TTL_NEAR_EXPIRY_MS);
    const e = entry({ gateScore: 15, expiresAt: twelveHoursLater.toISOString() });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(15, 5);
  });

  it('TTL 만료 (잔여 음수) — 페널티 미적용 (cleanup 별도 처리 영역)', () => {
    const past = new Date(BASE_NOW.getTime() - 60 * 60 * 1000);
    const e = entry({ gateScore: 15, expiresAt: past.toISOString() });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(15, 5);
  });

  it('leadershipBridge — 0.5 페널티', () => {
    const e = entry({ gateScore: 15, leadershipBridge: true });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(14.5, 5);
  });

  it('복합 — gateScore 15 + 3일 stale + 1회 실패 + TTL 임박 + bridge → 15-3-2-3-0.5=6.5', () => {
    const threeDaysAgo = new Date(BASE_NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sixHoursLater = new Date(BASE_NOW.getTime() + 6 * 60 * 60 * 1000);
    const e = entry({
      gateScore: 15,
      addedAt: threeDaysAgo.toISOString(),
      entryFailCount: 1,
      expiresAt: sixHoursLater.toISOString(),
      leadershipBridge: true,
    });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(6.5, 5);
  });

  it('NaN/Infinity gateScore → 0 fallback (안전)', () => {
    expect(computeTrimScore(entry({ gateScore: NaN }), BASE_NOW)).toBeCloseTo(0, 5);
    expect(computeTrimScore(entry({ gateScore: Infinity }), BASE_NOW)).toBeCloseTo(0, 5);
  });

  it('addedAt 부재/잘못된 ISO → staleness=0', () => {
    expect(computeTrimScore(entry({ gateScore: 10, addedAt: '' }), BASE_NOW)).toBeCloseTo(10, 5);
    expect(computeTrimScore(entry({ gateScore: 10, addedAt: 'not-a-date' }), BASE_NOW)).toBeCloseTo(10, 5);
  });

  it('미래 addedAt → staleness 음수 차단 (Math.max 보호)', () => {
    const future = new Date(BASE_NOW.getTime() + 24 * 60 * 60 * 1000);
    const e = entry({ gateScore: 10, addedAt: future.toISOString() });
    expect(computeTrimScore(e, BASE_NOW)).toBeCloseTo(10, 5);
  });
});

describe('resolveSectionCaps (env 오버라이드)', () => {
  const ENV_KEYS = [
    'WATCHLIST_SOFT_CAP_DISABLED',
    'WATCHLIST_HARD_CAP_SWING', 'WATCHLIST_HARD_CAP_CATALYST', 'WATCHLIST_HARD_CAP_MOMENTUM',
    'WATCHLIST_SOFT_CAP_SWING', 'WATCHLIST_SOFT_CAP_CATALYST', 'WATCHLIST_SOFT_CAP_MOMENTUM',
  ] as const;
  const orig: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) orig[k] = process.env[k]; });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
  });

  it('기본값 — SWING 8/6, CATALYST 5/4, MOMENTUM 50/40', () => {
    // Patch-WATCHLIST-SATURATION-COOLDOWN-001 — MOMENTUM soft cap 30 → 40.
    // 30~39 구간은 ADVISORY/용량 주의 (강제 cleanup 없음), soft cap 40 이상부터 능동 정리.
    for (const k of ENV_KEYS) delete process.env[k];
    const caps = resolveSectionCaps();
    expect(caps.hard).toEqual({ SWING: 8, CATALYST: 5, MOMENTUM: 50 });
    expect(caps.soft).toEqual({ SWING: 6, CATALYST: 4, MOMENTUM: 40 });
    expect(caps.softDisabled).toBe(false);
  });

  it('env 오버라이드 — MOMENTUM hard 25 / soft 15', () => {
    process.env.WATCHLIST_HARD_CAP_MOMENTUM = '25';
    process.env.WATCHLIST_SOFT_CAP_MOMENTUM = '15';
    const caps = resolveSectionCaps();
    expect(caps.hard.MOMENTUM).toBe(25);
    expect(caps.soft.MOMENTUM).toBe(15);
  });

  it('soft > hard 시 hard 로 클램핑', () => {
    process.env.WATCHLIST_HARD_CAP_MOMENTUM = '30';
    process.env.WATCHLIST_SOFT_CAP_MOMENTUM = '40'; // 의도적 잘못 설정
    const caps = resolveSectionCaps();
    expect(caps.soft.MOMENTUM).toBe(30); // 30 으로 클램핑
  });

  it('잘못된 env 값 → 기본값 fallback', () => {
    process.env.WATCHLIST_HARD_CAP_MOMENTUM = 'abc';
    process.env.WATCHLIST_SOFT_CAP_SWING = '-5';
    const caps = resolveSectionCaps();
    expect(caps.hard.MOMENTUM).toBe(50);
    expect(caps.soft.SWING).toBe(6);
  });

  it('WATCHLIST_SOFT_CAP_DISABLED=true → softDisabled=true', () => {
    process.env.WATCHLIST_SOFT_CAP_DISABLED = 'true';
    expect(resolveSectionCaps().softDisabled).toBe(true);
  });

  it('WATCHLIST_SOFT_CAP_DISABLED=false → softDisabled=false (true 만 인정)', () => {
    process.env.WATCHLIST_SOFT_CAP_DISABLED = 'false';
    expect(resolveSectionCaps().softDisabled).toBe(false);
  });
});

describe('enforceSectionCaps (soft 능동 정리 + hard 강제)', () => {
  const ENV_KEYS = ['WATCHLIST_SOFT_CAP_DISABLED'] as const;
  const orig: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) orig[k] = process.env[k]; });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (orig[k] === undefined) delete process.env[k];
      else process.env[k] = orig[k];
    }
  });

  function makeMomentumList(count: number, options?: { gateScores?: number[] }): WatchlistEntry[] {
    const out: WatchlistEntry[] = [];
    for (let i = 0; i < count; i += 1) {
      out.push(entry({
        code: String(i).padStart(6, '0'),
        gateScore: options?.gateScores?.[i] ?? 10 + (i % 5),
      }));
    }
    return out;
  }

  it('soft cap 미달 (MOMENTUM 35/40) → 정리 0건 — ADVISORY 구간 강제 cleanup 없음', () => {
    // Patch-WATCHLIST-SATURATION-COOLDOWN-001 — 30~39 ADVISORY 구간은 능동 정리 미발동.
    const list = makeMomentumList(35);
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.dropped.MOMENTUM).toBe(0);
    expect(r.softDropped.MOMENTUM).toBe(0);
    expect(r.hardDropped.MOMENTUM).toBe(0);
    expect(r.trimmed).toHaveLength(35);
  });

  it('soft cap 초과 + hard 미초과 (MOMENTUM 45/40/50) → soft 능동 정리 5건', () => {
    const list = makeMomentumList(45);
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.softDropped.MOMENTUM).toBe(5);
    expect(r.hardDropped.MOMENTUM).toBe(0);
    expect(r.dropped.MOMENTUM).toBe(5);
    expect(r.trimmed).toHaveLength(40);
  });

  it('hard cap 초과 (MOMENTUM 60/50) → hard 강제 정리 (soft 단계 건너뜀)', () => {
    const list = makeMomentumList(60);
    const r = enforceSectionCaps(list, BASE_NOW);
    // hard 단계가 활성: soft 는 건너뛰고 hard 만 작동
    expect(r.softDropped.MOMENTUM).toBe(0);
    expect(r.hardDropped.MOMENTUM).toBe(10);
    expect(r.trimmed).toHaveLength(50);
  });

  it('사용자 보고 시나리오 (MOMENTUM 48/40/50) → soft 능동 정리 8건 → 40개 유지', () => {
    const list = makeMomentumList(48);
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.softDropped.MOMENTUM).toBe(8);
    expect(r.hardDropped.MOMENTUM).toBe(0);
    expect(r.trimmed).toHaveLength(40);
  });

  it('composite score 하위 우선 드롭 — staleness 큰 entry 먼저 빠짐', () => {
    // 41개 — soft cap 40 → 1개 드롭. 하위 1개는 *5일 전 추가 + entryFailCount 3* (가장 낮은 score)
    const fiveDaysAgo = new Date(BASE_NOW.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const list: WatchlistEntry[] = [];
    for (let i = 0; i < 40; i += 1) {
      list.push(entry({ code: String(i).padStart(6, '0'), gateScore: 12 }));
    }
    list.push(entry({
      code: 'STALEX',
      gateScore: 12,
      addedAt: fiveDaysAgo,
      entryFailCount: 3,
    }));
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.softDropped.MOMENTUM).toBe(1);
    expect(r.trimmed.find(e => e.code === 'STALEX')).toBeUndefined();
  });

  it('출처 분포 메타 — AUTO 5건 정리 시 removedBySource.AUTO=5', () => {
    const list = makeMomentumList(45);
    // 45 중 처음 5개 (가장 낮은 점수) 가 정리 대상 (gateScore 10~14 분포)
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.removedBySource.AUTO + r.removedBySource.MANUAL + r.removedBySource.DART).toBe(5);
    expect(r.removedBySource.AUTO).toBe(5); // 모든 entry 가 AUTO
  });

  it('WATCHLIST_SOFT_CAP_DISABLED=true → soft 단계 비활성, hard 단계만 작동', () => {
    process.env.WATCHLIST_SOFT_CAP_DISABLED = 'true';
    const list = makeMomentumList(45); // hard 50 미만, soft 40 초과
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.softDropped.MOMENTUM).toBe(0);
    expect(r.hardDropped.MOMENTUM).toBe(0);
    expect(r.trimmed).toHaveLength(45); // 정리 0건 — 기존 동작 복원
  });

  it('WATCHLIST_SOFT_CAP_DISABLED=true + hard 초과 → hard 단계 *기존 단순 gateScore* 정책', () => {
    process.env.WATCHLIST_SOFT_CAP_DISABLED = 'true';
    const list = makeMomentumList(55);
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.softDropped.MOMENTUM).toBe(0);
    expect(r.hardDropped.MOMENTUM).toBe(5);
    expect(r.trimmed).toHaveLength(50);
  });

  it('SWING + CATALYST + MOMENTUM 동시 cap 초과 → 각자 정리', () => {
    const list: WatchlistEntry[] = [];
    for (let i = 0; i < 7; i += 1) list.push(entry({ section: 'SWING', code: `S${i}` }));      // soft 6 → 1 drop
    for (let i = 0; i < 5; i += 1) list.push(entry({ section: 'CATALYST', code: `C${i}` }));   // soft 4 → 1 drop
    for (let i = 0; i < 41; i += 1) list.push(entry({ section: 'MOMENTUM', code: `M${i}` }));  // soft 40 → 1 drop
    const r = enforceSectionCaps(list, BASE_NOW);
    expect(r.softDropped.SWING).toBe(1);
    expect(r.softDropped.CATALYST).toBe(1);
    expect(r.softDropped.MOMENTUM).toBe(1);
  });
});

describe('buildWatchlistAutoTrimAlert (메시지 빌더)', () => {
  function makeResult(overrides: Partial<{
    softMomentum: number; hardMomentum: number; softSwing: number;
    sourceAuto: number; sourceManual: number;
  }> = {}) {
    return {
      trimmed: [],
      dropped: { SWING: overrides.softSwing ?? 0, CATALYST: 0, MOMENTUM: (overrides.softMomentum ?? 0) + (overrides.hardMomentum ?? 0) },
      softDropped: { SWING: overrides.softSwing ?? 0, CATALYST: 0, MOMENTUM: overrides.softMomentum ?? 0 },
      hardDropped: { SWING: 0, CATALYST: 0, MOMENTUM: overrides.hardMomentum ?? 0 },
      removedBySource: { AUTO: overrides.sourceAuto ?? 0, MANUAL: overrides.sourceManual ?? 0, DART: 0 },
    };
  }

  it('soft 만 정리 (MOMENTUM 5건) → "soft -5/30" 표기 + composite score 정책 안내', () => {
    const msg = buildWatchlistAutoTrimAlert({
      result: makeResult({ softMomentum: 5, sourceAuto: 5 }),
      hard: { SWING: 8, CATALYST: 5, MOMENTUM: 50 },
      soft: { SWING: 6, CATALYST: 4, MOMENTUM: 30 },
      softDisabled: false,
    });
    expect(msg).toContain('Watchlist Auto-Trim');
    expect(msg).toContain('총 5개 (soft 5 / hard 0)');
    expect(msg).toContain('MOMENTUM: soft -5/30');
    expect(msg).toContain('AUTO 5');
    expect(msg).toContain('composite score');
  });

  it('hard 만 정리 (MOMENTUM 10건) → "hard -10/50" 표기', () => {
    const msg = buildWatchlistAutoTrimAlert({
      result: makeResult({ hardMomentum: 10, sourceAuto: 10 }),
      hard: { SWING: 8, CATALYST: 5, MOMENTUM: 50 },
      soft: { SWING: 6, CATALYST: 4, MOMENTUM: 30 },
      softDisabled: false,
    });
    expect(msg).toContain('총 10개 (soft 0 / hard 10)');
    expect(msg).toContain('MOMENTUM: hard -10/50');
  });

  it('soft + hard 혼재 (다중 섹션) → 두 줄 표기', () => {
    const msg = buildWatchlistAutoTrimAlert({
      result: makeResult({ softSwing: 1, softMomentum: 5, hardMomentum: 8, sourceAuto: 14 }),
      hard: { SWING: 8, CATALYST: 5, MOMENTUM: 50 },
      soft: { SWING: 6, CATALYST: 4, MOMENTUM: 30 },
      softDisabled: false,
    });
    expect(msg).toContain('SWING: soft -1/6');
    expect(msg).toContain('MOMENTUM: soft -5/30, hard -8/50');
  });

  it('softDisabled=true → 정책 안내가 *기존 gateScore 정책* 으로 분기', () => {
    const msg = buildWatchlistAutoTrimAlert({
      result: makeResult({ hardMomentum: 5, sourceAuto: 5 }),
      hard: { SWING: 8, CATALYST: 5, MOMENTUM: 50 },
      soft: { SWING: 6, CATALYST: 4, MOMENTUM: 30 },
      softDisabled: true,
    });
    expect(msg).toContain('soft cap 비활성');
    expect(msg).not.toContain('composite score');
  });

  it('출처 분포 부재 → "출처 분포:" 라인 생략', () => {
    const msg = buildWatchlistAutoTrimAlert({
      result: makeResult({ softMomentum: 1 }),
      hard: { SWING: 8, CATALYST: 5, MOMENTUM: 50 },
      soft: { SWING: 6, CATALYST: 4, MOMENTUM: 30 },
      softDisabled: false,
    });
    expect(msg).not.toContain('출처 분포:');
  });
});

// Patch-WATCHLIST-SATURATION-COOLDOWN-001 — `buildWatchlistOverflowAlert` 는
// `watchlistSaturationPolicy` SSOT (severity 분류 + cooldown 상태머신)로 이관.
// 회귀 테스트는 `watchlistSaturationPolicy.test.ts` 참조.
