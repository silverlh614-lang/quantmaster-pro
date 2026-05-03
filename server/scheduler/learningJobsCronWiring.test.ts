// @responsibility ADR-0176 learningJobs.ts 5 cron `enqueueOnSkip` 옵션 wiring 정적 grep 가드 — 화이트리스트 회귀 차단
/**
 * learningJobsCronWiring.test.ts (ADR-0176, Phase 2b-2)
 *
 * `learningJobs.ts` 의 5 학습 cron 호출에 `enqueueOnSkip: {}` 옵션 전달 정적 검증.
 * 본 PR 의 화이트리스트:
 *   - counterfactual_resolve
 *   - ledger_resolve
 *   - ghost_portfolio
 *   - nightly_reflection
 *   - daily_mini_backtest
 *
 * 잘못된 cron 에 옵션 추가 시 WAR — 다른 cron (silent_distillation / weekly_backtest /
 * weekly_calib / weekly_sharpe_alert / f2w_reverse_loop / walk_forward_validation /
 * future_return_resolve / missed_learning_replay) 에 옵션 전달 0건 회귀 차단.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.resolve(__dirname, 'learningJobs.ts');

function loadSource(): string {
  return fs.readFileSync(SOURCE_PATH, 'utf-8');
}

/** 주석 strip — false positive 차단. */
function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

/**
 * `scheduledJob('cronExpr', 'ScheduleClass', 'jobName', fn, options?)` 호출에서
 * jobName 별로 options 인자 (5번째 위치) 발췌. 단순 정규식 — `}, options);` 패턴.
 *
 * 호출이 멀티라인이라 fn 본체 brace 카운팅 필요. 각 jobName 매칭 후 *해당 cron* 의
 * `}, { ... });` 마지막 closing 까지 추출.
 */
function extractCronOptions(src: string, jobName: string): string {
  const code = stripComments(src);
  // jobName 등장 후 후속 `}, { ... });` 매칭. 가장 가까운 매칭 사용.
  const jobIdx = code.indexOf(`'${jobName}'`);
  if (jobIdx < 0) return '';
  // jobName 다음부터 `});` 까지 슬라이스
  const slice = code.slice(jobIdx);
  // 마지막 closing `});` 찾기 — 첫 등장 (단순 가정, 본 회귀 가드는 옵션 위치만 검증)
  const closeIdx = slice.indexOf('});');
  if (closeIdx < 0) return '';
  return slice.slice(0, closeIdx + 3);
}

