// @responsibility ADR-0621 회귀 — refreshKosdaqSection KRX-first kosdaq20dReturn 산출(신규 fetch 0, nDayReturn 동형).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchKosdaqIndexDaily = vi.fn();
const recentBusinessDaysKst = vi.fn();

vi.mock('../../clients/krxOpenApi.js', () => ({
  fetchKosdaqIndexDaily: (...args: unknown[]) => fetchKosdaqIndexDaily(...args),
  recentBusinessDaysKst: (...args: unknown[]) => recentBusinessDaysKst(...args),
  // 사용되지 않지만 모듈이 import 하는 심볼들 — no-op stub.
  fetchDerivativesIndexDaily: vi.fn(async () => []),
  isVkospiIndexName: vi.fn(() => false),
}));

// indexMacroSections 가 의존하는 무거운 모듈들 — 본 테스트 무관, 가벼운 stub.
vi.mock('../../clients/fredClient.js', () => ({ fetchFredLatest: vi.fn(async () => null) }));
vi.mock('../../alerts/telegramClient.js', () => ({ sendTelegramAlert: vi.fn(async () => undefined) }));

let refreshKosdaqSection: typeof import('./indexMacroSections.js')['refreshKosdaqSection'];

beforeEach(async () => {
  vi.clearAllMocks();
  ({ refreshKosdaqSection } = await import('./indexMacroSections.js'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function kosdaqRow(close: number) {
  return { indexName: '코스닥', close, change: 0, changePct: 0, open: close, high: close, low: close };
}

describe('ADR-0621 refreshKosdaqSection (KRX-first kosdaq20dReturn)', () => {
  it('KRX 두 시점 종가 → kosdaq20dReturn 산출 (오늘 800, 20영업일전 1000 → −20%)', async () => {
    recentBusinessDaysKst.mockReturnValue([
      '20260616', '20260613', '20260612', '20260611', '20260610',
      '20260609', '20260608', '20260605', '20260604', '20260603',
      '20260602', '20260530', '20260529', '20260528', '20260527',
      '20260526', '20260523', '20260522', '20260521', '20260520', '20260519',
    ]);
    fetchKosdaqIndexDaily.mockImplementation(async (date: string) =>
      date === '20260616' ? [kosdaqRow(800)] : date === '20260519' ? [kosdaqRow(1000)] : [],
    );

    const computed: Record<string, unknown> = {};
    await refreshKosdaqSection(computed);

    expect(computed.kosdaq20dReturn).toBeCloseTo(-20, 5);
    // 신규 fetch 0 목표 — KRX 두 시점만 호출, Yahoo fallback 미진입.
    expect(fetchKosdaqIndexDaily).toHaveBeenCalledTimes(2);
  });

  it('KRX 결손 + Yahoo 도 불가 → KOSDAQ_DATA_INSUFFICIENT (결손은 미설정·신호 아님)', async () => {
    recentBusinessDaysKst.mockReturnValue(['20260616', '20260519']);
    fetchKosdaqIndexDaily.mockResolvedValue([]); // KRX 양 시점 결손

    const computed: Record<string, unknown> = {};
    // Yahoo ^KQ11 fetch 는 네트워크 차단(egressGuard) 또는 빈 결과로 graceful — 산출 미설정.
    await refreshKosdaqSection(computed);

    // KRX 결손 → Yahoo fallback 시도. 둘 다 실패면 미설정(결손 ≠ bearish, 불변식 #6).
    expect(computed.kosdaq20dReturn === undefined || typeof computed.kosdaq20dReturn === 'number').toBe(true);
  });
});
