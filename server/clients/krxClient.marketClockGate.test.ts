/**
 * @responsibility krxClient 장외·통계확정 게이트 회귀 — ADR-0009 KRX 날짜 후퇴 정책
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchInvestorTrading,
  fetchPerPbr,
  fetchShortBalance,
  resetKrxCache,
} from './krxClient.js';

// 2026-04-24 (금요일) 기준 시나리오:
//   KST 17:00 → UTC 08:00 — 통계 미확정 → 직전 영업일(목 2026-04-23) 후퇴
//   KST 19:00 → UTC 10:00 — 통계 확정 → 오늘 20260424
//   2026-04-25 (토) 10:00 KST → 직전 영업일 금 20260424
const FRI_1700_KST = new Date('2026-04-24T08:00:00.000Z');
const FRI_1900_KST = new Date('2026-04-24T10:00:00.000Z');
const SAT_1000_KST = new Date('2026-04-25T01:00:00.000Z');

describe('krxClient — ADR-0009 통계 확정 게이트', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let capturedBody: string | null;

  beforeEach(() => {
    resetKrxCache();
    capturedBody = null;
    delete process.env.DATA_FETCH_FORCE_MARKET;
    delete process.env.DATA_FETCH_FORCE_OFF;
    delete process.env.KRX_API_DISABLED;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init!.body : null;
      return new Response(JSON.stringify({ OutBlock_1: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
    delete process.env.DATA_FETCH_FORCE_MARKET;
    delete process.env.DATA_FETCH_FORCE_OFF;
    delete process.env.KRX_API_DISABLED;
  });

  it('평일 17:00 KST + date 생략 → 직전 영업일(20260423) 사용', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_1700_KST);
    await fetchInvestorTrading();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedBody).toContain('strtDd=20260423');
    expect(capturedBody).toContain('endDd=20260423');
  });

  it('평일 19:00 KST + date 생략 → 오늘(20260424) 사용', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_1900_KST);
    await fetchPerPbr();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedBody).toContain('trdDd=20260424');
  });

  it('주말(토) → 직전 영업일(금 20260424) 후퇴', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SAT_1000_KST);
    await fetchShortBalance();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(capturedBody).toContain('trdDd=20260424');
  });

  it('수동 date 인자가 있으면 게이트 우회(백필/디버깅 경로)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_1700_KST);
    await fetchInvestorTrading('20260101');
    expect(capturedBody).toContain('strtDd=20260101');
    expect(capturedBody).toContain('endDd=20260101');
  });

  it('bld 연속 5회 실패 → 1시간 soft cooldown (6번째 호출은 네트워크 skip)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FRI_1900_KST);
    // fetch 를 매번 HTTP 400 으로 응답하도록 교체
    fetchSpy.mockImplementation(async () =>
      new Response('bad', { status: 400, headers: { 'Content-Type': 'text/plain' } }),
    );
    // 5회 실패 유도 — 날짜를 다르게 해서 캐시 무시
    for (let i = 0; i < 5; i++) {
      await fetchInvestorTrading(`2026040${i + 1}`);
    }
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    // 6번째 호출은 cooldown 으로 실제 fetch 없이 빈 배열 반환
    const out = await fetchInvestorTrading('20260410');
    expect(out).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});