describe('ADR-0176 — learningJobs.ts 5 학습 cron `enqueueOnSkip` 옵션 wiring 정적 가드', () => {
  // ─── 화이트리스트 5 cron 옵션 전달 검증 ─────────────────────────────────────

  it('1. counterfactual_resolve 에 `enqueueOnSkip:` 옵션 전달', () => {
    const src = loadSource();
    const region = extractCronOptions(src, 'counterfactual_resolve');
    expect(region).toMatch(/enqueueOnSkip\s*:/);
  });

  it('2. ledger_resolve 에 `enqueueOnSkip:` 옵션 전달', () => {
    const src = loadSource();
    const region = extractCronOptions(src, 'ledger_resolve');
    expect(region).toMatch(/enqueueOnSkip\s*:/);
  });

  it('3. ghost_portfolio 에 `enqueueOnSkip:` 옵션 전달', () => {
    const src = loadSource();
    const region = extractCronOptions(src, 'ghost_portfolio');
    expect(region).toMatch(/enqueueOnSkip\s*:/);
  });

  it('4. nightly_reflection 에 `enqueueOnSkip:` 옵션 전달', () => {
    const src = loadSource();
    const region = extractCronOptions(src, 'nightly_reflection');
    expect(region).toMatch(/enqueueOnSkip\s*:/);
  });

  it('5. daily_mini_backtest 에 `enqueueOnSkip:` 옵션 전달', () => {
    const src = loadSource();
    const region = extractCronOptions(src, 'daily_mini_backtest');
    expect(region).toMatch(/enqueueOnSkip\s*:/);
  });

  // ─── 화이트리스트 5 cron 모두 빈 객체 (default replayPolicy 사용) ────────────

  it('6. 5 학습 cron 모두 `enqueueOnSkip: {}` 빈 객체 전달 (default replayPolicy=SAFE_NEXT_TRADING_DAY)', () => {
    const src = loadSource();
    const wiredCrons = [
      'counterfactual_resolve',
      'ledger_resolve',
      'ghost_portfolio',
      'nightly_reflection',
      'daily_mini_backtest',
    ];
    for (const jobName of wiredCrons) {
      const region = extractCronOptions(src, jobName);
      expect(region, `${jobName}: enqueueOnSkip 옵션 누락`).toMatch(/enqueueOnSkip\s*:\s*\{\s*\}/);
    }
  });

  // ─── 화이트리스트 외 cron 옵션 전달 0건 회귀 가드 ─────────────────────────────

  it('7. weekly_backtest (WEEKEND_MAINTENANCE) 에 `enqueueOnSkip` 옵션 부재', () => {
    const src = loadSource();
    const region = extractCronOptions(src, 'weekly_backtest');
    expect(region).not.toMatch(/enqueueOnSkip/);
  });

  it('8. weekly_calib (WEEKEND_MAINTENANCE) 에 `enqueueOnSkip` 옵션 부재', () => {
    const src = loadSource();
    const region = extractCronOptions(src, 'weekly_calib');
    expect(region).not.toMatch(/enqueueOnSkip/);
  });

  it('9. weekly_sharpe_alert / f2w_reverse_loop / silent_distillation / walk_forward_validation 에 `enqueueOnSkip` 옵션 부재', () => {
    const src = loadSource();
    const offWhitelist = [
      'weekly_sharpe_alert',
      'f2w_reverse_loop',
      'silent_distillation',
      'walk_forward_validation',
    ];
    for (const jobName of offWhitelist) {
      const region = extractCronOptions(src, jobName);
      expect(region, `${jobName}: 화이트리스트 외인데 enqueueOnSkip 옵션 발견`).not.toMatch(
        /enqueueOnSkip/,
      );
    }
  });

  it('10. future_return_resolve / missed_learning_replay 에 `enqueueOnSkip` 옵션 부재 (replay cron 자체)', () => {
    const src = loadSource();
    // future_return_resolve — Phase 2b-1 cron, enqueue 대상 아님
    const futureRegion = extractCronOptions(src, 'future_return_resolve');
    expect(futureRegion).not.toMatch(/enqueueOnSkip/);
    // missed_learning_replay — replay cron 자체라 enqueue 대상 아님
    const replayRegion = extractCronOptions(src, 'missed_learning_replay');
    expect(replayRegion).not.toMatch(/enqueueOnSkip/);
  });

  // ─── 누적 카운트 검증 — 정확 5건 등장 (화이트리스트 일치) ──────────────────────

  it('11. learningJobs.ts 전체에 `enqueueOnSkip` 등장 정확히 5건 (5 학습 cron 만)', () => {
    const src = loadSource();
    const code = stripComments(src);
    const matches = code.match(/enqueueOnSkip/g) || [];
    expect(matches.length).toBe(5);
  });

  // ─── ADR-0176 주석 의무화 ────────────────────────────────────────────────────

  it('12. 5 학습 cron 본문에 ADR-0176 주석 명시 (운영자 추적성)', () => {
    const src = loadSource();
    // 본 PR 작성한 5 cron 모두 ADR-0176 주석 포함 (회귀 시 명확한 의도 추적)
    const matches = src.match(/ADR-0176/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(5);
  });

  // ─── KIS 주문 함수 import 0건 정적 가드 (학습 cron 본체 절대 규칙) ────────────

  it('13. learningJobs.ts 에 KIS 주문 함수 import 0건 (절대 규칙)', () => {
    const src = loadSource();
    const code = stripComments(src);
    // 학습 cron 은 LIVE 주문 호출 절대 금지 — fetchCurrentPrice (read-only) 만 허용
    expect(code).not.toMatch(/placeKisMarketOrder/);
    expect(code).not.toMatch(/placeKisSellOrder/);
    expect(code).not.toMatch(/cancelKisOrder/);
    expect(code).not.toMatch(/placeKisStopLossOrder/);
    expect(code).not.toMatch(/placeKisTakeProfitOrder/);
    // fetchCurrentPrice 는 학습 read-only 용도라 허용
    expect(code).toMatch(/fetchCurrentPrice/);
  });

  // ─── isMissedLearningQueueEnabled / replayMissedLearningJobs import 검증 ───

  it('14. learningJobs.ts 가 isMissedLearningQueueEnabled / replayMissedLearningJobs import (replay cron 자체)', () => {
    const src = loadSource();
    expect(src).toMatch(/isMissedLearningQueueEnabled/);
    expect(src).toMatch(/replayMissedLearningJobs/);
    expect(src).toMatch(/from ['"]\.\.\/learning\/missedLearningQueue\.js['"]/);
  });

  // ─── replay cron 정확 등록 검증 ──────────────────────────────────────────────

  it('15. missed_learning_replay cron 등록 — TRADING_DAY_ONLY + 30 0 * * 1-5 (KST 09:30)', () => {
    const src = loadSource();
    const code = stripComments(src);
    expect(code).toMatch(
      /scheduledJob\(\s*['"]30 0 \* \* 1-5['"]\s*,\s*['"]TRADING_DAY_ONLY['"]\s*,\s*['"]missed_learning_replay['"]/,
    );
  });
  it('16. future_return_resolve cron passes historical close priceFetcher', () => {
    const src = loadSource();
    const code = stripComments(src);
    const region = extractCronOptions(src, 'future_return_resolve');
    expect(code).toMatch(/fetchHistoricalClosePrice/);
    expect(region).toMatch(/resolveFutureReturns\s*\(\s*\{/);
    expect(region).toMatch(/priceFetcher\s*:/);
    expect(region).toMatch(/fetchHistoricalClosePrice\s*\(/);
    expect(region).not.toMatch(/resolveFutureReturns\s*\(\s*\)/);
    expect(region).not.toMatch(/fetchCurrentPrice\s*\(/);
  });
});
