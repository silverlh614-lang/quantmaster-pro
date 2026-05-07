/**
 * @responsibility ADR-0441 KIS Stream Bulk Apply Priority Wiring 회귀 테스트.
 *
 * 사용자 명시 25+ 케이스:
 *   - ENV gate 4 (default OFF / 'true' / '1' 거부 / 'TRUE' 거부)
 *   - KIS_STREAM_GATE_THRESHOLDS SSOT 정합 2 (ENTRY_CANDIDATE=7.0 / WATCHLIST=4.0 + Object.freeze)
 *   - buildKisStreamSubscriptionCandidates 8 (보유 종목 OPEN_POSITION priority 1000 / gateScore 9 → ENTRY_CANDIDATE 800
 *     / gateScore 5 → WATCHLIST 500 / gateScore 2 → OBSERVE_ONLY 300 / 보유+watchlist 중복 dedup
 *     / invalid code 제외 / 정렬 deterministic / lastUpdatedAt 정합)
 *   - selectKisStreamSubscribableCodes 5 (legacy fallback ENV / 30개 상한 절삭 / 보유 우선 정렬
 *     / 동률 정렬 / 빈 watchlist)
 *   - deriveOpenPositionCodes 3 (active shadow / closed 제외 / remainingQty=0 제외)
 *   - 4 callsites 정적 grep 가드 9 (kisStreamJobs 3 + reconnectWs.cmd 1 SSOT 위임 / `gateScore desc`
 *     직접 sort 부재 / `selectSubscribableCodes` legacy 본체 부재 / KIS 주문 함수 import 0
 *     / autoTradeEngine import 0 / fetch axios 0 / ADR-0437 매트릭스 import 정합)
 *   - 통합 시나리오 3 (보유 5 + 워치리스트 50개 → 30 상한 + 보유 우선 + ENTRY_CANDIDATE 우선 + OBSERVE_ONLY 절삭)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// kisStreamClient mock — kisWebSocketSubscriptionManager 가 import 하므로 stub 의무
vi.mock('./kisStreamClient.js', () => ({
  MAX_SUBSCRIPTIONS: 30,
  subscribeStock: vi.fn(() => true),
  unsubscribeStock: vi.fn(),
}));

// shadowTradeRepo mock — deriveOpenPositionCodes 의 dynamic import 대상
const _mockTrades: Array<{
  id: string;
  stockCode: string;
  status: string;
  fills: Array<{ type: 'BUY' | 'SELL'; qty: number; reverted?: boolean }>;
  quantity: number;
}> = [];
vi.mock('../persistence/shadowTradeRepo.js', () => ({
  loadShadowTrades: vi.fn(() => _mockTrades),
  getRemainingQty: vi.fn((trade: { fills: Array<{ type: 'BUY' | 'SELL'; qty: number; reverted?: boolean }>; quantity: number }) => {
    const fills = (trade.fills ?? []).filter((f) => !f.reverted);
    const buyQty = fills.filter((f) => f.type === 'BUY').reduce((s, f) => s + f.qty, 0);
    const sellQty = fills.filter((f) => f.type === 'SELL').reduce((s, f) => s + f.qty, 0);
    if (buyQty > 0) return Math.max(0, buyQty - sellQty);
    return trade.quantity ?? 0;
  }),
}));

import {
  KIS_STREAM_GATE_THRESHOLDS,
  isKisStreamPriorityBuilderDisabled,
  buildKisStreamSubscriptionCandidates,
  selectKisStreamSubscribableCodes,
  deriveOpenPositionCodes,
} from './kisStreamCandidateBuilder.js';
import { SUBSCRIPTION_PRIORITY_TABLE } from './kisWebSocketSubscriptionManager.js';
import type { WatchlistEntry } from '../persistence/watchlistRepo.js';

const KIS_STREAM_JOBS_PATH = resolve(__dirname, '../scheduler/kisStreamJobs.ts');
const KIS_STREAM_JOBS_SRC = readFileSync(KIS_STREAM_JOBS_PATH, 'utf-8');

const RECONNECT_WS_PATH = resolve(__dirname, '../telegram/commands/infra/reconnectWs.cmd.ts');
const RECONNECT_WS_SRC = readFileSync(RECONNECT_WS_PATH, 'utf-8');

const BUILDER_PATH = resolve(__dirname, 'kisStreamCandidateBuilder.ts');
const BUILDER_SRC = readFileSync(BUILDER_PATH, 'utf-8');

afterEach(() => {
  vi.unstubAllEnvs();
  _mockTrades.length = 0;
});

beforeEach(() => {
  _mockTrades.length = 0;
});

function makeWatchlistEntry(
  partial: Partial<WatchlistEntry> & { code: string; gateScore?: number },
): WatchlistEntry {
  return {
    code: partial.code,
    name: partial.name ?? `Stock ${partial.code}`,
    entryPrice: partial.entryPrice ?? 10000,
    stopLoss: partial.stopLoss ?? 9000,
    targetPrice: partial.targetPrice ?? 11000,
    addedAt: partial.addedAt ?? '2026-05-07T00:00:00.000Z',
    gateScore: partial.gateScore,
    addedBy: partial.addedBy ?? 'AUTO',
  } as WatchlistEntry;
}

// ── ENV gate (default OFF / ADR-0157 정확 비교) ─────────────────────────────

describe('ADR-0441 — ENV gate (default OFF / ADR-0157 정확 비교)', () => {
  it('default OFF (ENV 미설정)', () => {
    expect(isKisStreamPriorityBuilderDisabled()).toBe(false);
  });

  it('"true" 정확 매칭 시 disabled', () => {
    vi.stubEnv('KIS_STREAM_PRIORITY_BUILDER_DISABLED', 'true');
    expect(isKisStreamPriorityBuilderDisabled()).toBe(true);
  });

  it('"1" 거부 (ADR-0157 정확 비교)', () => {
    vi.stubEnv('KIS_STREAM_PRIORITY_BUILDER_DISABLED', '1');
    expect(isKisStreamPriorityBuilderDisabled()).toBe(false);
  });

  it('"TRUE" 거부 (대소문자 일치 의무)', () => {
    vi.stubEnv('KIS_STREAM_PRIORITY_BUILDER_DISABLED', 'TRUE');
    expect(isKisStreamPriorityBuilderDisabled()).toBe(false);
  });
});

// ── KIS_STREAM_GATE_THRESHOLDS SSOT ─────────────────────────────────────────

describe('ADR-0441 — KIS_STREAM_GATE_THRESHOLDS SSOT 정합', () => {
  it('ENTRY_CANDIDATE = 7.0 / WATCHLIST = 4.0 (사용자 명시 임계 절대 변경 금지)', () => {
    expect(KIS_STREAM_GATE_THRESHOLDS.ENTRY_CANDIDATE).toBe(7.0);
    expect(KIS_STREAM_GATE_THRESHOLDS.WATCHLIST).toBe(4.0);
  });

  it('Object.freeze drift 가드 (호출자 mutate 차단)', () => {
    expect(Object.isFrozen(KIS_STREAM_GATE_THRESHOLDS)).toBe(true);
  });
});

// ── buildKisStreamSubscriptionCandidates ─────────────────────────────────────

describe('ADR-0441 — buildKisStreamSubscriptionCandidates', () => {
  it('보유 종목 → OPEN_POSITION priority 1000 (절대 우선)', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [],
      openPositionCodes: new Set(['005930']),
      now: 1000,
    });
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('005930');
    expect(result[0].priority).toBe(SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION);
    expect(result[0].priority).toBe(1000);
    expect(result[0].reasons).toContain('OPEN_POSITION');
    expect(result[0].openPosition).toBe(true);
  });

  it('gateScore 9 → ENTRY_CANDIDATE priority 800', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [makeWatchlistEntry({ code: '000660', gateScore: 9 })],
      openPositionCodes: new Set(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe(SUBSCRIPTION_PRIORITY_TABLE.ENTRY_CANDIDATE);
    expect(result[0].priority).toBe(800);
    expect(result[0].reasons).toContain('ENTRY_CANDIDATE');
    expect(result[0].entryCandidate).toBe(true);
  });

  it('gateScore 5 → WATCHLIST priority 500', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [makeWatchlistEntry({ code: '035420', gateScore: 5 })],
      openPositionCodes: new Set(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe(SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST);
    expect(result[0].priority).toBe(500);
    expect(result[0].reasons).toContain('WATCHLIST');
    expect(result[0].entryCandidate).toBe(false);
  });

  it('gateScore 2 → OBSERVE_ONLY priority 300', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [makeWatchlistEntry({ code: '247540', gateScore: 2 })],
      openPositionCodes: new Set(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe(SUBSCRIPTION_PRIORITY_TABLE.OBSERVE_ONLY);
    expect(result[0].priority).toBe(300);
    expect(result[0].reasons).toContain('OBSERVE_ONLY');
  });

  it('gateScore 부재 (undefined) → OBSERVE_ONLY priority 300 (default 0 fallback)', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [makeWatchlistEntry({ code: '003490', gateScore: undefined })],
      openPositionCodes: new Set(),
    });
    expect(result[0].priority).toBe(300);
    expect(result[0].reasons).toContain('OBSERVE_ONLY');
  });

  it('보유+watchlist 중복 시 보유 우선 (dedup)', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [makeWatchlistEntry({ code: '005930', gateScore: 9 })],
      openPositionCodes: new Set(['005930']),
    });
    // 같은 code 는 한 번만 등장, OPEN_POSITION 우선
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe(SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION);
    expect(result[0].reasons).toContain('OPEN_POSITION');
  });

  it('invalid code 제외 (ADR-0438 normalizeKrxCodeForWs SSOT)', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [
        makeWatchlistEntry({ code: '005930', gateScore: 9 }),
        makeWatchlistEntry({ code: 'XXXXXX', gateScore: 9 }), // invalid (alpha)
        makeWatchlistEntry({ code: '0011TO', gateScore: 9 }), // invalid (mixed)
        makeWatchlistEntry({ code: '12345', gateScore: 9 }),  // invalid (5자리)
      ],
      openPositionCodes: new Set(['INVALID', '008060']), // INVALID skip, 008060 keep
    });
    const codes = result.map((c) => c.code);
    expect(codes).toContain('005930');
    expect(codes).toContain('008060');
    expect(codes).not.toContain('XXXXXX');
    expect(codes).not.toContain('0011TO');
    expect(codes).not.toContain('12345');
    expect(codes).not.toContain('INVALID');
  });

  it('정렬 deterministic (priority desc → code asc)', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [
        makeWatchlistEntry({ code: '247540', gateScore: 2 }),
        makeWatchlistEntry({ code: '035420', gateScore: 5 }),
        makeWatchlistEntry({ code: '000660', gateScore: 9 }),
      ],
      openPositionCodes: new Set(['005930']),
    });
    expect(result.map((c) => c.code)).toEqual(['005930', '000660', '035420', '247540']);
    expect(result.map((c) => c.priority)).toEqual([1000, 800, 500, 300]);
  });

  it('lastUpdatedAt 정합 (now 주입)', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [makeWatchlistEntry({ code: '005930', gateScore: 9 })],
      openPositionCodes: new Set(['000660']),
      now: 12345,
    });
    expect(result.every((c) => c.lastUpdatedAt === 12345)).toBe(true);
  });

  it('.KS suffix 정상 normalize (ADR-0438)', () => {
    const result = buildKisStreamSubscriptionCandidates({
      watchlist: [makeWatchlistEntry({ code: '005930.KS', gateScore: 9 })],
      openPositionCodes: new Set(),
    });
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('005930');
  });
});

// ── selectKisStreamSubscribableCodes ─────────────────────────────────────────

describe('ADR-0441 — selectKisStreamSubscribableCodes', () => {
  it('legacy fallback ENV 활성 시 gateScore desc 단순 정렬', () => {
    vi.stubEnv('KIS_STREAM_PRIORITY_BUILDER_DISABLED', 'true');
    const codes = selectKisStreamSubscribableCodes(
      [
        makeWatchlistEntry({ code: '000010', gateScore: 1 }),
        makeWatchlistEntry({ code: '000020', gateScore: 9 }),
        makeWatchlistEntry({ code: '000030', gateScore: 5 }),
      ],
      new Set(['005930']), // legacy 모드는 보유 종목 무시 (단순 정렬)
      30,
    );
    // legacy: gateScore desc → 9 / 5 / 1
    expect(codes).toEqual(['000020', '000030', '000010']);
    // 보유 종목 005930 미포함 (legacy fallback 단순 정렬)
    expect(codes).not.toContain('005930');
  });

  it('30개 상한 절삭 (maxSubscriptions = 30)', () => {
    const watchlist: WatchlistEntry[] = [];
    for (let i = 0; i < 50; i++) {
      watchlist.push(makeWatchlistEntry({
        code: String(i + 100000).padStart(6, '0'),
        gateScore: i,
      }));
    }
    const codes = selectKisStreamSubscribableCodes(watchlist, new Set(), 30);
    expect(codes).toHaveLength(30);
  });

  it('보유 종목 우선 — 보유 5개 + watchlist 50개에서 보유 5개 모두 top-30 안에 포함', () => {
    const openPositions = new Set(['100001', '100002', '100003', '100004', '100005']);
    const watchlist: WatchlistEntry[] = [];
    for (let i = 0; i < 50; i++) {
      watchlist.push(makeWatchlistEntry({
        code: String(200000 + i).padStart(6, '0'),
        gateScore: 9, // 모두 ENTRY_CANDIDATE 임계
      }));
    }
    const codes = selectKisStreamSubscribableCodes(watchlist, openPositions, 30);
    expect(codes).toHaveLength(30);
    // 보유 종목 5개 모두 top-30 안 (priority 1000 가 800 보다 우선)
    for (const owned of openPositions) {
      expect(codes).toContain(owned);
    }
    // 보유 5개가 codes 의 처음 5개 (priority 정렬)
    expect(codes.slice(0, 5).sort()).toEqual(['100001', '100002', '100003', '100004', '100005']);
  });

  it('동률 정렬 — code asc deterministic', () => {
    const codes = selectKisStreamSubscribableCodes(
      [
        makeWatchlistEntry({ code: '000020', gateScore: 5 }),
        makeWatchlistEntry({ code: '000010', gateScore: 5 }),
        makeWatchlistEntry({ code: '000030', gateScore: 5 }),
      ],
      new Set(),
      30,
    );
    // 모두 priority 500 동률, 같은 lastUpdatedAt → code asc
    expect(codes).toEqual(['000010', '000020', '000030']);
  });

  it('빈 watchlist + 빈 보유 → 빈 배열', () => {
    const codes = selectKisStreamSubscribableCodes([], new Set(), 30);
    expect(codes).toEqual([]);
  });
});

// ── deriveOpenPositionCodes ──────────────────────────────────────────────────

describe('ADR-0441 — deriveOpenPositionCodes', () => {
  it('active shadow trade (PENDING / ACTIVE / ORDER_SUBMITTED / PARTIALLY_FILLED / EUPHORIA_PARTIAL) 만 추출', async () => {
    _mockTrades.push(
      { id: 't1', stockCode: '005930', status: 'PENDING', fills: [], quantity: 10 },
      { id: 't2', stockCode: '000660', status: 'ACTIVE', fills: [{ type: 'BUY', qty: 5 }], quantity: 5 },
      { id: 't3', stockCode: '035420', status: 'ORDER_SUBMITTED', fills: [], quantity: 3 },
      { id: 't4', stockCode: '247540', status: 'PARTIALLY_FILLED', fills: [{ type: 'BUY', qty: 2 }], quantity: 2 },
      { id: 't5', stockCode: '003490', status: 'EUPHORIA_PARTIAL', fills: [{ type: 'BUY', qty: 8 }], quantity: 8 },
    );
    const codes = await deriveOpenPositionCodes();
    expect(codes.has('005930')).toBe(true);
    expect(codes.has('000660')).toBe(true);
    expect(codes.has('035420')).toBe(true);
    expect(codes.has('247540')).toBe(true);
    expect(codes.has('003490')).toBe(true);
    expect(codes.size).toBe(5);
  });

  it('closed status (HIT_TARGET / HIT_STOP / REVERTED) 제외', async () => {
    _mockTrades.push(
      { id: 't1', stockCode: '005930', status: 'PENDING', fills: [], quantity: 10 },
      { id: 't2', stockCode: '000660', status: 'HIT_TARGET', fills: [{ type: 'BUY', qty: 5 }, { type: 'SELL', qty: 5 }], quantity: 5 },
      { id: 't3', stockCode: '035420', status: 'HIT_STOP', fills: [{ type: 'BUY', qty: 3 }, { type: 'SELL', qty: 3 }], quantity: 3 },
      { id: 't4', stockCode: '247540', status: 'REVERTED', fills: [], quantity: 0 },
    );
    const codes = await deriveOpenPositionCodes();
    expect(codes.has('005930')).toBe(true);
    expect(codes.has('000660')).toBe(false);
    expect(codes.has('035420')).toBe(false);
    expect(codes.has('247540')).toBe(false);
    expect(codes.size).toBe(1);
  });

  it('remainingQty=0 (전부 매도된 ACTIVE) 제외', async () => {
    _mockTrades.push(
      { id: 't1', stockCode: '005930', status: 'ACTIVE', fills: [{ type: 'BUY', qty: 10 }, { type: 'SELL', qty: 10 }], quantity: 10 },
      { id: 't2', stockCode: '000660', status: 'ACTIVE', fills: [{ type: 'BUY', qty: 5 }, { type: 'SELL', qty: 2 }], quantity: 5 }, // remaining 3
    );
    const codes = await deriveOpenPositionCodes();
    expect(codes.has('005930')).toBe(false); // remaining = 0
    expect(codes.has('000660')).toBe(true);  // remaining = 3
    expect(codes.size).toBe(1);
  });

  it('영속 read 실패 시 빈 Set fallback (try/catch 격리)', async () => {
    // mock 의 loadShadowTrades 가 throw 하도록 일시 override
    const repoModule = await import('../persistence/shadowTradeRepo.js');
    const originalLoad = repoModule.loadShadowTrades;
    (repoModule as { loadShadowTrades: () => unknown }).loadShadowTrades = () => {
      throw new Error('영속 손상');
    };
    try {
      const codes = await deriveOpenPositionCodes();
      expect(codes.size).toBe(0); // 빈 Set fallback
    } finally {
      (repoModule as { loadShadowTrades: () => unknown }).loadShadowTrades = originalLoad;
    }
  });

  it('invalid stockCode 자동 제외 (ADR-0438)', async () => {
    _mockTrades.push(
      { id: 't1', stockCode: '005930', status: 'ACTIVE', fills: [{ type: 'BUY', qty: 5 }], quantity: 5 },
      { id: 't2', stockCode: 'XXXXXX', status: 'ACTIVE', fills: [{ type: 'BUY', qty: 5 }], quantity: 5 }, // invalid
    );
    const codes = await deriveOpenPositionCodes();
    expect(codes.has('005930')).toBe(true);
    expect(codes.has('XXXXXX')).toBe(false);
    expect(codes.size).toBe(1);
  });
});

// ── 4 callsites 정적 grep 가드 ──────────────────────────────────────────────

describe('ADR-0441 — 4 callsites 정적 grep 가드', () => {
  it('kisStreamJobs.ts: selectKisStreamSubscribableCodes 호출 정합 (3 callsites)', () => {
    // SSOT import
    expect(KIS_STREAM_JOBS_SRC).toMatch(
      /from ['"]\.\.\/clients\/kisStreamCandidateBuilder\.js['"]/,
    );
    expect(KIS_STREAM_JOBS_SRC).toContain('selectKisStreamSubscribableCodes');
    expect(KIS_STREAM_JOBS_SRC).toContain('deriveOpenPositionCodes');
    // 3 callsites
    const callMatches = KIS_STREAM_JOBS_SRC.match(/selectKisStreamSubscribableCodes\(/g) ?? [];
    expect(callMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('kisStreamJobs.ts: legacy `selectSubscribableCodes` 본체 영구 제거', () => {
    // 함수 정의 패턴 부재 (`function selectSubscribableCodes` 또는 `const selectSubscribableCodes =`)
    expect(KIS_STREAM_JOBS_SRC).not.toMatch(
      /function\s+selectSubscribableCodes\s*\(/,
    );
    expect(KIS_STREAM_JOBS_SRC).not.toMatch(
      /const\s+selectSubscribableCodes\s*=/,
    );
  });

  it('kisStreamJobs.ts: `gateScore desc` 단순 정렬 직접 사용 0건', () => {
    // (b.gateScore ?? 0) - (a.gateScore ?? 0) 패턴 부재
    expect(KIS_STREAM_JOBS_SRC).not.toMatch(
      /\(b\.gateScore\s*\?\?\s*0\)\s*-\s*\(a\.gateScore\s*\?\?\s*0\)/,
    );
  });

  it('reconnectWs.cmd.ts: selectKisStreamSubscribableCodes 위임', () => {
    expect(RECONNECT_WS_SRC).toMatch(
      /from ['"]\.\.\/\.\.\/\.\.\/clients\/kisStreamCandidateBuilder\.js['"]/,
    );
    expect(RECONNECT_WS_SRC).toContain('selectKisStreamSubscribableCodes');
    expect(RECONNECT_WS_SRC).toContain('deriveOpenPositionCodes');
  });

  it('reconnectWs.cmd.ts: `gateScore desc` 단순 정렬 직접 사용 0건', () => {
    expect(RECONNECT_WS_SRC).not.toMatch(
      /\(b\.gateScore\s*\?\?\s*0\)\s*-\s*\(a\.gateScore\s*\?\?\s*0\)/,
    );
  });

  it('builder: KIS 주문 함수 5종 import 0건 (절대 규칙 #2 정합)', () => {
    expect(BUILDER_SRC).not.toMatch(/placeKisMarketBuyOrder/);
    expect(BUILDER_SRC).not.toMatch(/placeKisSellOrder/);
    expect(BUILDER_SRC).not.toMatch(/placeKisStopLossOrder/);
    expect(BUILDER_SRC).not.toMatch(/placeKisTakeProfitOrder/);
    expect(BUILDER_SRC).not.toMatch(/cancelKisOrder/);
  });

  it('builder: autoTradeEngine import 0건 + fetch / axios / node-fetch import 0건', () => {
    expect(BUILDER_SRC).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(BUILDER_SRC).not.toMatch(/from\s+['"]node-fetch['"]/);
    expect(BUILDER_SRC).not.toMatch(/from\s+['"]axios['"]/);
    // global fetch 호출도 부재 (영속 read-only)
    expect(BUILDER_SRC).not.toMatch(/\bfetch\s*\(/);
  });

  it('builder: ADR-0437 SUBSCRIPTION_PRIORITY_TABLE / sortCandidatesByPriority / normalizeKrxCodeForWs SSOT 사용', () => {
    expect(BUILDER_SRC).toContain('SUBSCRIPTION_PRIORITY_TABLE');
    expect(BUILDER_SRC).toContain('sortCandidatesByPriority');
    expect(BUILDER_SRC).toContain('normalizeKrxCodeForWs');
    expect(BUILDER_SRC).toMatch(
      /from ['"]\.\/kisWebSocketSubscriptionManager\.js['"]/,
    );
  });

  it('builder: ENV gate `KIS_STREAM_PRIORITY_BUILDER_DISABLED` 정확 비교 (ADR-0157)', () => {
    expect(BUILDER_SRC).toMatch(
      /process\.env\.KIS_STREAM_PRIORITY_BUILDER_DISABLED\s*===\s*['"]true['"]/,
    );
  });
});

// ── 통합 시나리오 ────────────────────────────────────────────────────────────

describe('ADR-0441 — 통합 시나리오 (사용자 명시 운영 안정성 보장)', () => {
  it('사용자 시나리오 — 보유 5 + 워치리스트 50개 → 30 상한 + 보유 우선 + ENTRY_CANDIDATE 우선 + OBSERVE_ONLY 절삭', () => {
    const openPositions = new Set([
      '100001', '100002', '100003', '100004', '100005',
    ]);
    const watchlist: WatchlistEntry[] = [];
    // 10개 ENTRY_CANDIDATE (gateScore 9)
    for (let i = 0; i < 10; i++) {
      watchlist.push(makeWatchlistEntry({
        code: String(200000 + i).padStart(6, '0'),
        gateScore: 9,
      }));
    }
    // 20개 WATCHLIST (gateScore 5)
    for (let i = 0; i < 20; i++) {
      watchlist.push(makeWatchlistEntry({
        code: String(300000 + i).padStart(6, '0'),
        gateScore: 5,
      }));
    }
    // 20개 OBSERVE_ONLY (gateScore 1)
    for (let i = 0; i < 20; i++) {
      watchlist.push(makeWatchlistEntry({
        code: String(400000 + i).padStart(6, '0'),
        gateScore: 1,
      }));
    }
    const codes = selectKisStreamSubscribableCodes(watchlist, openPositions, 30);
    expect(codes).toHaveLength(30);
    // 보유 5 + ENTRY_CANDIDATE 10 + WATCHLIST 15 = 30 (OBSERVE_ONLY 절삭 — 사용자 의도 정합)
    for (const owned of openPositions) expect(codes).toContain(owned);
    // ENTRY_CANDIDATE 10개 모두 포함
    for (let i = 0; i < 10; i++) {
      const entryCandidate = String(200000 + i).padStart(6, '0');
      expect(codes).toContain(entryCandidate);
    }
    // OBSERVE_ONLY 는 1개도 포함 안 됨 (top-30 절삭으로 자연 제외)
    for (let i = 0; i < 20; i++) {
      const observe = String(400000 + i).padStart(6, '0');
      expect(codes).not.toContain(observe);
    }
  });

  it('극단 시나리오 — 보유 30+ 개 → 보유 종목만으로 30 슬롯 채움 (워치리스트 모두 절삭)', () => {
    const openPositions = new Set<string>();
    for (let i = 0; i < 35; i++) {
      openPositions.add(String(100000 + i).padStart(6, '0'));
    }
    const watchlist: WatchlistEntry[] = [];
    for (let i = 0; i < 50; i++) {
      watchlist.push(makeWatchlistEntry({
        code: String(200000 + i).padStart(6, '0'),
        gateScore: 9, // 모두 ENTRY_CANDIDATE
      }));
    }
    const codes = selectKisStreamSubscribableCodes(watchlist, openPositions, 30);
    expect(codes).toHaveLength(30);
    // 모두 보유 종목 (워치리스트는 모두 절삭됨)
    for (const code of codes) {
      expect(openPositions.has(code)).toBe(true);
    }
  });

  it('빈 보유 + 빈 워치리스트 → 빈 codes (graceful)', () => {
    const codes = selectKisStreamSubscribableCodes([], new Set(), 30);
    expect(codes).toEqual([]);
  });
});
