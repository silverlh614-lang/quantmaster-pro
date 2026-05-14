/**
 * @responsibility ADR-0516 — buyListLoop + candidateSelect Watchlist Tier 정책 wiring 정적 가드
 *
 * 정적 grep 가드 (drift 차단) — tier 정책 wiring 위치·인자·SKIP 처리 보존.
 * MOMENTUM_PASSIVE no-price 가 FAIL / DATA_VACUUM / providerIssue / NEW_BUY_BLOCKED 으로
 * 격상되지 않음을 정적 검증한다 (evaluateBuyList 는 거대 함수라 단위 테스트 대신 grep 가드).
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const BUY_LIST_LOOP = fs.readFileSync(
  path.resolve(__dirname, 'buyListLoop.ts'),
  'utf-8',
);
const CANDIDATE_SELECT = fs.readFileSync(
  path.resolve(__dirname, '..', 'candidateSelect.ts'),
  'utf-8',
);
const HELPERS = fs.readFileSync(
  path.resolve(__dirname, 'helpers.ts'),
  'utf-8',
);
const WARMUP_JOB = fs.readFileSync(
  path.resolve(__dirname, '..', '..', '..', 'scheduler', 'investorFlowWarmupJob.ts'),
  'utf-8',
);

describe('ADR-0516 §buyListLoop wiring 정적 가드', () => {
  it('resolveWatchlistKisPolicy import (watchlistKisTierPolicy SSOT)', () => {
    expect(BUY_LIST_LOOP).toMatch(
      /import \{ resolveWatchlistKisPolicy \} from ['"]\.\.\/\.\.\/watchlistKisTierPolicy\.js['"]/,
    );
  });

  it('getPrice 호출에 tier 정책 컨텍스트 전달 (allowRestFallback)', () => {
    expect(BUY_LIST_LOOP).toMatch(/allowRestFallback: kisTierPolicy\.allowRestPrice/);
    expect(BUY_LIST_LOOP).toMatch(/restTtlMs: kisTierPolicy\.priceTtlMs/);
  });

  it('resolveWatchlistKisPolicy 입력 — section/gateScore/stage2Score/momentumRank/isOpenPosition/isForceBuy', () => {
    const callBlock = BUY_LIST_LOOP.match(/resolveWatchlistKisPolicy\(\{[\s\S]+?\}\);/);
    expect(callBlock).not.toBeNull();
    const block = callBlock?.[0] ?? '';
    expect(block).toMatch(/section: stock\.section/);
    expect(block).toMatch(/momentumRank:/);
    expect(block).toMatch(/isOpenPosition: isHeldPosition/);
    expect(block).toMatch(/isForceBuy:/);
  });

  it('보유 종목(shadows 활성) 감지 — isHeldPosition (OPEN_POSITION 보호)', () => {
    expect(BUY_LIST_LOOP).toMatch(/const isHeldPosition = ctx\.shadows\.some\(/);
    expect(BUY_LIST_LOOP).toMatch(/isOpenShadowStatus\(s\.status\)/);
  });

  it('MOMENTUM_PASSIVE no-price → SKIP_TIER_PASSIVE_NO_REST (FAIL 아님)', () => {
    expect(BUY_LIST_LOOP).toMatch(/stageLog\.price = ['"]SKIP_TIER_PASSIVE_NO_REST['"]/);
  });

  it('tier 차단 카운터 waitTierRestSuppressed 누적', () => {
    expect(BUY_LIST_LOOP).toMatch(
      /ctx\.scanCounters\.waitTierRestSuppressed =\s*\(ctx\.scanCounters\.waitTierRestSuppressed \?\? 0\) \+ 1/,
    );
  });

  it('SKIP 블록은 DATA_VACUUM / providerIssue / NEW_BUY_BLOCKED 으로 격상하지 않음', () => {
    // !kisTierPolicy.allowRestPrice 블록 본문 추출 — continue 까지.
    const skipBlock = BUY_LIST_LOOP.match(
      /if \(!kisTierPolicy\.allowRestPrice\) \{[\s\S]+?continue;\s*\}/,
    );
    expect(skipBlock).not.toBeNull();
    const block = skipBlock?.[0] ?? '';
    expect(block).not.toMatch(/DATA_VACUUM/);
    expect(block).not.toMatch(/providerIssue/);
    expect(block).not.toMatch(/marketSignal\s*[:=]\s*true/);
    expect(block).not.toMatch(/NEW_BUY_BLOCKED/);
    // continue 로 이번 사이클만 스킵 (Shadow learning 차단 아님).
    expect(block).toMatch(/continue;/);
  });

  it('compact 로그 [WATCHLIST_KIS_TIER] + executionImpact=NONE + marketSignal=false', () => {
    expect(BUY_LIST_LOOP).toMatch(/\[WATCHLIST_KIS_TIER\]/);
    const skipBlock = BUY_LIST_LOOP.match(
      /if \(!kisTierPolicy\.allowRestPrice\) \{[\s\S]+?continue;\s*\}/,
    );
    const block = skipBlock?.[0] ?? '';
    expect(block).toMatch(/executionImpact=NONE/);
    expect(block).toMatch(/marketSignal=false/);
  });

  it('DEBUG 로그는 WATCHLIST_KIS_TIER_DEBUG ENV 게이팅 (minimal logging)', () => {
    expect(BUY_LIST_LOOP).toMatch(
      /process\.env\.WATCHLIST_KIS_TIER_DEBUG === ['"]true['"]/,
    );
  });

  it('ADR-0516 추적 주석 (import + wiring)', () => {
    const count = (BUY_LIST_LOOP.match(/ADR-0516/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

describe('ADR-0516 §candidateSelect wiring 정적 가드', () => {
  it('assignMomentumRanks import (watchlistKisTierPolicy SSOT)', () => {
    expect(CANDIDATE_SELECT).toMatch(
      /import \{ assignMomentumRanks \} from ['"]\.\.\/watchlistKisTierPolicy\.js['"]/,
    );
  });

  it('momentumList 에 assignMomentumRanks 호출', () => {
    expect(CANDIDATE_SELECT).toMatch(/assignMomentumRanks\(momentumList\)/);
  });

  it('isForceBuy runtime 플래그 부여 (영속 schema 변경 아님 — cast 사용)', () => {
    expect(CANDIDATE_SELECT).toMatch(
      /\(w as \{ isForceBuy\?: boolean \}\)\.isForceBuy = forceCodes\.has\(w\.code\)/,
    );
  });

  it('watchlistRepo 영속 schema 변경 없음 — momentumRank/isForceBuy 는 runtime-only cast', () => {
    // candidateSelect 는 WatchlistEntry 에 momentumRank/isForceBuy 를 직접 선언하지 않는다.
    expect(CANDIDATE_SELECT).not.toMatch(/interface WatchlistEntry/);
  });

  it('ADR-0516 추적 주석', () => {
    expect(CANDIDATE_SELECT).toMatch(/ADR-0516/);
  });
});

describe('ADR-0516 §helpers.getPrice 정적 가드', () => {
  it('GetPriceSubscriptionContext 에 allowRestFallback 옵셔널 필드 추가', () => {
    expect(HELPERS).toMatch(/allowRestFallback\?: boolean/);
    expect(HELPERS).toMatch(/restTtlMs\?: number/);
    expect(HELPERS).toMatch(/pricePurpose\?:/);
  });

  it('allowRestFallback === false 일 때만 REST 차단 (후방호환 — undefined 는 기존 동작)', () => {
    expect(HELPERS).toMatch(/ctx\?\.allowRestFallback === false/);
  });

  it('REST 차단 분기에서 fetchCurrentPrice 미호출 + null 반환', () => {
    const block = HELPERS.match(
      /if \(ctx\?\.allowRestFallback === false\) \{[\s\S]+?return null;\s*\}/,
    );
    expect(block).not.toBeNull();
    expect(block?.[0]).not.toMatch(/fetchCurrentPrice/);
  });

  it('requestKisWsSubscription (ADR-0437 priority queue) 은 REST 차단보다 먼저 — 무변경', () => {
    const wsIdx = HELPERS.indexOf('requestKisWsSubscription({');
    const restBlockIdx = HELPERS.indexOf('ctx?.allowRestFallback === false');
    expect(wsIdx).toBeGreaterThan(0);
    expect(restBlockIdx).toBeGreaterThan(wsIdx);
  });

  it('ADR-0516 추적 주석', () => {
    expect(HELPERS).toMatch(/ADR-0516/);
  });
});

describe('ADR-0516 §investorFlowWarmupJob tier-aware 선정 정적 가드', () => {
  it('watchlistKisTierPolicy SSOT import (assignMomentumRanks + resolveWatchlistKisPolicy)', () => {
    expect(WARMUP_JOB).toMatch(
      /import \{ assignMomentumRanks, resolveWatchlistKisPolicy \} from ['"]\.\.\/trading\/watchlistKisTierPolicy\.js['"]/,
    );
  });

  it('MOMENTUM_PASSIVE 는 후순위 (passive bucket — lower-priority)', () => {
    expect(WARMUP_JOB).toMatch(/MOMENTUM_PASSIVE/);
    // active / passive 2-bucket 분리 후 [...active, ...passive] concat.
    expect(WARMUP_JOB).toMatch(/\[\.\.\.active, \.\.\.passive\]/);
  });

  it('section 분류 — computeFocusCodes + assignSection 직접 호출 (자체 watchlist 사본)', () => {
    expect(WARMUP_JOB).toMatch(/computeFocusCodes\(watchlist\)/);
    expect(WARMUP_JOB).toMatch(/assignSection\(w, focusCodes\)/);
  });

  it('selectWarmupCodes 가 resolveWatchlistKisPolicy 로 tier 도출', () => {
    expect(WARMUP_JOB).toMatch(/resolveWatchlistKisPolicy\(\{/);
  });

  it('ADR-0516 추적 주석', () => {
    expect(WARMUP_JOB).toMatch(/ADR-0516/);
  });
});
