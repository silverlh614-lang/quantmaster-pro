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

describe('PctChangeMode + MODE_LIMITS (ADR-0028 §모드 분기)', () => {
  // 늦은 import — 본 describe 가 추가되기 전에 위 describe 가 import 한 모듈 그대로 재사용.
  // 단 신규 export 인 resolveSanityBound / MODE_LIMITS 는 별도 import 필요.

  it('MODE_LIMITS 5 모드 임계 SSOT 정합', async () => {
    const { MODE_LIMITS } = await import('./safePctChange.js');
    expect(MODE_LIMITS.SANITY_ONLY).toBe(90);
    expect(MODE_LIMITS.INTRADAY).toBe(30);
    expect(MODE_LIMITS.DAILY).toBe(50);
    expect(MODE_LIMITS.RECOMMENDATION_RETURN).toBe(300);
    expect(MODE_LIMITS.LONG_TERM).toBe(1000);
  });

  it('resolveSanityBound — opts 빈 객체 시 default 90', async () => {
    const { resolveSanityBound } = await import('./safePctChange.js');
    expect(resolveSanityBound({})).toBe(90);
  });

  it('resolveSanityBound — sanityBoundPct 명시 시 그 값 (mode 무시)', async () => {
    const { resolveSanityBound } = await import('./safePctChange.js');
    // 우선순위 1: sanityBoundPct (mode 동시 명시되어도 sanityBoundPct 우선)
    expect(resolveSanityBound({ sanityBoundPct: 1000 })).toBe(1000);
    expect(resolveSanityBound({ sanityBoundPct: 1000, mode: 'INTRADAY' })).toBe(1000);
  });

  it('resolveSanityBound — mode 만 명시 시 MODE_LIMITS[mode]', async () => {
    const { resolveSanityBound } = await import('./safePctChange.js');
    expect(resolveSanityBound({ mode: 'INTRADAY' })).toBe(30);
    expect(resolveSanityBound({ mode: 'DAILY' })).toBe(50);
    expect(resolveSanityBound({ mode: 'RECOMMENDATION_RETURN' })).toBe(300);
    expect(resolveSanityBound({ mode: 'LONG_TERM' })).toBe(1000);
    expect(resolveSanityBound({ mode: 'SANITY_ONLY' })).toBe(90);
  });

  it('resolveSanityBound — sanityBoundPct=NaN 또는 Infinity 시 mode/default fallback', async () => {
    const { resolveSanityBound } = await import('./safePctChange.js');
    expect(resolveSanityBound({ sanityBoundPct: NaN, mode: 'LONG_TERM' })).toBe(1000);
    expect(resolveSanityBound({ sanityBoundPct: Infinity })).toBe(90);
    expect(resolveSanityBound({ sanityBoundPct: NaN })).toBe(90);
  });

  it('safePctChange — INTRADAY 모드 +35% 차단 (상한가 초과)', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    // 100 → 135 = +35% 정상 통과되던 SANITY_ONLY → INTRADAY 30% 적용 시 차단
    const r = safePctChange(135, 100, { mode: 'INTRADAY', silent: true });
    expect(r).toBeNull();
  });

  it('safePctChange — INTRADAY 모드 +25% 통과 (상한가 이내)', async () => {
    const { safePctChange } = await import('./safePctChange.js');
    expect(safePctChange(125, 100, { mode: 'INTRADAY' })).toBeCloseTo(25, 5);
  });

  it('safePctChange — RECOMMENDATION_RETURN 모드 +200% 통과 (테마주 정상)', async () => {
    const { safePctChange } = await import('./safePctChange.js');
    // 사용자 보고 시나리오: 5일 +135% (정상 테마주 폭등 또는 stale base 의심)
    // RECOMMENDATION_RETURN 300% 적용 시 통과 → 호출자 단계에서 stale 별도 검증
    expect(safePctChange(235, 100, { mode: 'RECOMMENDATION_RETURN' })).toBeCloseTo(135, 5);
  });

  it('safePctChange — RECOMMENDATION_RETURN 모드 +400% 차단 (자릿수 mismatch 의심)', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    expect(safePctChange(500, 100, { mode: 'RECOMMENDATION_RETURN', silent: true })).toBeNull();
  });

  it('safePctChange — LONG_TERM 모드 +500% 통과 / +1500% 차단', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    expect(safePctChange(600, 100, { mode: 'LONG_TERM' })).toBeCloseTo(500, 5);
    expect(safePctChange(1600, 100, { mode: 'LONG_TERM', silent: true })).toBeNull();
  });

  it('safePctChange — DAILY 모드 +60% 차단 (전일 갭 + 상한가 초과)', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    expect(safePctChange(160, 100, { mode: 'DAILY', silent: true })).toBeNull();
  });

  it('safePctChange — DAILY 모드 +45% 통과', async () => {
    const { safePctChange } = await import('./safePctChange.js');
    expect(safePctChange(145, 100, { mode: 'DAILY' })).toBeCloseTo(45, 5);
  });

  it('후방호환 — mode 미명시 + sanityBoundPct 미명시 → 기존 동작 (90% default)', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    expect(safePctChange(150, 100, { silent: true })).toBeCloseTo(50, 5); // +50% 통과
    expect(safePctChange(195, 100, { silent: true })).toBeNull();          // +95% 차단
    expect(safePctChange(189, 100)).toBeCloseTo(89, 5);                    // +89% 통과
  });

  it('후방호환 — sectorEnergyProvider 의 sanityBoundPct=1000 override 정확 동작', async () => {
    const { safePctChange } = await import('./safePctChange.js');
    // 거래량 +500% 같은 정상 폭증 통과
    expect(safePctChange(600, 100, { sanityBoundPct: 1000 })).toBeCloseTo(500, 5);
  });

  it('우선순위 — sanityBoundPct=50 + mode=LONG_TERM 동시 명시 → sanityBoundPct 우선 (50%)', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    // mode 만 보면 LONG_TERM 1000% 통과되어야 하지만 sanityBoundPct=50 우선 적용
    expect(safePctChange(160, 100, { sanityBoundPct: 50, mode: 'LONG_TERM', silent: true })).toBeNull();
  });

  it('진단 로그 — mode 적용 시 위반 메시지에 모드별 임계 표시', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    __resetSafePctChangeWarnsForTests();
    safePctChange(135, 100, { mode: 'INTRADAY', label: 'INTRADAY-test:CODE' });
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = String(warnSpy.mock.calls[0]![0]);
    expect(msg).toContain('INTRADAY-test:CODE');
    expect(msg).toContain('30%'); // INTRADAY 임계
    warnSpy.mockRestore();
  });

  it('사용자 보고 시나리오 — 5일 수익률 +135% (테마주) RECOMMENDATION_RETURN 통과 검증', async () => {
    const { safePctChange } = await import('./safePctChange.js');
    // 005070.KQ 사용자 보고: current=139900, base=59300 → +135.92%
    // 기존 SANITY_ONLY 90% → 차단됐음. RECOMMENDATION_RETURN 300% → 통과
    const r = safePctChange(139900, 59300, { mode: 'RECOMMENDATION_RETURN' });
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(135.92, 1);
  });

  it('사용자 보고 시나리오 — 20일 수익률 +166% RECOMMENDATION_RETURN 통과 검증', async () => {
    const { safePctChange } = await import('./safePctChange.js');
    // 005070.KQ: current=139900, base=52400 → +166.98%
    const r = safePctChange(139900, 52400, { mode: 'RECOMMENDATION_RETURN' });
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(166.98, 1);
  });

  it('사용자 보고 시나리오 — 자릿수 mismatch +1000% 는 RECOMMENDATION_RETURN 도 차단', async () => {
    const { safePctChange, __resetSafePctChangeWarnsForTests } = await import('./safePctChange.js');
    __resetSafePctChangeWarnsForTests();
    // 자릿수 mismatch (1399 vs 139900) 같은 진짜 비정상 케이스
    const r = safePctChange(139900, 1399, { mode: 'RECOMMENDATION_RETURN', silent: true });
    expect(r).toBeNull();
  });
});
