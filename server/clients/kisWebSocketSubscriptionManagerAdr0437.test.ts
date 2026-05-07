/**
 * @responsibility ADR-0437 KIS WebSocket Subscription Priority Queue 회귀.
 *
 * 사용자 §10 30+ 케이스:
 *   - ENV gate 6
 *   - 우선순위 매트릭스 13
 *   - normalizeKrxCodeForWs 8+
 *   - dedupeCandidates 4
 *   - sortCandidatesByPriority 6
 *   - requestKisWsSubscription 결정 시나리오 12
 *   - bulkApplySubscriptionsByPriority 4
 *   - buildSubscriptionDiagnosis 4
 *   - formatKisWsSubscriptionSection 3
 *   - 정적 grep 가드 6
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// kisStreamClient mock (subscribe/unsubscribe stub)
vi.mock('./kisStreamClient.js', () => ({
  MAX_SUBSCRIPTIONS: 30,
  subscribeStock: vi.fn(() => true),
  unsubscribeStock: vi.fn(),
}));

import {
  SUBSCRIPTION_PRIORITY_TABLE,
  KIS_WS_SUBSCRIPTION_LIMIT,
  KIS_WS_SUBSCRIPTION_MIN_HOLD_MS,
  isKisWsSubscriptionPriorityDisabled,
  normalizeKrxCodeForWs,
  dedupeCandidates,
  sortCandidatesByPriority,
  chooseEvictionTarget,
  requestKisWsSubscription,
  bulkApplySubscriptionsByPriority,
  buildSubscriptionDiagnosis,
  formatKisWsSubscriptionSection,
  __resetKisWsSubscriptionStateForTests,
  type SubscriptionCandidate,
  type SubscriptionPriorityReason,
} from './kisWebSocketSubscriptionManager.js';

const MANAGER_PATH = resolve(__dirname, 'kisWebSocketSubscriptionManager.ts');
const MANAGER_SRC = readFileSync(MANAGER_PATH, 'utf-8');

beforeEach(() => {
  __resetKisWsSubscriptionStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ADR-0437 — ENV gate (default OFF / ADR-0157 정확 비교)', () => {
  it('default OFF (ENV 미설정)', () => {
    expect(isKisWsSubscriptionPriorityDisabled()).toBe(false);
  });

  it('"true" 정확 매칭 시 disabled', () => {
    vi.stubEnv('KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED', 'true');
    expect(isKisWsSubscriptionPriorityDisabled()).toBe(true);
  });

  it('"1" 거부 (ADR-0157 정확 비교)', () => {
    vi.stubEnv('KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED', '1');
    expect(isKisWsSubscriptionPriorityDisabled()).toBe(false);
  });

  it('"TRUE" 거부 (대소문자 일치 의무)', () => {
    vi.stubEnv('KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED', 'TRUE');
    expect(isKisWsSubscriptionPriorityDisabled()).toBe(false);
  });

  it('"yes" 거부', () => {
    vi.stubEnv('KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED', 'yes');
    expect(isKisWsSubscriptionPriorityDisabled()).toBe(false);
  });

  it('빈 문자열 거부', () => {
    vi.stubEnv('KIS_WS_SUBSCRIPTION_PRIORITY_DISABLED', '');
    expect(isKisWsSubscriptionPriorityDisabled()).toBe(false);
  });
});

describe('ADR-0437 — KIS_WS_MAX_SUBSCRIPTIONS / MIN_HOLD_MS clamp', () => {
  it('default 30 (env 미설정)', () => {
    expect(KIS_WS_SUBSCRIPTION_LIMIT).toBe(30);
  });

  it('default 5분 (300000ms)', () => {
    expect(KIS_WS_SUBSCRIPTION_MIN_HOLD_MS).toBe(300_000);
  });
});

describe('ADR-0437 — 우선순위 매트릭스 SSOT (절대 변경 금지)', () => {
  it('OPEN_POSITION = 1000', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION).toBe(1000);
  });

  it('LIVE_ELIGIBLE = 900', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.LIVE_ELIGIBLE).toBe(900);
  });

  it('ENTRY_CANDIDATE = 800', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.ENTRY_CANDIDATE).toBe(800);
  });

  it('SHADOW_OBSERVABLE = 700', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.SHADOW_OBSERVABLE).toBe(700);
  });

  it('DART_CATALYST = 600', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.DART_CATALYST).toBe(600);
  });

  it('WATCHLIST = 500 (default 보수 fallback)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST).toBe(500);
  });

  it('OBSERVE_ONLY / PROVIDER_DEGRADED / DATA_UNAVAILABLE = 300 (동등)', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.OBSERVE_ONLY).toBe(300);
    expect(SUBSCRIPTION_PRIORITY_TABLE.PROVIDER_DEGRADED).toBe(300);
    expect(SUBSCRIPTION_PRIORITY_TABLE.DATA_UNAVAILABLE).toBe(300);
  });

  it('WAIT_LONG / UNKNOWN = 100', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_LONG).toBe(100);
    expect(SUBSCRIPTION_PRIORITY_TABLE.UNKNOWN).toBe(100);
  });

  it('INVALID_CODE / HARD_RISK_BLOCK = 0', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.INVALID_CODE).toBe(0);
    expect(SUBSCRIPTION_PRIORITY_TABLE.HARD_RISK_BLOCK).toBe(0);
  });

  it('Object.freeze drift 차단', () => {
    expect(Object.isFrozen(SUBSCRIPTION_PRIORITY_TABLE)).toBe(true);
  });

  it('전체 13 reason 매핑 정합', () => {
    const keys = Object.keys(SUBSCRIPTION_PRIORITY_TABLE).sort();
    expect(keys).toEqual(
      [
        'DART_CATALYST',
        'DATA_UNAVAILABLE',
        'ENTRY_CANDIDATE',
        'HARD_RISK_BLOCK',
        'INVALID_CODE',
        'LIVE_ELIGIBLE',
        'OBSERVE_ONLY',
        'OPEN_POSITION',
        'PROVIDER_DEGRADED',
        'SHADOW_OBSERVABLE',
        'UNKNOWN',
        'WAIT_LONG',
        'WATCHLIST',
      ].sort(),
    );
  });

  it('priority 정렬: 1000 > 900 > 800 > 700 > 600 > 500 > 300 > 100 > 0', () => {
    expect(SUBSCRIPTION_PRIORITY_TABLE.OPEN_POSITION).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.LIVE_ELIGIBLE);
    expect(SUBSCRIPTION_PRIORITY_TABLE.LIVE_ELIGIBLE).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.ENTRY_CANDIDATE);
    expect(SUBSCRIPTION_PRIORITY_TABLE.ENTRY_CANDIDATE).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.SHADOW_OBSERVABLE);
    expect(SUBSCRIPTION_PRIORITY_TABLE.SHADOW_OBSERVABLE).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.DART_CATALYST);
    expect(SUBSCRIPTION_PRIORITY_TABLE.DART_CATALYST).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WATCHLIST).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.OBSERVE_ONLY);
    expect(SUBSCRIPTION_PRIORITY_TABLE.OBSERVE_ONLY).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.WAIT_LONG);
    expect(SUBSCRIPTION_PRIORITY_TABLE.WAIT_LONG).toBeGreaterThan(SUBSCRIPTION_PRIORITY_TABLE.INVALID_CODE);
  });
});

describe('ADR-0437 — normalizeKrxCodeForWs', () => {
  it('정상 6자리 → 그대로', () => {
    expect(normalizeKrxCodeForWs('005930')).toBe('005930');
  });

  it('.KS suffix → strip', () => {
    expect(normalizeKrxCodeForWs('005930.KS')).toBe('005930');
  });

  it('.KQ suffix → strip', () => {
    expect(normalizeKrxCodeForWs('035720.KQ')).toBe('035720');
  });

  it('소문자 .ks → 대문자 후 strip', () => {
    expect(normalizeKrxCodeForWs('005930.ks')).toBe('005930');
  });

  it('4자리 → null', () => {
    expect(normalizeKrxCodeForWs('0011')).toBe(null);
  });

  it('알파벳 포함 0011TO → null', () => {
    expect(normalizeKrxCodeForWs('0011TO')).toBe(null);
  });

  it('전체 알파벳 ABCDEF → null', () => {
    expect(normalizeKrxCodeForWs('ABCDEF')).toBe(null);
  });

  it('빈 문자열 → null', () => {
    expect(normalizeKrxCodeForWs('')).toBe(null);
  });

  it('null/undefined → null', () => {
    expect(normalizeKrxCodeForWs(null as unknown as string)).toBe(null);
    expect(normalizeKrxCodeForWs(undefined as unknown as string)).toBe(null);
  });

  it('공백 trim 후 6자리', () => {
    expect(normalizeKrxCodeForWs('  005930  ')).toBe('005930');
  });
});

describe('ADR-0437 — dedupeCandidates', () => {
  it('단일 entry 그대로', () => {
    const input: SubscriptionCandidate[] = [
      { code: '005930', priority: 900, reasons: ['LIVE_ELIGIBLE'], lastUpdatedAt: 1000 },
    ];
    const out = dedupeCandidates(input);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('005930');
  });

  it('같은 code 2건 → highest priority 하나만', () => {
    const input: SubscriptionCandidate[] = [
      { code: '005930', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
      { code: '005930', priority: 900, reasons: ['LIVE_ELIGIBLE'], lastUpdatedAt: 2000 },
    ];
    const out = dedupeCandidates(input);
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe(900);
    expect(out[0].reasons).toContain('LIVE_ELIGIBLE');
    expect(out[0].reasons).toContain('WATCHLIST');
  });

  it('reasons 병합 (Set)', () => {
    const input: SubscriptionCandidate[] = [
      { code: '005930', priority: 500, reasons: ['WATCHLIST', 'OBSERVE_ONLY'], lastUpdatedAt: 1000 },
      { code: '005930', priority: 900, reasons: ['LIVE_ELIGIBLE', 'WATCHLIST'], lastUpdatedAt: 2000 },
    ];
    const out = dedupeCandidates(input);
    expect(out[0].reasons.sort()).toEqual(['LIVE_ELIGIBLE', 'OBSERVE_ONLY', 'WATCHLIST']);
  });

  it('다중 code 모두 보존', () => {
    const input: SubscriptionCandidate[] = [
      { code: '005930', priority: 900, reasons: ['LIVE_ELIGIBLE'], lastUpdatedAt: 1000 },
      { code: '035720', priority: 700, reasons: ['SHADOW_OBSERVABLE'], lastUpdatedAt: 1500 },
    ];
    const out = dedupeCandidates(input);
    expect(out).toHaveLength(2);
  });
});

describe('ADR-0437 — sortCandidatesByPriority', () => {
  it('priority desc 기본', () => {
    const input: SubscriptionCandidate[] = [
      { code: 'A', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
      { code: 'B', priority: 1000, reasons: ['OPEN_POSITION'], lastUpdatedAt: 1000 },
      { code: 'C', priority: 700, reasons: ['SHADOW_OBSERVABLE'], lastUpdatedAt: 1000 },
    ];
    const out = sortCandidatesByPriority(input);
    expect(out.map((c) => c.code)).toEqual(['B', 'C', 'A']);
  });

  it('동률 priority 시 openPosition 우선', () => {
    const input: SubscriptionCandidate[] = [
      { code: 'A', priority: 700, reasons: ['SHADOW_OBSERVABLE'], openPosition: false, lastUpdatedAt: 1000 },
      { code: 'B', priority: 700, reasons: ['SHADOW_OBSERVABLE'], openPosition: true, lastUpdatedAt: 1000 },
    ];
    const out = sortCandidatesByPriority(input);
    expect(out[0].code).toBe('B');
  });

  it('동률 시 liveEligible 우선', () => {
    const input: SubscriptionCandidate[] = [
      { code: 'A', priority: 700, reasons: ['SHADOW_OBSERVABLE'], liveEligible: false, lastUpdatedAt: 1000 },
      { code: 'B', priority: 700, reasons: ['SHADOW_OBSERVABLE'], liveEligible: true, lastUpdatedAt: 1000 },
    ];
    const out = sortCandidatesByPriority(input);
    expect(out[0].code).toBe('B');
  });

  it('동률 시 entryCandidate 우선', () => {
    const input: SubscriptionCandidate[] = [
      { code: 'A', priority: 500, reasons: ['WATCHLIST'], entryCandidate: false, lastUpdatedAt: 1000 },
      { code: 'B', priority: 500, reasons: ['WATCHLIST'], entryCandidate: true, lastUpdatedAt: 1000 },
    ];
    const out = sortCandidatesByPriority(input);
    expect(out[0].code).toBe('B');
  });

  it('동률 시 lastUpdatedAt desc (최근 우선)', () => {
    const input: SubscriptionCandidate[] = [
      { code: 'A', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
      { code: 'B', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 2000 },
    ];
    const out = sortCandidatesByPriority(input);
    expect(out[0].code).toBe('B');
  });

  it('완전 동률 시 code asc (deterministic)', () => {
    const input: SubscriptionCandidate[] = [
      { code: 'B', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
      { code: 'A', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
    ];
    const out = sortCandidatesByPriority(input);
    expect(out[0].code).toBe('A');
    expect(out[1].code).toBe('B');
  });
});

describe('ADR-0437 — chooseEvictionTarget', () => {
  it('openPosition 은 evict 대상 제외', () => {
    const subs = [
      { code: '005930', priority: 1000, reasons: ['OPEN_POSITION' as SubscriptionPriorityReason], lastUpdatedAt: 1000, openPosition: true },
      { code: '000660', priority: 1000, reasons: ['OPEN_POSITION' as SubscriptionPriorityReason], lastUpdatedAt: 1000, openPosition: true },
    ];
    const target = chooseEvictionTarget(subs, { now: 1_000_000_000, forceImmediate: true });
    expect(target).toBe(null);
  });

  it('낮은 priority 먼저 evict', () => {
    const subs = [
      { code: 'A', priority: 900, reasons: ['LIVE_ELIGIBLE' as SubscriptionPriorityReason], lastUpdatedAt: 1000 },
      { code: 'B', priority: 300, reasons: ['OBSERVE_ONLY' as SubscriptionPriorityReason], lastUpdatedAt: 1000 },
    ];
    const target = chooseEvictionTarget(subs, { now: 1_000_000_000, forceImmediate: true });
    expect(target?.code).toBe('B');
  });

  it('동률 priority 시 OBSERVE_ONLY/DEGRADED/WAIT_LONG 먼저', () => {
    const subs = [
      { code: 'A', priority: 500, reasons: ['WATCHLIST' as SubscriptionPriorityReason], lastUpdatedAt: 1000 },
      { code: 'B', priority: 500, reasons: ['OBSERVE_ONLY' as SubscriptionPriorityReason], lastUpdatedAt: 1000 },
    ];
    const target = chooseEvictionTarget(subs, { now: 1_000_000_000, forceImmediate: true });
    expect(target?.code).toBe('B');
  });

  it('min-hold 미만이면 null (forceImmediate=false)', () => {
    const now = 1_000_000_000;
    const subs = [
      { code: 'A', priority: 500, reasons: ['WATCHLIST' as SubscriptionPriorityReason], lastUpdatedAt: now - 1000 },
    ];
    const target = chooseEvictionTarget(subs, { now, forceImmediate: false, minHoldMs: 300_000 });
    expect(target).toBe(null);
  });
});

describe('ADR-0437 — requestKisWsSubscription 결정 시나리오', () => {
  it('빈 상태 + liveEligible → SUBSCRIBE', () => {
    const subscribeFn = vi.fn(() => true);
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['LIVE_ELIGIBLE'], liveEligible: true },
      { subscribedPriorities: new Map(), subscribeFn, now: 1_000_000_000 },
    );
    expect(r.action).toBe('SUBSCRIBE');
    expect(subscribeFn).toHaveBeenCalledWith('005930');
  });

  it('29개 + liveEligible → SUBSCRIBE (limit 미달)', () => {
    const subscribed = new Map();
    for (let i = 0; i < 29; i++) {
      const code = String(100000 + i).padStart(6, '0');
      subscribed.set(code, { code, priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 });
    }
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['LIVE_ELIGIBLE'], liveEligible: true },
      { subscribedPriorities: subscribed, now: 1_000_000_000, limit: 30 },
    );
    expect(r.action).toBe('SUBSCRIBE');
    expect(subscribed.size).toBe(30);
  });

  it('30개 + 신규 priority 900 + 최저 300 → evict 300 + SUBSCRIBE', () => {
    const subscribed = new Map();
    const now = 1_000_000_000;
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      const priority = i === 0 ? 300 : 700;
      const reasons: SubscriptionPriorityReason[] = i === 0 ? ['OBSERVE_ONLY'] : ['SHADOW_OBSERVABLE'];
      subscribed.set(code, { code, priority, reasons, lastUpdatedAt: now - 600_000 });
    }
    const subscribeFn = vi.fn(() => true);
    const unsubscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['LIVE_ELIGIBLE'], liveEligible: true },
      {
        subscribedPriorities: subscribed,
        subscribeFn,
        unsubscribeFn,
        now,
        limit: 30,
        minHoldMs: 300_000,
      },
    );
    expect(r.action).toBe('SUBSCRIBE');
    expect(unsubscribeFn).toHaveBeenCalledWith('100000');
    expect(subscribeFn).toHaveBeenCalledWith('005930');
    expect(subscribed.has('100000')).toBe(false);
    expect(subscribed.has('005930')).toBe(true);
  });

  it('30개 + 신규 priority 300 + 최저 700 → REJECT_LOW_PRIORITY', () => {
    const subscribed = new Map();
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      subscribed.set(code, { code, priority: 700, reasons: ['SHADOW_OBSERVABLE'], lastUpdatedAt: 1_000_000_000 - 600_000 });
    }
    const subscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['OBSERVE_ONLY'] },
      { subscribedPriorities: subscribed, subscribeFn, now: 1_000_000_000, limit: 30 },
    );
    expect(r.action).toBe('REJECT_LOW_PRIORITY');
    expect(subscribeFn).not.toHaveBeenCalled();
  });

  it('30개 + 모두 openPosition + 신규 priority 1000 → evict 금지 → REJECT_LOW_PRIORITY (사용자 명시 보호)', () => {
    const subscribed = new Map();
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      subscribed.set(code, { code, priority: 1000, reasons: ['OPEN_POSITION'], openPosition: true, lastUpdatedAt: 1_000_000_000 - 600_000 });
    }
    const subscribeFn = vi.fn();
    const unsubscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['OPEN_POSITION'], openPosition: true },
      { subscribedPriorities: subscribed, subscribeFn, unsubscribeFn, now: 1_000_000_000, limit: 30 },
    );
    expect(r.action).toBe('REJECT_LOW_PRIORITY');
    expect(unsubscribeFn).not.toHaveBeenCalled();
  });

  it('invalid code (0011TO) → REJECT_INVALID_CODE + subscribeStock 호출 0', () => {
    const subscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '0011TO', reasons: ['WATCHLIST'] },
      { subscribedPriorities: new Map(), subscribeFn, now: 1_000_000_000 },
    );
    expect(r.action).toBe('REJECT_INVALID_CODE');
    expect(subscribeFn).not.toHaveBeenCalled();
  });

  it('이미 구독 중 same code → KEEP', () => {
    const subscribed = new Map();
    subscribed.set('005930', { code: '005930', priority: 700, reasons: ['SHADOW_OBSERVABLE'], lastUpdatedAt: 1_000_000_000 - 600_000 });
    const subscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['SHADOW_OBSERVABLE'] },
      { subscribedPriorities: subscribed, subscribeFn, now: 1_000_000_000 },
    );
    expect(r.action).toBe('KEEP');
    expect(subscribeFn).not.toHaveBeenCalled();
  });

  it('이미 구독 중 + priority 격상 → KEEP (priority 갱신, unsubscribe 없음)', () => {
    const subscribed = new Map();
    subscribed.set('005930', { code: '005930', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1_000_000_000 - 600_000 });
    const unsubscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['LIVE_ELIGIBLE'], liveEligible: true },
      { subscribedPriorities: subscribed, unsubscribeFn, now: 1_000_000_000 },
    );
    expect(r.action).toBe('KEEP');
    expect(unsubscribeFn).not.toHaveBeenCalled();
    expect(subscribed.get('005930')?.priority).toBe(900); // 격상
  });

  it('30개 + 이미 구독 중 + min-hold 미만 + 신규 priority 더 높음 → 기존 evict 차단 → 신규 REJECT_LOW_PRIORITY', () => {
    const now = 1_000_000_000;
    const subscribed = new Map();
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      // 모두 min-hold 1분 전에 구독 (5분 미만)
      subscribed.set(code, { code, priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: now - 60_000 });
    }
    const subscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['LIVE_ELIGIBLE'], liveEligible: true },
      { subscribedPriorities: subscribed, subscribeFn, now, limit: 30, minHoldMs: 300_000 },
    );
    expect(r.action).toBe('REJECT_LOW_PRIORITY');
    expect(subscribeFn).not.toHaveBeenCalled();
  });

  it('30개 + min-hold 만료 + 신규 priority 더 높음 → 기존 evict + 신규 SUBSCRIBE', () => {
    const now = 1_000_000_000;
    const subscribed = new Map();
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      subscribed.set(code, { code, priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: now - 600_000 });
    }
    const subscribeFn = vi.fn();
    const unsubscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['LIVE_ELIGIBLE'], liveEligible: true },
      { subscribedPriorities: subscribed, subscribeFn, unsubscribeFn, now, limit: 30, minHoldMs: 300_000 },
    );
    expect(r.action).toBe('SUBSCRIBE');
    expect(unsubscribeFn).toHaveBeenCalled();
  });

  it('HARD_RISK_BLOCK (priority 0) → 즉시 unsubscribe (보유 시)', () => {
    const subscribed = new Map();
    subscribed.set('005930', { code: '005930', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1_000_000_000 - 60_000 });
    const unsubscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['HARD_RISK_BLOCK'] },
      { subscribedPriorities: subscribed, unsubscribeFn, now: 1_000_000_000 },
    );
    expect(r.action).toBe('UNSUBSCRIBE');
    expect(unsubscribeFn).toHaveBeenCalledWith('005930');
  });

  it('HARD_RISK_BLOCK + openPosition 보유 → 그래도 KEEP (보호)', () => {
    const subscribed = new Map();
    subscribed.set('005930', { code: '005930', priority: 1000, reasons: ['OPEN_POSITION'], openPosition: true, lastUpdatedAt: 1_000_000_000 });
    const unsubscribeFn = vi.fn();
    const r = requestKisWsSubscription(
      { code: '005930', reasons: ['HARD_RISK_BLOCK'] },
      { subscribedPriorities: subscribed, unsubscribeFn, now: 1_000_000_000 },
    );
    expect(r.action).toBe('KEEP');
    expect(unsubscribeFn).not.toHaveBeenCalled();
  });
});

describe('ADR-0437 — bulkApplySubscriptionsByPriority', () => {
  it('50개 → 30개 SUBSCRIBE + 20개 REJECT_LOW_PRIORITY', () => {
    const candidates: SubscriptionCandidate[] = [];
    for (let i = 0; i < 50; i++) {
      const code = String(100000 + i).padStart(6, '0');
      const priority = 1000 - i * 10;
      candidates.push({ code, priority, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 });
    }
    const subscribeFn = vi.fn(() => true);
    const decisions = bulkApplySubscriptionsByPriority(candidates, {
      subscribedPriorities: new Map(),
      subscribeFn,
      limit: 30,
    });
    expect(decisions).toHaveLength(50);
    const subscribed = decisions.filter((d) => d.action === 'SUBSCRIBE');
    const rejected = decisions.filter((d) => d.action === 'REJECT_LOW_PRIORITY');
    expect(subscribed).toHaveLength(30);
    expect(rejected).toHaveLength(20);
  });

  it('openPosition 보존 (정렬 우선)', () => {
    const candidates: SubscriptionCandidate[] = [];
    for (let i = 0; i < 31; i++) {
      const code = String(100000 + i).padStart(6, '0');
      const isOpen = i === 30; // 마지막만 openPosition
      candidates.push({
        code,
        priority: isOpen ? 1000 : 500,
        reasons: isOpen ? ['OPEN_POSITION'] : ['WATCHLIST'],
        openPosition: isOpen,
        lastUpdatedAt: 1000,
      });
    }
    const subscribeFn = vi.fn(() => true);
    const decisions = bulkApplySubscriptionsByPriority(candidates, {
      subscribedPriorities: new Map(),
      subscribeFn,
      limit: 30,
    });
    const openSubscribed = decisions.find((d) => d.code.startsWith('1000') && d.code === String(100000 + 30).padStart(6, '0'));
    expect(openSubscribed?.action).toBe('SUBSCRIBE');
  });

  it('dedup 동일 code', () => {
    const candidates: SubscriptionCandidate[] = [
      { code: '005930', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
      { code: '005930', priority: 900, reasons: ['LIVE_ELIGIBLE'], lastUpdatedAt: 2000 },
    ];
    const subscribeFn = vi.fn(() => true);
    const decisions = bulkApplySubscriptionsByPriority(candidates, {
      subscribedPriorities: new Map(),
      subscribeFn,
      limit: 30,
    });
    expect(decisions).toHaveLength(1);
    const decision = decisions[0];
    expect(decision.action).toBe('SUBSCRIBE');
    if (decision.action === 'SUBSCRIBE') {
      expect(decision.priority).toBe(900);
    }
  });

  it('정렬 결정성 (deterministic)', () => {
    const candidates: SubscriptionCandidate[] = [
      { code: 'B', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
      { code: 'A', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 },
    ];
    const subscribeFn = vi.fn(() => true);
    const decisions = bulkApplySubscriptionsByPriority(candidates, {
      subscribedPriorities: new Map(),
      subscribeFn,
      limit: 30,
    });
    // 둘 다 SUBSCRIBE 결정. dedup map iteration 순서가 첫 진입 순이라 B 가 먼저 들어가고 A 가 나중.
    // sort 결과는 code asc 라 A 가 먼저.
    const codes = decisions.map((d) => d.code);
    expect(codes).toEqual(['A', 'B']);
  });
});

describe('ADR-0437 — buildSubscriptionDiagnosis', () => {
  it('카운트 정확 (open / live / shadow / watchlist / observe)', () => {
    const subscribed = new Map();
    subscribed.set('A', { code: 'A', priority: 1000, reasons: ['OPEN_POSITION'], openPosition: true, lastUpdatedAt: 1000 });
    subscribed.set('B', { code: 'B', priority: 900, reasons: ['LIVE_ELIGIBLE'], liveEligible: true, lastUpdatedAt: 1000 });
    subscribed.set('C', { code: 'C', priority: 700, reasons: ['SHADOW_OBSERVABLE'], shadowObservable: true, lastUpdatedAt: 1000 });
    subscribed.set('D', { code: 'D', priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: 1000 });
    subscribed.set('E', { code: 'E', priority: 300, reasons: ['OBSERVE_ONLY'], lastUpdatedAt: 1000 });
    const diag = buildSubscriptionDiagnosis({ subscribedPriorities: subscribed });
    expect(diag.total).toBe(5);
    expect(diag.openPositionCount).toBe(1);
    expect(diag.liveEligibleCount).toBe(1);
    expect(diag.shadowObservableCount).toBe(1);
    expect(diag.watchlistCount).toBe(1); // D 는 open/live/shadow 모두 false
    expect(diag.observeOnlyCount).toBe(1); // E
  });

  it('빈 상태 → 모두 0', () => {
    const diag = buildSubscriptionDiagnosis({ subscribedPriorities: new Map() });
    expect(diag.total).toBe(0);
    expect(diag.openPositionCount).toBe(0);
    expect(diag.liveEligibleCount).toBe(0);
    expect(diag.shadowObservableCount).toBe(0);
  });

  it('limit 항상 KIS_WS_SUBSCRIPTION_LIMIT (30)', () => {
    const diag = buildSubscriptionDiagnosis({ subscribedPriorities: new Map() });
    expect(diag.limit).toBe(KIS_WS_SUBSCRIPTION_LIMIT);
  });

  it('lastEvicted 추적', () => {
    __resetKisWsSubscriptionStateForTests();
    const subscribed = new Map();
    const now = 1_000_000_000;
    for (let i = 0; i < 30; i++) {
      const code = String(100000 + i).padStart(6, '0');
      subscribed.set(code, { code, priority: 500, reasons: ['WATCHLIST'], lastUpdatedAt: now - 600_000 });
    }
    const subscribeFn = vi.fn(() => true);
    const unsubscribeFn = vi.fn();
    requestKisWsSubscription(
      { code: '005930', reasons: ['LIVE_ELIGIBLE'], liveEligible: true },
      { subscribedPriorities: subscribed, subscribeFn, unsubscribeFn, now, limit: 30, minHoldMs: 300_000 },
    );
    // module-level _stats 갱신 — buildSubscriptionDiagnosis(default ctx) 로 검증 어렵지만
    // 본 PR 시 module-local map 우회 (ctx 제공) 라 _stats 자체는 갱신됨
    const diag = buildSubscriptionDiagnosis();
    expect(diag.evictedCount).toBeGreaterThanOrEqual(1);
    expect(diag.lastEvictedCode).toBe('100000');
  });
});

describe('ADR-0437 — formatKisWsSubscriptionSection', () => {
  it('정상 출력 + ADR-0437 헤더', () => {
    const diag = {
      total: 30,
      limit: 30,
      openPositionCount: 2,
      liveEligibleCount: 5,
      shadowObservableCount: 8,
      watchlistCount: 10,
      observeOnlyCount: 5,
      invalidRejectedCount: 1,
      lowPriorityRejectedCount: 11,
      evictedCount: 3,
      lastEvictedCode: '123456',
      lastEvictedReason: 'OBSERVE_ONLY' as SubscriptionPriorityReason,
    };
    const out = formatKisWsSubscriptionSection(diag);
    expect(out).toContain('ADR-0437');
    expect(out).toContain('30/30');
    expect(out).toContain('open: 2');
    expect(out).toContain('live: 5');
    expect(out).toContain('shadow: 8');
    expect(out).toContain('watchlist: 10');
    expect(out).toContain('observe: 5');
    expect(out).toContain('rejected: 12');
    expect(out).toContain('evicted: 3');
    expect(out).toContain('lastEvicted: 123456');
  });

  it('빈 상태 (rejected/evicted 0)', () => {
    const diag = {
      total: 0,
      limit: 30,
      openPositionCount: 0,
      liveEligibleCount: 0,
      shadowObservableCount: 0,
      watchlistCount: 0,
      observeOnlyCount: 0,
      invalidRejectedCount: 0,
      lowPriorityRejectedCount: 0,
      evictedCount: 0,
    };
    const out = formatKisWsSubscriptionSection(diag);
    expect(out).toContain('0/30');
    expect(out).not.toContain('rejected: ');
    expect(out).not.toContain('lastEvicted: ');
  });

  it('사용자 §8 명시 형식 정합 (subscription summary)', () => {
    const diag = {
      total: 30,
      limit: 30,
      openPositionCount: 2,
      liveEligibleCount: 5,
      shadowObservableCount: 8,
      watchlistCount: 10,
      observeOnlyCount: 5,
      invalidRejectedCount: 0,
      lowPriorityRejectedCount: 12,
      evictedCount: 0,
    };
    const out = formatKisWsSubscriptionSection(diag);
    expect(out).toMatch(/total: 30/);
    expect(out).toMatch(/open: 2/);
    expect(out).toMatch(/live: 5/);
    expect(out).toMatch(/shadow: 8/);
  });
});

describe('ADR-0437 — 정적 grep 회귀 가드 (절대 규칙)', () => {
  function stripCommentsAndStrings(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*$/gm, '') // line comments
      .replace(/'[^'\n]*'/g, "''") // single-quoted strings
      .replace(/"[^"\n]*"/g, '""') // double-quoted strings
      .replace(/`[^`]*`/g, '``'); // template literals
  }

  it('KIS 주문 함수 5종 import 0건', () => {
    const src = stripCommentsAndStrings(MANAGER_SRC);
    expect(src).not.toMatch(/placeKisMarketBuyOrder/);
    expect(src).not.toMatch(/placeKisSellOrder/);
    expect(src).not.toMatch(/cancelKisOrder/);
    expect(src).not.toMatch(/placeKisStopLossOrder/);
    expect(src).not.toMatch(/placeKisTakeProfitOrder/);
  });

  it('autoTradeEngine / orderExecutor / trancheExecutor import 0건', () => {
    const src = stripCommentsAndStrings(MANAGER_SRC);
    expect(src).not.toMatch(/from\s+['"`].*autoTradeEngine/);
    expect(src).not.toMatch(/from\s+['"`].*orderExecutor/);
    expect(src).not.toMatch(/from\s+['"`].*trancheExecutor/);
  });

  it('fetch / axios / node-fetch 신규 import 0건', () => {
    const src = stripCommentsAndStrings(MANAGER_SRC);
    expect(src).not.toMatch(/from\s+['"`]axios['"`]/);
    expect(src).not.toMatch(/from\s+['"`]node-fetch['"`]/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it('Gate threshold / condition weight 변경 코드 0건', () => {
    const src = stripCommentsAndStrings(MANAGER_SRC);
    expect(src).not.toMatch(/setGateThreshold/);
    expect(src).not.toMatch(/GATE_RELAX/);
    expect(src).not.toMatch(/STRONG_BUY_OVERRIDE/);
  });

  it('subscribeStock 직접 호출은 manager 내부에서만 (외부 호출자 helpers.ts 는 wrapper 경유)', () => {
    // manager 자체는 subscribeStock 을 import + 호출 — 정상 (wrapper 본체)
    const src = stripCommentsAndStrings(MANAGER_SRC);
    expect(src).toMatch(/subscribeStock/);
    // 다른 호출자는 wrapper 경유 의무 — 정적 grep 가드는 별도 테스트로 격리
  });

  it('kisStreamClient.ts MAX_SUBSCRIPTIONS 변경 0건 (re-import 만)', () => {
    const src = stripCommentsAndStrings(MANAGER_SRC);
    // MAX_SUBSCRIPTIONS 변경 (재할당, =) 패턴 부재
    expect(src).not.toMatch(/MAX_SUBSCRIPTIONS\s*=\s*[0-9]+/);
    // import 는 OK
    expect(MANAGER_SRC).toMatch(/import\s*\{[\s\S]*MAX_SUBSCRIPTIONS[\s\S]*\}\s*from\s+['"`][^'"`]*kisStreamClient/);
  });

  it('helpers.ts wrapper 경유 (subscribeStock 단일 직접 호출 위치만)', () => {
    const HELPERS_PATH = resolve(__dirname, '../trading/signalScanner/perSymbol/helpers.ts');
    const src = readFileSync(HELPERS_PATH, 'utf-8');
    const stripped = stripCommentsAndStrings(src);
    // ENV disabled fallback 한 곳 (legacy) + try/catch 격리 한 곳 = 2건
    const subscribeStockCalls = (stripped.match(/subscribeStock\(/g) ?? []).length;
    // ENV disabled 분기 + try/catch fallback = 2 호출, 그 외 직접 호출 0
    expect(subscribeStockCalls).toBeLessThanOrEqual(2);
    expect(stripped).toMatch(/requestKisWsSubscription/);
  });
});
