/**
 * @responsibility programToday.cmd 회귀 테스트 — ADR-0137
 *
 * 검증:
 *   - buildProgramTodayMessage: 양수/음수/0/null 응답 + 비중 null + 잘못된 코드 분기
 *   - cmd execute: 정상 / throw graceful
 *   - 메타데이터: name + aliases (/prog) + category=SYS + riskLevel=0 + visibility=ADMIN
 *   - 절대 규칙: realDataKisGet SSOT 위임 — 직접 raw fetch 0건
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _fetchKisStockProgramTrade = vi.fn();

vi.mock('../../../clients/kisClient/index.js', () => ({
  fetchKisStockProgramTrade: _fetchKisStockProgramTrade,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let programToday: typeof import('./programToday.cmd.js').default;
let buildProgramTodayMessage: typeof import('./programToday.cmd.js').buildProgramTodayMessage;

beforeEach(async () => {
  vi.resetModules();
  _fetchKisStockProgramTrade.mockReset();
  const mod = await import('./programToday.cmd.js');
  programToday = mod.default;
  buildProgramTodayMessage = mod.buildProgramTodayMessage;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildProgramTodayMessage', () => {
  it('잘못된 코드 (빈 인자) → 사용법 안내', async () => {
    const msg = await buildProgramTodayMessage([]);
    expect(msg).toContain('종목코드 입력 필요');
    expect(msg).toContain('/program_today 005930');
    expect(_fetchKisStockProgramTrade).not.toHaveBeenCalled();
  });

  it('잘못된 코드 (5자리 숫자) → 사용법 안내', async () => {
    const msg = await buildProgramTodayMessage(['12345']);
    expect(msg).toContain('종목코드 입력 필요');
    expect(_fetchKisStockProgramTrade).not.toHaveBeenCalled();
  });

  it('잘못된 코드 (영문 혼합) → 사용법 안내', async () => {
    const msg = await buildProgramTodayMessage(['ABC123']);
    expect(msg).toContain('종목코드 입력 필요');
    expect(_fetchKisStockProgramTrade).not.toHaveBeenCalled();
  });

  it('KIS 응답 null → 운영자 안내 4종 표시', async () => {
    _fetchKisStockProgramTrade.mockResolvedValue(null);
    const msg = await buildProgramTodayMessage(['005930']);
    expect(msg).toContain('데이터 수집 실패');
    expect(msg).toContain('운영자 안내');
    expect(msg).toContain('KIS_APP_KEY');
    expect(msg).toContain('회로차단');
    expect(msg).toContain('TR ID');
    expect(msg).toContain('비상장');
  });

  it('정상 양수 (프로그램 순매수) → 🟢 + 양수 부호 + 비중 표기', async () => {
    _fetchKisStockProgramTrade.mockResolvedValue({
      stockCode: '005930',
      programNetBuyQty: 1500,
      programNetBuyAmount: 120_000_000,
      programBuyRatio: 15.5,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    const msg = await buildProgramTodayMessage(['005930']);
    expect(msg).toContain('🟢');
    expect(msg).toContain('프로그램 순매수');
    expect(msg).toContain('+1,500주');
    expect(msg).toContain('+1.2억원');
    expect(msg).toContain('15.50%');
    expect(msg).toContain('005930');
  });

  it('정상 음수 (프로그램 순매도) → 🔴 + 음수 부호', async () => {
    _fetchKisStockProgramTrade.mockResolvedValue({
      stockCode: '035420',
      programNetBuyQty: -3000,
      programNetBuyAmount: -240_000_000,
      programBuyRatio: 5.5,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    const msg = await buildProgramTodayMessage(['035420']);
    expect(msg).toContain('🔴');
    expect(msg).toContain('프로그램 순매도');
    expect(msg).toContain('-3,000주');
    expect(msg).toContain('-2.4억원');
  });

  it('정상 0 (중립) → ⚪ + 0주', async () => {
    _fetchKisStockProgramTrade.mockResolvedValue({
      stockCode: '005930',
      programNetBuyQty: 0,
      programNetBuyAmount: 0,
      programBuyRatio: 0,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    const msg = await buildProgramTodayMessage(['005930']);
    expect(msg).toContain('⚪');
    expect(msg).toContain('중립');
    expect(msg).toContain('0주');
    expect(msg).toContain('0억원');
  });

  it('programBuyRatio null → 미수집 표기', async () => {
    _fetchKisStockProgramTrade.mockResolvedValue({
      stockCode: '005930',
      programNetBuyQty: 1000,
      programNetBuyAmount: 80_000_000,
      programBuyRatio: null,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    const msg = await buildProgramTodayMessage(['005930']);
    expect(msg).toContain('미수집');
    expect(msg).toContain('KIS 응답 부재');
    // 비중 % 표기 미노출
    expect(msg).not.toMatch(/[0-9.]+%/);
  });

  it('출처 + 응답 시각 KST 표기', async () => {
    _fetchKisStockProgramTrade.mockResolvedValue({
      stockCode: '005930',
      programNetBuyQty: 100,
      programNetBuyAmount: 8_000_000,
      programBuyRatio: 5.0,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    const msg = await buildProgramTodayMessage(['005930']);
    expect(msg).toContain('KIS_API');
    // KST 시각 (UTC 03:00 → KST 12:00) — locale 형식 다양성 회피로 시각 영역 존재만 검증
    expect(msg).toContain('응답 시각');
  });
});

describe('programToday.cmd execute', () => {
  it('정상 실행 시 reply 한 번 호출 + 진단 헤더 포함', async () => {
    _fetchKisStockProgramTrade.mockResolvedValue({
      stockCode: '005930',
      programNetBuyQty: 100,
      programNetBuyAmount: 8_000_000,
      programBuyRatio: 5.0,
      fetchedAt: '2026-05-01T03:00:00.000Z',
      source: 'KIS_API',
    });
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await programToday.execute({ args: ['005930'], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0]?.[0] ?? '') as string).toContain('종목별 프로그램 매매');
  });

  it('fetchKisStockProgramTrade throw 시 ❌ 실패 응답', async () => {
    _fetchKisStockProgramTrade.mockRejectedValue(new Error('KIS 회로차단'));
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await programToday.execute({ args: ['005930'], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    const msg = (reply.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('진단 실패');
  });

  it('빈 인자 → 사용법 안내 (KIS 호출 0건)', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await programToday.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(_fetchKisStockProgramTrade).not.toHaveBeenCalled();
  });
});

describe('programToday 메타데이터', () => {
  it('name=/program_today + alias=/prog', () => {
    expect(programToday.name).toBe('/program_today');
    expect(programToday.aliases).toEqual(['/prog']);
  });

  it('category=SYS + riskLevel=0 (read-only KIS 1회) + visibility=ADMIN', () => {
    expect(programToday.category).toBe('SYS');
    expect(programToday.riskLevel).toBe(0);
    expect(programToday.visibility).toBe('ADMIN');
  });

  it('description + usage 비어있지 않음', () => {
    expect(programToday.description.length).toBeGreaterThan(10);
    expect(programToday.usage).toContain('/program_today');
  });
});
