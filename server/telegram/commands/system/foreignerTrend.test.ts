/**
 * @responsibility foreignerTrend.cmd 회귀 테스트 — ADR-0140.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _computeForeignerRatioTrend = vi.fn();
const _loadForeignerRatioSeries = vi.fn();

vi.mock('../../../persistence/foreignerRatioRepo.js', () => ({
  computeForeignerRatioTrend: _computeForeignerRatioTrend,
  loadForeignerRatioSeries: _loadForeignerRatioSeries,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let foreignerTrend: typeof import('./foreignerTrend.cmd.js').default;
let buildForeignerTrendMessage: typeof import('./foreignerTrend.cmd.js').buildForeignerTrendMessage;

beforeEach(async () => {
  vi.resetModules();
  _computeForeignerRatioTrend.mockReset();
  _loadForeignerRatioSeries.mockReset();
  _loadForeignerRatioSeries.mockReturnValue([]);
  const mod = await import('./foreignerTrend.cmd.js');
  foreignerTrend = mod.default;
  buildForeignerTrendMessage = mod.buildForeignerTrendMessage;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildForeignerTrendMessage', () => {
  it('잘못된 코드 (빈 인자) → 사용법 안내', () => {
    const msg = buildForeignerTrendMessage([]);
    expect(msg).toContain('종목코드 입력 필요');
    expect(msg).toContain('/foreigner_trend 005930');
    expect(_computeForeignerRatioTrend).not.toHaveBeenCalled();
  });

  it('잘못된 코드 (5자리) → 사용법 안내', () => {
    const msg = buildForeignerTrendMessage(['12345']);
    expect(msg).toContain('종목코드 입력 필요');
  });

  it('영속 부재 (trend null) → 운영자 안내', () => {
    _computeForeignerRatioTrend.mockReturnValue(null);
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('영속 시계열 부재');
    expect(msg).toContain('운영자 안내');
    expect(msg).toContain('aiUniverseService');
    expect(msg).toContain('Naver Finance');
  });

  it('표본 5 (5d=null) → 수집 중 안내', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 51.0,
      changePct5d: null,
      changePct20d: null,
      sampleSize: 5,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('51.00%');
    expect(msg).toContain('5d 변화');
    expect(msg).toContain('수집 중');
    expect(msg).toContain('5/6');
  });

  it('표본 6 + 5d 양수 +2.5%p → 🟢 + 구조적 매수', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 53.5,
      changePct5d: 2.5,
      changePct20d: null,
      sampleSize: 6,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('🟢');
    expect(msg).toContain('+2.50%p');
    expect(msg).toContain('구조적 매수');
  });

  it('표본 6 + 5d 음수 -2.5%p → 🔴 + 구조적 이탈', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 48.5,
      changePct5d: -2.5,
      changePct20d: null,
      sampleSize: 6,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('🔴');
    expect(msg).toContain('-2.50%p');
    expect(msg).toContain('구조적 이탈');
  });

  it('표본 6 + 5d 소폭 +0.5%p → ⚪ + 소폭 변동', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 51.5,
      changePct5d: 0.5,
      changePct20d: null,
      sampleSize: 6,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('⚪');
    expect(msg).toContain('+0.50%p');
    expect(msg).toContain('소폭 변동');
  });

  it('표본 21+ → 5d + 20d 둘 다 활성', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 53.0,
      changePct5d: 1.5,
      changePct20d: 5.0,
      sampleSize: 21,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('5d 변화');
    expect(msg).toContain('+1.50%p');
    expect(msg).toContain('20d 변화');
    expect(msg).toContain('+5.00%p');
    expect(msg).not.toMatch(/20d 변화.*수집 중/);
  });

  it('20d 음수 (장기 외인 이탈)', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 48.0,
      changePct5d: -1.0,
      changePct20d: -3.5,
      sampleSize: 25,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('-3.50%p');
  });

  it('임계 안내 항상 표시 (영속 존재 시)', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 51.0,
      changePct5d: null,
      changePct20d: null,
      sampleSize: 1,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('임계 안내');
    expect(msg).toContain('+1');
    expect(msg).toContain('-1');
  });

  it('현재 보유율 + 최신 일자 + 누적 표본 표기', () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 51.234,
      changePct5d: null,
      changePct20d: null,
      sampleSize: 3,
      latestDate: '2026-04-29',
    });
    const msg = buildForeignerTrendMessage(['005930']);
    expect(msg).toContain('51.23%');  // 소수점 2자리
    expect(msg).toContain('2026-04-29');
    expect(msg).toContain('3일');
  });
});

describe('foreignerTrend.cmd execute', () => {
  it('정상 실행 — reply 호출 + 헤더', async () => {
    _computeForeignerRatioTrend.mockReturnValue({
      current: 51.0,
      changePct5d: 1.5,
      changePct20d: null,
      sampleSize: 6,
      latestDate: '2026-04-29',
    });
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await foreignerTrend.execute({ args: ['005930'], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0]?.[0] ?? '') as string).toContain('외인 보유율 추세');
  });

  it('throw → ❌ 실패 응답', async () => {
    _computeForeignerRatioTrend.mockImplementation(() => {
      throw new Error('disk error');
    });
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await foreignerTrend.execute({ args: ['005930'], reply });
    const msg = (reply.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('진단 실패');
  });

  it('빈 인자 → 사용법 안내 (computeTrend 호출 0)', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await foreignerTrend.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(_computeForeignerRatioTrend).not.toHaveBeenCalled();
  });
});

describe('foreignerTrend 메타데이터', () => {
  it('name=/foreigner_trend + alias=/ft + /fr', () => {
    expect(foreignerTrend.name).toBe('/foreigner_trend');
    expect(foreignerTrend.aliases).toEqual(['/ft', '/fr']);
  });

  it('SYS / riskLevel=0 / ADMIN', () => {
    expect(foreignerTrend.category).toBe('SYS');
    expect(foreignerTrend.riskLevel).toBe(0);
    expect(foreignerTrend.visibility).toBe('ADMIN');
  });

  it('description + usage 비어있지 않음', () => {
    expect(foreignerTrend.description.length).toBeGreaterThan(10);
    expect(foreignerTrend.usage).toContain('/foreigner_trend');
  });
});
