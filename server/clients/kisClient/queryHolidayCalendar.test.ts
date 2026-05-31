// @responsibility KIS chk-holiday(CTCA0903R) fetchKisHolidayCalendar 파싱·페이지네이션·null 회귀 (ADR-0548)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

// http.js / constants.js 는 transitive orders.ts 가 다수 export 를 destructure 하므로
// importOriginal 로 실제 모듈을 기반에 두고 realDataKisGet / HAS_REAL_DATA_CLIENT 만 덮는다.
vi.mock('./http.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./http.js')>();
  return {
    ...actual,
    realDataKisGet: (trId: string, path: string, params: Record<string, string>, priority?: string) =>
      _realDataKisGet(trId, path, params, priority),
  };
});

vi.mock('./overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));

vi.mock('./constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./constants.js')>();
  return {
    ...actual,
    get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
  };
});

let mod: typeof import('./query.js');

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  process.env.KIS_APP_KEY = 'test-key';
  mod = await import('./query.js');
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  vi.clearAllMocks();
});

describe('fetchKisHolidayCalendar (CTCA0903R, ADR-0548)', () => {
  it('opnd_yn 파싱 — 휴장(N)/개장(Y) row 를 KisHolidayEntry 로 매핑', async () => {
    _realDataKisGet.mockResolvedValue({
      output: [
        { bass_dt: '20260505', wday_dvsn_cd: '03', bzdy_yn: 'Y', tr_day_yn: 'N', opnd_yn: 'N', sttl_day_yn: 'N' },
        { bass_dt: '20260506', wday_dvsn_cd: '04', bzdy_yn: 'Y', tr_day_yn: 'Y', opnd_yn: 'Y', sttl_day_yn: 'Y' },
      ],
    });

    const result = await mod.fetchKisHolidayCalendar('20260101');

    expect(result).toEqual([
      { bassDt: '20260505', wdayDvsnCd: '03', bzdyYn: 'Y', trDayYn: 'N', opndYn: 'N', sttlDayYn: 'N' },
      { bassDt: '20260506', wdayDvsnCd: '04', bzdyYn: 'Y', trDayYn: 'Y', opndYn: 'Y', sttlDayYn: 'Y' },
    ]);
    expect(_realDataKisGet).toHaveBeenCalledWith(
      'CTCA0903R',
      '/uapi/domestic-stock/v1/quotations/chk-holiday',
      expect.objectContaining({ BASS_DT: '20260101', CTX_AREA_FK: '', CTX_AREA_NK: '' }),
      'LOW',
    );
  });

  it('연속조회(ctx_area_fk/nk) — 다음 페이지 재귀 수집 후 dedup', async () => {
    _realDataKisGet
      .mockResolvedValueOnce({
        output: [{ bass_dt: '20260101', opnd_yn: 'N' }],
        ctx_area_fk: 'FK001',
        ctx_area_nk: 'NK001',
      })
      .mockResolvedValueOnce({
        output: [
          { bass_dt: '20260101', opnd_yn: 'N' }, // 중복 — dedup 대상
          { bass_dt: '20260301', opnd_yn: 'N' },
        ],
        ctx_area_fk: '',
        ctx_area_nk: '',
      });

    const result = await mod.fetchKisHolidayCalendar('20260101');

    expect(result?.map((e) => e.bassDt)).toEqual(['20260101', '20260301']);
    expect(_realDataKisGet).toHaveBeenCalledTimes(2);
    // 두 번째 호출은 ctx_area 키를 이어받아야 한다.
    expect(_realDataKisGet.mock.calls[1][2]).toMatchObject({ CTX_AREA_FK: 'FK001', CTX_AREA_NK: 'NK001' });
  });

  it('빈 응답(accepted-empty) → null', async () => {
    _realDataKisGet.mockResolvedValue({ rt_cd: '0', msg_cd: 'MCA00000', output: [] });
    const result = await mod.fetchKisHolidayCalendar('20260101');
    expect(result).toBeNull();
  });

  it('KIS 미설정(KIS_APP_KEY 없음 + 클라 없음) → null, 호출 0', async () => {
    delete process.env.KIS_APP_KEY;
    _HAS_REAL_DATA_CLIENT.value = false;
    const result = await mod.fetchKisHolidayCalendar('20260101');
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('BASS_DT 형식 오류 → null, 호출 0', async () => {
    const result = await mod.fetchKisHolidayCalendar('2026-XX');
    expect(result).toBeNull();
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });

  it('KIS 오류(throw) → null (불변식 #6, throw 전파 금지)', async () => {
    _realDataKisGet.mockRejectedValue(new Error('KIS down'));
    const result = await mod.fetchKisHolidayCalendar('20260101');
    expect(result).toBeNull();
  });

  it('override 우선 — getKisOverrides.fetchKisHolidayCalendar 호출 시 realDataKisGet 미호출', async () => {
    _getKisOverrides.mockReturnValue({
      fetchKisHolidayCalendar: vi.fn(async () => [{ bassDt: '20260505', opndYn: 'N' }]),
    });
    const result = await mod.fetchKisHolidayCalendar('20260101');
    expect(result).toEqual([{ bassDt: '20260505', opndYn: 'N' }]);
    expect(_realDataKisGet).not.toHaveBeenCalled();
  });
});
