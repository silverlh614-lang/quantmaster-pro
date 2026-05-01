/**
 * @responsibility fssDetail.cmd 회귀 테스트 — ADR-0141 Stage 1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _getLatestFssDetailRecord = vi.fn();
const _getFssDetailRecord = vi.fn();
const _loadFssDetailRecords = vi.fn();

vi.mock('../../../persistence/fssDetailRepo.js', () => ({
  getLatestFssDetailRecord: _getLatestFssDetailRecord,
  getFssDetailRecord: _getFssDetailRecord,
  loadFssDetailRecords: _loadFssDetailRecords,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let fssDetail: typeof import('./fssDetail.cmd.js').default;
let buildFssDetailMessage: typeof import('./fssDetail.cmd.js').buildFssDetailMessage;

beforeEach(async () => {
  vi.resetModules();
  _getLatestFssDetailRecord.mockReset();
  _getFssDetailRecord.mockReset();
  _loadFssDetailRecords.mockReset();
  _loadFssDetailRecords.mockReturnValue([]);
  const mod = await import('./fssDetail.cmd.js');
  fssDetail = mod.default;
  buildFssDetailMessage = mod.buildFssDetailMessage;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildFssDetailMessage', () => {
  it('잘못된 일자 형식 → 사용법 안내', () => {
    const msg = buildFssDetailMessage(['invalid-date']);
    expect(msg).toContain('일자 형식 오류');
    expect(msg).toContain('YYYY-MM-DD');
    expect(_getLatestFssDetailRecord).not.toHaveBeenCalled();
    expect(_getFssDetailRecord).not.toHaveBeenCalled();
  });

  it('인자 없음 + 영속 부재 → 운영자 안내 (cron + ENV + BLD ID)', () => {
    _getLatestFssDetailRecord.mockReturnValue(null);
    _loadFssDetailRecords.mockReturnValue([]);
    const msg = buildFssDetailMessage([]);
    expect(msg).toContain('영속 시계열 부재');
    expect(msg).toContain('marketDataRefresh cron');
    expect(msg).toContain('FSS_DETAIL_FETCHER_DISABLED');
    expect(msg).toContain('KRX_BLD_INVESTOR_DETAIL');
    expect(msg).toContain('MDCSTAT02301');
  });

  it('일자 인자 + 부재 → 일자별 안내', () => {
    _getFssDetailRecord.mockReturnValue(null);
    _loadFssDetailRecords.mockReturnValue([]);
    const msg = buildFssDetailMessage(['2026-04-29']);
    expect(msg).toContain('영속 시계열 부재');
    expect(msg).toContain('해당 일자(2026-04-29)');
    expect(msg).toContain('30영업일 trim');
  });

  it('정상 — 11 카테고리 raw 표기 + 거래대금 내림차순', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '2026-04-29T07:00:00.000Z',
      rows: [
        { category: '금융투자', netBuyQty: -50000, netBuyKrw: -2_500_000_000 },
        { category: '외국인', netBuyQty: 100000, netBuyKrw: 5_000_000_000 },
        { category: '연기금 등', netBuyQty: 30000, netBuyKrw: 1_500_000_000 },
      ],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const msg = buildFssDetailMessage([]);
    expect(msg).toContain('2026-04-29');
    expect(msg).toContain('11 카테고리 순매수');
    expect(msg).toContain('외국인');
    expect(msg).toContain('+50.0억원');
    expect(msg).toContain('🟢');
    expect(msg).toContain('금융투자');
    expect(msg).toContain('-25.0억원');
    expect(msg).toContain('🔴');
    expect(msg).toContain('연기금 등');
    expect(msg).toContain('매핑 미적용');
    expect(msg).toContain('ADR-0142');
    // 거래대금 내림차순 — 외국인이 금융투자보다 먼저 등장
    const fIdx = msg.indexOf('외국인');
    const gIdx = msg.indexOf('금융투자');
    expect(fIdx).toBeLessThan(gIdx);
  });

  it('빈 카테고리 배열 → 안내 라인', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '2026-04-29T07:00:00.000Z',
      rows: [],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const msg = buildFssDetailMessage([]);
    expect(msg).toContain('카테고리 데이터 비어있음');
  });

  it('0 거래대금 → ⚪ 중립 이모지', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '2026-04-29T07:00:00.000Z',
      rows: [{ category: '기타외국인', netBuyQty: 0, netBuyKrw: 0 }],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const msg = buildFssDetailMessage([]);
    expect(msg).toContain('⚪');
    expect(msg).toContain('기타외국인');
    expect(msg).toContain('0억원');
  });

  it('일자 인자 + 영속 매칭 → 해당 record 표시', () => {
    _getFssDetailRecord.mockReturnValue({
      date: '2026-04-25',
      fetchedAt: '2026-04-25T07:00:00.000Z',
      rows: [{ category: '개인', netBuyQty: 1000, netBuyKrw: 100_000_000 }],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-25' }]);
    const msg = buildFssDetailMessage(['2026-04-25']);
    expect(msg).toContain('2026-04-25');
    expect(msg).toContain('개인');
    expect(_getFssDetailRecord).toHaveBeenCalledWith('2026-04-25');
  });

  it('누적 영속 카운트 표기', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '2026-04-29T07:00:00.000Z',
      rows: [{ category: 'A', netBuyQty: 1, netBuyKrw: 1 }],
    });
    _loadFssDetailRecords.mockReturnValue(Array.from({ length: 5 }, (_, i) => ({ date: `2026-04-2${i}` })));
    const msg = buildFssDetailMessage([]);
    expect(msg).toContain('누적 영속: 5일');
  });
});

describe('fssDetail.cmd execute', () => {
  it('정상 실행 + 헤더', async () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '2026-04-29T07:00:00.000Z',
      rows: [{ category: 'A', netBuyQty: 1, netBuyKrw: 1 }],
    });
    _loadFssDetailRecords.mockReturnValue([]);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await fssDetail.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0]?.[0] ?? '') as string).toContain('FSS 11분류 raw 진단');
  });

  it('throw → ❌ 실패 응답', async () => {
    _getLatestFssDetailRecord.mockImplementation(() => { throw new Error('disk read failed'); });
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await fssDetail.execute({ args: [], reply });
    const msg = (reply.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('진단 실패');
  });
});

describe('fssDetail 메타데이터', () => {
  it('name=/fss_detail + alias=/fssd', () => {
    expect(fssDetail.name).toBe('/fss_detail');
    expect(fssDetail.aliases).toEqual(['/fssd']);
  });

  it('SYS / riskLevel=0 / ADMIN', () => {
    expect(fssDetail.category).toBe('SYS');
    expect(fssDetail.riskLevel).toBe(0);
    expect(fssDetail.visibility).toBe('ADMIN');
  });

  it('description + usage 비어있지 않음', () => {
    expect(fssDetail.description.length).toBeGreaterThan(10);
    expect(fssDetail.usage).toBe('/fss_detail [YYYY-MM-DD]');
  });
});
