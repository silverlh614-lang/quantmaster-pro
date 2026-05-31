// @vitest-environment jsdom
/**
 * @responsibility usePriceCanon hook 회귀 — Naver 정본 우선순위 + fallback + dedup
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePriceCanon } from './usePriceCanon';
import * as aiUniverseClient from '../api/aiUniverseClient';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('usePriceCanon — 가격 정본 hook', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Naver closePrice > 0 → source=NAVER, price 반환', async () => {
    vi.spyOn(aiUniverseClient, 'fetchAiUniverseSnapshot').mockResolvedValue({
      code: '000660',
      found: true,
      closePrice: 2_333_000,
      changeRate: 1.92,
      marketCap: 0,
      per: 0,
      pbr: 0,
      eps: 0,
      bps: 0,
      dividendYield: 0,
      foreignerOwnRatio: 0,
      source: 'NAVER_MOBILE',
    } as any);

    const { result } = renderHook(() => usePriceCanon('000660'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.price).toBe(2_333_000));
    expect(result.current.source).toBe('NAVER');
  });

  it('Naver 실패 + fallback KIS REALTIME → source=REALTIME, fallback 가격 반환', async () => {
    vi.spyOn(aiUniverseClient, 'fetchAiUniverseSnapshot').mockResolvedValue(null);

    const { result } = renderHook(
      () => usePriceCanon('005380', { fallbackPrice: 723_000, fallbackSource: 'REALTIME' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.price).toBe(723_000);
    expect(result.current.source).toBe('REALTIME');
  });

  it('Naver 실패 + fallback 없음 → price=null, source=NONE (UI 가 "갱신 중" 표시)', async () => {
    vi.spyOn(aiUniverseClient, 'fetchAiUniverseSnapshot').mockResolvedValue(null);

    const { result } = renderHook(() => usePriceCanon('078600'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.price).toBeNull();
    expect(result.current.source).toBe('NONE');
  });

  it('잘못된 코드 형식 (6자리 아님) → 호출 없이 즉시 NONE', async () => {
    const fetchSpy = vi.spyOn(aiUniverseClient, 'fetchAiUniverseSnapshot');

    const { result } = renderHook(() => usePriceCanon('abc'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.price).toBeNull();
    expect(result.current.source).toBe('NONE');
  });

  it('Naver closePrice=0 → source=NONE (fallback 도 없으면)', async () => {
    vi.spyOn(aiUniverseClient, 'fetchAiUniverseSnapshot').mockResolvedValue({
      code: '999999', found: true, closePrice: 0, changeRate: 0, marketCap: 0, per: 0, pbr: 0, eps: 0, bps: 0, dividendYield: 0, foreignerOwnRatio: 0, source: 'NAVER_MOBILE',
    } as any);

    const { result } = renderHook(() => usePriceCanon('999999'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.price).toBeNull();
    expect(result.current.source).toBe('NONE');
  });

  it('Naver 성공 + fallback 있음 → Naver 우선 (fallback 무시)', async () => {
    vi.spyOn(aiUniverseClient, 'fetchAiUniverseSnapshot').mockResolvedValue({
      code: '000660', found: true, closePrice: 2_333_000, changeRate: 0, marketCap: 0, per: 0, pbr: 0, eps: 0, bps: 0, dividendYield: 0, foreignerOwnRatio: 0, source: 'NAVER_MOBILE',
    } as any);

    const { result } = renderHook(
      () => usePriceCanon('000660', { fallbackPrice: 1_860_000, fallbackSource: 'REALTIME' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.price).toBe(2_333_000));
    expect(result.current.source).toBe('NAVER');
  });

  it('enabled=false → 호출 안 함', async () => {
    const fetchSpy = vi.spyOn(aiUniverseClient, 'fetchAiUniverseSnapshot');

    const { result } = renderHook(
      () => usePriceCanon('000660', { enabled: false }),
      { wrapper: makeWrapper() },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.current.price).toBeNull();
  });
});
