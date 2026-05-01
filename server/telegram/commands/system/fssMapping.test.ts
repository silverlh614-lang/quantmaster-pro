/**
 * @responsibility fssMapping.cmd 회귀 테스트 — ADR-0142.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _getLatestFssDetailRecord = vi.fn();
const _getFssDetailRecord = vi.fn();
const _loadFssDetailRecords = vi.fn();
const _isFssMappingEnabled = vi.fn();

vi.mock('../../../persistence/fssDetailRepo.js', () => ({
  getLatestFssDetailRecord: _getLatestFssDetailRecord,
  getFssDetailRecord: _getFssDetailRecord,
  loadFssDetailRecords: _loadFssDetailRecords,
}));

// 실제 mapPassiveActive 사용 (mocking 안 함 — 매핑 로직 무회귀 검증)
vi.mock('../../../persistence/fssMappingPolicy.js', async () => {
  const actual = await vi.importActual<typeof import('../../../persistence/fssMappingPolicy.js')>(
    '../../../persistence/fssMappingPolicy.js',
  );
  return {
    ...actual,
    isFssMappingEnabled: _isFssMappingEnabled,
  };
});

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let fssMapping: typeof import('./fssMapping.cmd.js').default;
let buildFssMappingMessage: typeof import('./fssMapping.cmd.js').buildFssMappingMessage;

beforeEach(async () => {
  vi.resetModules();
  _getLatestFssDetailRecord.mockReset();
  _getFssDetailRecord.mockReset();
  _loadFssDetailRecords.mockReset();
  _loadFssDetailRecords.mockReturnValue([]);
  _isFssMappingEnabled.mockReset();
  _isFssMappingEnabled.mockReturnValue(false);
  const mod = await import('./fssMapping.cmd.js');
  fssMapping = mod.default;
  buildFssMappingMessage = mod.buildFssMappingMessage;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('buildFssMappingMessage', () => {
  it('잘못된 일자 형식 → 사용법 안내', () => {
    const msg = buildFssMappingMessage(['invalid-date']);
    expect(msg).toContain('일자 형식 오류');
    expect(msg).toContain('YYYY-MM-DD');
  });

  it('ENV OFF (default) — 매핑 영속 안 됨 안내 + ADR-0142 언급', () => {
    _isFssMappingEnabled.mockReturnValue(false);
    _getLatestFssDetailRecord.mockReturnValue(null);
    _loadFssDetailRecords.mockReturnValue([]);
    const msg = buildFssMappingMessage([]);
    expect(msg).toContain('FSS_MAPPING_ENABLED=false');
    expect(msg).toContain('default');
    expect(msg).toContain('자동 영속되지');
    expect(msg).toContain('ADR-0142');
  });

  it('ENV ON — 자동 영속 안내', () => {
    _isFssMappingEnabled.mockReturnValue(true);
    _getLatestFssDetailRecord.mockReturnValue(null);
    _loadFssDetailRecords.mockReturnValue([]);
    const msg = buildFssMappingMessage([]);
    expect(msg).toContain('FSS_MAPPING_ENABLED=true');
    expect(msg).toContain('자동 영속됨');
  });

  it('영속 부재 → 운영자 안내 (PR-B Stage 1 안내)', () => {
    _getLatestFssDetailRecord.mockReturnValue(null);
    _loadFssDetailRecords.mockReturnValue([]);
    const msg = buildFssMappingMessage([]);
    expect(msg).toContain('영속 시계열 부재');
    expect(msg).toContain('PR-B Stage 1');
    expect(msg).toContain('/fss_detail');
  });

  it('일자 인자 + 부재 → 일자별 안내', () => {
    _getFssDetailRecord.mockReturnValue(null);
    _loadFssDetailRecords.mockReturnValue([]);
    const msg = buildFssMappingMessage(['2026-04-29']);
    expect(msg).toContain('해당 일자(2026-04-29)');
    expect(msg).toContain('30영업일');
  });

  it('정상 매핑 — Passive/Active 둘 다 양수 → passiveActiveBoth=true', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '2026-04-29T07:00:00.000Z',
      rows: [
        { category: '투신', netBuyQty: 0, netBuyKrw: 1_000_000_000 },
        { category: '연기금 등', netBuyQty: 0, netBuyKrw: 2_000_000_000 },
        { category: '보험', netBuyQty: 0, netBuyKrw: 500_000_000 },
        { category: '금융투자', netBuyQty: 0, netBuyKrw: 1_500_000_000 },
        { category: '외국인', netBuyQty: 0, netBuyKrw: 5_000_000_000 },
      ],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const msg = buildFssMappingMessage([]);
    expect(msg).toContain('Passive proxy');
    expect(msg).toContain('+35.0억원');  // 10+20+5
    expect(msg).toContain('Active proxy');
    expect(msg).toContain('+15.0억원');  // 금융투자 만
    expect(msg).toContain('Foreign');
    expect(msg).toContain('+50.0억원');
    expect(msg).toContain('passiveActiveBoth 평가');
    expect(msg).toContain('true');
    expect(msg).toContain('R3_EARLY 트리거');
  });

  it('정상 매핑 — Passive 양수 / Active 음수 → passiveActiveBoth=false', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '2026-04-29T07:00:00.000Z',
      rows: [
        { category: '투신', netBuyQty: 0, netBuyKrw: 1_000_000_000 },
        { category: '금융투자', netBuyQty: 0, netBuyKrw: -3_000_000_000 },
      ],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const msg = buildFssMappingMessage([]);
    expect(msg).toContain('false');
    expect(msg).toContain('매수 합치 미감지');
  });

  it('unmatched 카테고리 표시 (개인 / 기타법인)', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '',
      rows: [
        { category: '투신', netBuyQty: 0, netBuyKrw: 1_000_000_000 },
        { category: '개인', netBuyQty: 0, netBuyKrw: 999_999 },
        { category: '기타법인', netBuyQty: 0, netBuyKrw: 100 },
      ],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const msg = buildFssMappingMessage([]);
    expect(msg).toContain('unmatched');
    expect(msg).toContain('개인');
    expect(msg).toContain('기타법인');
  });

  it('일자 인자 매칭 → 해당 record 매핑', () => {
    _getFssDetailRecord.mockReturnValue({
      date: '2026-04-25',
      fetchedAt: '',
      rows: [{ category: '외국인', netBuyQty: 0, netBuyKrw: 1_000_000_000 }],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-25' }]);
    const msg = buildFssMappingMessage(['2026-04-25']);
    expect(msg).toContain('2026-04-25');
    expect(msg).toContain('Foreign');
    expect(msg).toContain('+10.0억원');
    expect(_getFssDetailRecord).toHaveBeenCalledWith('2026-04-25');
  });

  it('매핑 정책 안내 라인 항상 포함', () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '',
      rows: [{ category: '투신', netBuyQty: 0, netBuyKrw: 1_000_000_000 }],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const msg = buildFssMappingMessage([]);
    expect(msg).toContain('매핑 정책');
    expect(msg).toContain('ADR-0142');
    expect(msg).toContain('검증 대기');
  });
});

describe('fssMapping.cmd execute', () => {
  it('정상 실행 + 헤더', async () => {
    _getLatestFssDetailRecord.mockReturnValue({
      date: '2026-04-29',
      fetchedAt: '',
      rows: [{ category: '투신', netBuyQty: 0, netBuyKrw: 1_000_000_000 }],
    });
    _loadFssDetailRecords.mockReturnValue([{ date: '2026-04-29' }]);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await fssMapping.execute({ args: [], reply });
    expect(reply).toHaveBeenCalledTimes(1);
    expect((reply.mock.calls[0]?.[0] ?? '') as string).toContain('FSS 매핑 진단');
  });

  it('throw → ❌ 실패 응답', async () => {
    _getLatestFssDetailRecord.mockImplementation(() => { throw new Error('disk read failed'); });
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await fssMapping.execute({ args: [], reply });
    const msg = (reply.mock.calls[0]?.[0] ?? '') as string;
    expect(msg).toContain('❌');
    expect(msg).toContain('진단 실패');
  });
});

describe('fssMapping 메타데이터', () => {
  it('name=/fss_mapping + alias=/fssm', () => {
    expect(fssMapping.name).toBe('/fss_mapping');
    expect(fssMapping.aliases).toEqual(['/fssm']);
  });

  it('SYS / riskLevel=0 / ADMIN', () => {
    expect(fssMapping.category).toBe('SYS');
    expect(fssMapping.riskLevel).toBe(0);
    expect(fssMapping.visibility).toBe('ADMIN');
  });

  it('description + usage 비어있지 않음', () => {
    expect(fssMapping.description.length).toBeGreaterThan(10);
    expect(fssMapping.usage).toBe('/fss_mapping [YYYY-MM-DD]');
  });
});
