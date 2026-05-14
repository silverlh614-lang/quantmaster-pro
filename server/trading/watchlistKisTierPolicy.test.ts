/**
 * @responsibility ADR-0516 — Watchlist Tier-based KIS REST 정책 SSOT 회귀 테스트
 *
 * resolveWatchlistKisPolicy 결정 트리 + assignMomentumRanks 정렬 SSOT +
 * resolveKisLoadStateFromEnv ENV 도출 + KIS_LOAD_STATE GREEN/YELLOW/RED 분기.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveWatchlistKisPolicy,
  resolveKisLoadStateFromEnv,
  assignMomentumRanks,
  MOMENTUM_ACTIVE_RANK_LIMIT_GREEN,
  MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW,
  type MomentumRankableEntry,
} from './watchlistKisTierPolicy.js';

const ORIGINAL_ENV = process.env.KIS_LOAD_STATE;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.KIS_LOAD_STATE;
  else process.env.KIS_LOAD_STATE = ORIGINAL_ENV;
});

describe('resolveKisLoadStateFromEnv', () => {
  it('미설정 시 GREEN', () => {
    delete process.env.KIS_LOAD_STATE;
    expect(resolveKisLoadStateFromEnv()).toBe('GREEN');
  });

  it('YELLOW 정확 매칭 (대소문자 무관)', () => {
    process.env.KIS_LOAD_STATE = 'yellow';
    expect(resolveKisLoadStateFromEnv()).toBe('YELLOW');
  });

  it('RED 정확 매칭', () => {
    process.env.KIS_LOAD_STATE = 'RED';
    expect(resolveKisLoadStateFromEnv()).toBe('RED');
  });

  it('미상 값은 GREEN fallback', () => {
    process.env.KIS_LOAD_STATE = 'ORANGE';
    expect(resolveKisLoadStateFromEnv()).toBe('GREEN');
  });
});

describe('resolveWatchlistKisPolicy — OPEN_POSITION 보호 (P0)', () => {
  it('isOpenPosition 시 OPEN_POSITION + REST 허용 (KIS 부하 무관)', () => {
    for (const loadState of ['GREEN', 'YELLOW', 'RED'] as const) {
      const policy = resolveWatchlistKisPolicy({
        section: 'MOMENTUM',
        momentumRank: 999,
        isOpenPosition: true,
        kisLoadState: loadState,
      });
      expect(policy.tier).toBe('OPEN_POSITION');
      expect(policy.allowRestPrice).toBe(true);
      expect(policy.priceTtlMs).toBe(5_000);
    }
  });

  it('OPEN_POSITION 은 force buy / section 보다 우선', () => {
    const policy = resolveWatchlistKisPolicy({
      section: 'MOMENTUM',
      isOpenPosition: true,
      isForceBuy: true,
      kisLoadState: 'RED',
    });
    expect(policy.tier).toBe('OPEN_POSITION');
    expect(policy.allowRestPrice).toBe(true);
  });
});

describe('resolveWatchlistKisPolicy — force buy 보호 (P0)', () => {
  it('isForceBuy 시 ENTRY_CANDIDATE + REST 허용 (MOMENTUM 섹션이라도)', () => {
    const policy = resolveWatchlistKisPolicy({
      section: 'MOMENTUM',
      momentumRank: 999,
      isForceBuy: true,
      kisLoadState: 'RED',
    });
    expect(policy.tier).toBe('ENTRY_CANDIDATE');
    expect(policy.allowRestPrice).toBe(true);
    expect(policy.reason).toBe('force-buy');
  });
});

describe('resolveWatchlistKisPolicy — SWING', () => {
  it('GREEN 시 ENTRY_CANDIDATE + REST 허용', () => {
    const policy = resolveWatchlistKisPolicy({ section: 'SWING', kisLoadState: 'GREEN' });
    expect(policy.tier).toBe('ENTRY_CANDIDATE');
    expect(policy.allowRestPrice).toBe(true);
    expect(policy.priceTtlMs).toBe(15_000);
  });

  it('YELLOW 시 ENTRY_CANDIDATE + REST 허용 (YELLOW 는 SWING 무영향)', () => {
    const policy = resolveWatchlistKisPolicy({ section: 'SWING', kisLoadState: 'YELLOW' });
    expect(policy.tier).toBe('ENTRY_CANDIDATE');
    expect(policy.allowRestPrice).toBe(true);
  });

  it('RED 시 ENTRY_CANDIDATE + REST 차단 (WS/cache 우선)', () => {
    const policy = resolveWatchlistKisPolicy({ section: 'SWING', kisLoadState: 'RED' });
    expect(policy.tier).toBe('ENTRY_CANDIDATE');
    expect(policy.allowRestPrice).toBe(false);
    expect(policy.reason).toContain('load-red');
  });
});

describe('resolveWatchlistKisPolicy — CATALYST', () => {
  it('GREEN 시 CATALYST_ACTIVE + REST 허용', () => {
    const policy = resolveWatchlistKisPolicy({ section: 'CATALYST', kisLoadState: 'GREEN' });
    expect(policy.tier).toBe('CATALYST_ACTIVE');
    expect(policy.allowRestPrice).toBe(true);
    expect(policy.priceTtlMs).toBe(30_000);
  });

  it('RED 시에도 CATALYST_ACTIVE + REST 허용 (catalyst 이벤트 우선)', () => {
    const policy = resolveWatchlistKisPolicy({ section: 'CATALYST', kisLoadState: 'RED' });
    expect(policy.tier).toBe('CATALYST_ACTIVE');
    expect(policy.allowRestPrice).toBe(true);
  });
});

describe('resolveWatchlistKisPolicy — MOMENTUM rank 분기', () => {
  it('GREEN: rank ≤ 정원 → MOMENTUM_ACTIVE + REST 허용', () => {
    const policy = resolveWatchlistKisPolicy({
      section: 'MOMENTUM',
      momentumRank: 1,
      kisLoadState: 'GREEN',
    });
    expect(policy.tier).toBe('MOMENTUM_ACTIVE');
    expect(policy.allowRestPrice).toBe(true);
    expect(policy.priceTtlMs).toBe(90_000);
  });

  it('GREEN: rank = 정원 경계값 → MOMENTUM_ACTIVE', () => {
    const policy = resolveWatchlistKisPolicy({
      section: 'MOMENTUM',
      momentumRank: MOMENTUM_ACTIVE_RANK_LIMIT_GREEN,
      kisLoadState: 'GREEN',
    });
    expect(policy.tier).toBe('MOMENTUM_ACTIVE');
  });

  it('GREEN: rank > 정원 → MOMENTUM_PASSIVE + REST 차단', () => {
    const policy = resolveWatchlistKisPolicy({
      section: 'MOMENTUM',
      momentumRank: MOMENTUM_ACTIVE_RANK_LIMIT_GREEN + 1,
      kisLoadState: 'GREEN',
    });
    expect(policy.tier).toBe('MOMENTUM_PASSIVE');
    expect(policy.allowRestPrice).toBe(false);
    expect(policy.priceTtlMs).toBe(180_000);
  });

  it('rank 미상(no-rank) → MOMENTUM_PASSIVE + REST 차단', () => {
    const policy = resolveWatchlistKisPolicy({ section: 'MOMENTUM', kisLoadState: 'GREEN' });
    expect(policy.tier).toBe('MOMENTUM_PASSIVE');
    expect(policy.allowRestPrice).toBe(false);
    expect(policy.reason).toBe('momentum:no-rank:passive');
  });

  it('YELLOW: 정원 축소 — GREEN 에서 ACTIVE 이던 rank 가 YELLOW 에선 PASSIVE', () => {
    const rank = MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW + 1;
    const green = resolveWatchlistKisPolicy({ section: 'MOMENTUM', momentumRank: rank, kisLoadState: 'GREEN' });
    const yellow = resolveWatchlistKisPolicy({ section: 'MOMENTUM', momentumRank: rank, kisLoadState: 'YELLOW' });
    expect(green.tier).toBe('MOMENTUM_ACTIVE');
    expect(yellow.tier).toBe('MOMENTUM_PASSIVE');
    expect(yellow.allowRestPrice).toBe(false);
  });

  it('YELLOW: rank ≤ YELLOW 정원 → 여전히 MOMENTUM_ACTIVE', () => {
    const policy = resolveWatchlistKisPolicy({
      section: 'MOMENTUM',
      momentumRank: MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW,
      kisLoadState: 'YELLOW',
    });
    expect(policy.tier).toBe('MOMENTUM_ACTIVE');
    expect(policy.allowRestPrice).toBe(true);
  });

  it('RED: rank 1 이라도 MOMENTUM_PASSIVE + REST 차단 (모든 MOMENTUM REST 금지)', () => {
    const policy = resolveWatchlistKisPolicy({
      section: 'MOMENTUM',
      momentumRank: 1,
      kisLoadState: 'RED',
    });
    expect(policy.tier).toBe('MOMENTUM_PASSIVE');
    expect(policy.allowRestPrice).toBe(false);
    expect(policy.reason).toBe('momentum:load-red:no-rest');
  });
});

describe('resolveWatchlistKisPolicy — section 미상 fallback', () => {
  it('section undefined → ENTRY_CANDIDATE + REST 허용 (기존 동작 보존)', () => {
    const policy = resolveWatchlistKisPolicy({});
    expect(policy.tier).toBe('ENTRY_CANDIDATE');
    expect(policy.allowRestPrice).toBe(true);
    expect(policy.reason).toBe('section-unknown:default');
  });

  it('kisLoadState 미전달 시 ENV 에서 도출', () => {
    process.env.KIS_LOAD_STATE = 'RED';
    const policy = resolveWatchlistKisPolicy({ section: 'MOMENTUM', momentumRank: 1 });
    expect(policy.tier).toBe('MOMENTUM_PASSIVE');
    expect(policy.allowRestPrice).toBe(false);
  });
});

describe('assignMomentumRanks — 정렬 SSOT', () => {
  it('stage2Score 내림차순 우선', () => {
    const list: MomentumRankableEntry[] = [
      { code: '000001', stage2Score: 50 },
      { code: '000002', stage2Score: 90 },
      { code: '000003', stage2Score: 70 },
    ];
    assignMomentumRanks(list);
    expect((list[0] as { momentumRank?: number }).momentumRank).toBe(3); // 50 → 3위
    expect((list[1] as { momentumRank?: number }).momentumRank).toBe(1); // 90 → 1위
    expect((list[2] as { momentumRank?: number }).momentumRank).toBe(2); // 70 → 2위
  });

  it('stage2Score 부재 시 gateScore 사용', () => {
    const list: MomentumRankableEntry[] = [
      { code: '000001', gateScore: 5 },
      { code: '000002', gateScore: 12 },
    ];
    assignMomentumRanks(list);
    expect((list[0] as { momentumRank?: number }).momentumRank).toBe(2);
    expect((list[1] as { momentumRank?: number }).momentumRank).toBe(1);
  });

  it('tie → addedAt 최신 우선', () => {
    const list: MomentumRankableEntry[] = [
      { code: '000001', stage2Score: 80, addedAt: '2026-05-10T00:00:00.000Z' },
      { code: '000002', stage2Score: 80, addedAt: '2026-05-14T00:00:00.000Z' },
    ];
    assignMomentumRanks(list);
    expect((list[0] as { momentumRank?: number }).momentumRank).toBe(2); // 오래된 것 → 2위
    expect((list[1] as { momentumRank?: number }).momentumRank).toBe(1); // 최신 → 1위
  });

  it('final tie (score + addedAt 동일) → code 오름차순 deterministic', () => {
    const list: MomentumRankableEntry[] = [
      { code: '000009', stage2Score: 80, addedAt: '2026-05-10T00:00:00.000Z' },
      { code: '000001', stage2Score: 80, addedAt: '2026-05-10T00:00:00.000Z' },
    ];
    assignMomentumRanks(list);
    expect((list[0] as { momentumRank?: number }).momentumRank).toBe(2); // 000009 → 2위
    expect((list[1] as { momentumRank?: number }).momentumRank).toBe(1); // 000001 → 1위
  });

  it('빈 배열 안전', () => {
    expect(() => assignMomentumRanks([])).not.toThrow();
  });

  it('rank 부여 후 resolveWatchlistKisPolicy 와 정합 — 상위 N개만 ACTIVE', () => {
    const list: MomentumRankableEntry[] = Array.from({ length: 30 }, (_, i) => ({
      code: String(i).padStart(6, '0'),
      stage2Score: 100 - i, // 내림차순
    }));
    assignMomentumRanks(list);
    let activeCount = 0;
    for (const entry of list) {
      const policy = resolveWatchlistKisPolicy({
        section: 'MOMENTUM',
        momentumRank: (entry as { momentumRank?: number }).momentumRank,
        kisLoadState: 'GREEN',
      });
      if (policy.tier === 'MOMENTUM_ACTIVE') activeCount += 1;
    }
    expect(activeCount).toBe(MOMENTUM_ACTIVE_RANK_LIMIT_GREEN);
  });
});

describe('상수 SSOT 정합', () => {
  it('GREEN 정원 ≥ YELLOW 정원 (YELLOW 는 축소)', () => {
    expect(MOMENTUM_ACTIVE_RANK_LIMIT_GREEN).toBeGreaterThanOrEqual(MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW);
  });

  it('정원 값은 1 이상 50 이하', () => {
    expect(MOMENTUM_ACTIVE_RANK_LIMIT_GREEN).toBeGreaterThanOrEqual(1);
    expect(MOMENTUM_ACTIVE_RANK_LIMIT_GREEN).toBeLessThanOrEqual(50);
    expect(MOMENTUM_ACTIVE_RANK_LIMIT_YELLOW).toBeGreaterThanOrEqual(1);
  });
});

// beforeEach 불필요 — 각 it 가 kisLoadState 를 명시 전달하거나 ENV 를 직접 설정.
beforeEach(() => {
  delete process.env.KIS_LOAD_STATE;
});
