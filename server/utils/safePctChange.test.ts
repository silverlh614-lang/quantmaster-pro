/**
 * safePctChange.test.ts — ADR-0028 회귀 가드.
 *
 * 사용자 보고: "역산갭 GDR 오류 — 과거 데이터가 기준이 되어 -90% 가 넘는 상황도 있었음."
 * 본 테스트는 5종 가드 (분모/분자/NaN/sanity/throttle) 가 모두 작동하는지 검증.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  safePctChange,
  isSanePct,
  __resetSafePctChangeWarnsForTests,
} from './safePctChange.js';

describe('safePctChange — ADR-0028 sanity bound + 5종 가드', () => {
  beforeEach(() => {
    __resetSafePctChangeWarnsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('정상 케이스 — +5% 변화율 정확 계산', () => {
    expect(safePctChange(105, 100)).toBe(5);
  });

  it('정상 케이스 — -3% 변화율 정확 계산', () => {
    const result = safePctChange(97, 100);
    expect(result).not.toBeNull();
    expect(result).toBeCloseTo(-3, 5);
  });

  it('분모 가드 — base=0 시 null', () => {
    expect(safePctChange(100, 0)).toBeNull();
  });

  it('분모 가드 — base 음수 시 null', () => {
    expect(safePctChange(100, -50)).toBeNull();
  });

  it('분모 가드 — base NaN 시 null', () => {
    expect(safePctChange(100, NaN)).toBeNull();
  });

  it('분모 가드 — base Infinity 시 null', () => {
    expect(safePctChange(100, Infinity)).toBeNull();
  });

  it('분자 가드 — current 음수 시 null (음수 가격은 데이터 오류)', () => {
    expect(safePctChange(-10, 100)).toBeNull();
  });

  it('분자 가드 — current NaN 시 null', () => {
    expect(safePctChange(NaN, 100)).toBeNull();
  });

  it('분자 가드 — current Infinity 시 null', () => {
    expect(safePctChange(Infinity, 100)).toBeNull();
  });

  it('current=0 은 정상 (분자 가드 통과) — -100% 이지만 sanity 위반으로 null', () => {
    // current=0 자체는 가능 (모든 자산 청산)이지만 -100% 는 sanity 위반.
    expect(safePctChange(0, 100)).toBeNull();
  });

  it('current=0 + sanity bound 100 시 -100% 정상 반환', () => {
    expect(safePctChange(0, 100, { sanityBoundPct: 100 })).toBe(-100);
  });

  it('Sanity bound 위반 — -93.69% (ADR-0004 PKX 케이스) → null', () => {
    // 100,000원 → 6,310원 (Yahoo OTC 상장폐지 ADR 종가)
    expect(safePctChange(6310, 100_000)).toBeNull();
  });

  it('Sanity bound 위반 — +500% → null', () => {
    expect(safePctChange(600, 100)).toBeNull();
  });

  it('Sanity bound 경계 +90% — 통과', () => {
    expect(safePctChange(190, 100)).toBe(90);
  });

  it('Sanity bound 경계 +90.01% — null', () => {
    expect(safePctChange(190.02, 100)).toBeNull();
  });

  it('Sanity bound override — 50% 임계로 강화', () => {
    expect(safePctChange(170, 100, { sanityBoundPct: 50 })).toBeNull();
    expect(safePctChange(140, 100, { sanityBoundPct: 50 })).toBe(40);
  });

  it('진단 로그 — sanity 위반 시 console.warn 호출 + label 포함', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChange(6310, 100_000, { label: 'gapProbe:005930' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('gapProbe:005930');
    expect(warnSpy.mock.calls[0][0]).toContain('sanity 위반');
    warnSpy.mockRestore();
  });

  it('진단 로그 throttle — 60초 내 동일 label 1회만 출력', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChange(6310, 100_000, { label: 'throttle-test' });
    safePctChange(7000, 100_000, { label: 'throttle-test' });
    safePctChange(8000, 100_000, { label: 'throttle-test' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('진단 로그 throttle — 다른 label 은 각각 1회 출력', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChange(6310, 100_000, { label: 'gapA' });
    safePctChange(6310, 100_000, { label: 'gapB' });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it('silent 옵션 — sanity 위반 시 로그 출력 차단', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChange(6310, 100_000, { label: 'silent-test', silent: true });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('label 미전달 — "unknown" 라벨로 출력', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    safePctChange(6310, 100_000);
    expect(warnSpy.mock.calls[0][0]).toContain('@unknown');
    warnSpy.mockRestore();
  });

  it('동일 base/current — 0% 정상 반환 (stale 데이터 패턴)', () => {
    // closes 배열이 같은 stale value 5번 반환되는 케이스 — 0% 자체는 안전.
    expect(safePctChange(50_000, 50_000)).toBe(0);
  });
});

describe('isSanePct — 후처리 sanity 검증 헬퍼', () => {
  it('정상 범위 +5% true', () => {
    expect(isSanePct(5)).toBe(true);
  });

  it('정상 범위 -89% true', () => {
    expect(isSanePct(-89)).toBe(true);
  });

  it('경계 ±90% true', () => {
    expect(isSanePct(90)).toBe(true);
    expect(isSanePct(-90)).toBe(true);
  });

  it('초과 +90.01% false', () => {
    expect(isSanePct(90.01)).toBe(false);
  });

  it('NaN false', () => {
    expect(isSanePct(NaN)).toBe(false);
  });

  it('Infinity false', () => {
    expect(isSanePct(Infinity)).toBe(false);
  });

  it('override sanity bound 50% 적용', () => {
    expect(isSanePct(40, 50)).toBe(true);
    expect(isSanePct(60, 50)).toBe(false);
  });
});
