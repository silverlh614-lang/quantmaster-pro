// @responsibility ADR-0111 — circuitBreaker baseline reset 후 즉시 재발동 차단 hotfix.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * 사용자 4/30 보고: /reset 후 다음 5분 cron tick (10:30:09) 에 즉시 재발동.
 * 원인: countRecentConsecutiveLosses 가 *동일한 4시간 안 손절* 을 다시 카운트.
 * 수정: clearCircuitBreaker 시 baseline 시각 영속 → 카운터가 그 시각 이후만.
 */

let tmpDir: string;
const origDataDir = process.env.PERSIST_DATA_DIR;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuit-baseline-'));
  process.env.PERSIST_DATA_DIR = tmpDir;
  vi.resetModules();
});

afterEach(() => {
  if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
  else process.env.PERSIST_DATA_DIR = origDataDir;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ADR-0111 — circuitBreakerClearedAt baseline 영속', () => {
  it('clearCircuitBreaker 시 circuitBreakerClearedAt ISO 영속', async () => {
    const { clearCircuitBreaker, getCircuitBreakerClearedAt } = await import(
      '../learning/learningState.js'
    );
    expect(getCircuitBreakerClearedAt()).toBeNull();
    clearCircuitBreaker();
    const cleared = getCircuitBreakerClearedAt();
    expect(cleared).not.toBeNull();
    expect(Date.parse(cleared!)).toBeGreaterThan(Date.now() - 5000);
  });

  it('clearCircuitBreaker 가 trippedAt 도 함께 null', async () => {
    const { tripCircuitBreaker, clearCircuitBreaker, getCircuitBreakerTrippedAt } = await import(
      '../learning/learningState.js'
    );
    tripCircuitBreaker();
    expect(getCircuitBreakerTrippedAt()).not.toBeNull();
    clearCircuitBreaker();
    expect(getCircuitBreakerTrippedAt()).toBeNull();
  });

  it('두 번째 clearCircuitBreaker 시 baseline 갱신', async () => {
    const { clearCircuitBreaker, getCircuitBreakerClearedAt } = await import(
      '../learning/learningState.js'
    );
    clearCircuitBreaker();
    const first = getCircuitBreakerClearedAt();
    await new Promise((r) => setTimeout(r, 10));
    clearCircuitBreaker();
    const second = getCircuitBreakerClearedAt();
    expect(Date.parse(second!)).toBeGreaterThanOrEqual(Date.parse(first!));
  });
});

describe('ADR-0111 — countRecentConsecutiveLosses baseline 적용', () => {
  function makeShadow(exitTime: string, status: 'HIT_STOP' | 'HIT_TARGET'): unknown {
    return { exitTime, status };
  }

  it('clearedAt 이전 손절은 무시 — 사용자 4/30 시나리오', async () => {
    const { clearCircuitBreaker } = await import('../learning/learningState.js');
    const { countRecentConsecutiveLosses } = await import('./shadowResolverJob.js');
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const twoHourAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const threeHourAgo = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    clearCircuitBreaker();  // baseline = now
    const shadows = [
      makeShadow(oneHourAgo, 'HIT_STOP'),
      makeShadow(twoHourAgo, 'HIT_STOP'),
      makeShadow(threeHourAgo, 'HIT_STOP'),
    ] as never;
    expect(countRecentConsecutiveLosses(shadows)).toBe(0);  // 모두 baseline 이전
  }, 10_000);

  it('clearedAt 이후 손절만 카운트', async () => {
    const { clearCircuitBreaker } = await import('../learning/learningState.js');
    const { countRecentConsecutiveLosses } = await import('./shadowResolverJob.js');
    clearCircuitBreaker();
    await new Promise((r) => setTimeout(r, 5));
    const justNow = new Date().toISOString();
    const shadows = [
      makeShadow(justNow, 'HIT_STOP'),
    ] as never;
    expect(countRecentConsecutiveLosses(shadows)).toBe(1);
  });

  it('clearedAt 부재 시 기존 4시간 윈도우 동작 (회귀 차단)', async () => {
    // clearCircuitBreaker 한 번도 호출 안 됨 — circuitBreakerClearedAt = null
    const { countRecentConsecutiveLosses } = await import('./shadowResolverJob.js');
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const shadows = [
      makeShadow(oneHourAgo, 'HIT_STOP'),
    ] as never;
    expect(countRecentConsecutiveLosses(shadows)).toBe(1);  // 4시간 안이라 카운트
  });

  it('5시간 전 손절은 baseline 무관하게 무시 (4시간 윈도우 유지)', async () => {
    const { countRecentConsecutiveLosses } = await import('./shadowResolverJob.js');
    const fiveHourAgo = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    const shadows = [
      makeShadow(fiveHourAgo, 'HIT_STOP'),
    ] as never;
    expect(countRecentConsecutiveLosses(shadows)).toBe(0);
  });

  it('clearedAt 이후 + HIT_TARGET 으로 끊기면 0 (연속 끊김)', async () => {
    const { clearCircuitBreaker } = await import('../learning/learningState.js');
    const { countRecentConsecutiveLosses } = await import('./shadowResolverJob.js');
    clearCircuitBreaker();
    await new Promise((r) => setTimeout(r, 5));
    const t1 = new Date(Date.now() + 1).toISOString();
    const t2 = new Date(Date.now() + 2).toISOString();
    const t3 = new Date(Date.now() + 3).toISOString();
    const shadows = [
      makeShadow(t3, 'HIT_TARGET'),  // 가장 최근 = 익절 → 연속 끊김
      makeShadow(t2, 'HIT_STOP'),
      makeShadow(t1, 'HIT_STOP'),
    ] as never;
    expect(countRecentConsecutiveLosses(shadows)).toBe(0);
  });
});

describe('ADR-0111 — reset.cmd 응답 메시지 baseline 안내', () => {
  it('reset.cmd.ts 응답에 ADR-0111 안내 텍스트 포함', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'server/telegram/commands/control/reset.cmd.ts'),
      'utf-8',
    );
    expect(src).toContain('손절 카운터 baseline 리셋');
    expect(src).toContain('ADR-0111');
  });
});
