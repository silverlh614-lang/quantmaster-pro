/**
 * @responsibility DEBUG_PROGRAM_RAW ENV 우회 raw 로깅 회귀 가드 (P1 #4 임시 진단 도구).
 *
 * 본 파일은 임시 진단 도구의 회귀 가드. 5/4 영업일 검증 완료 후 query.ts 의 DEBUG 블록
 * 제거 시 본 파일도 함께 삭제 의무. 사용자 P1 #4 (응답 필드 키 미스매치 vs 휴장일 효과 구분).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _realDataKisGet = vi.fn();
const _getKisOverrides = vi.fn();
const _HAS_REAL_DATA_CLIENT = { value: false };

vi.mock('./http.js', () => ({
  realDataKisGet: (trId: string, path: string, params: Record<string, string>) =>
    _realDataKisGet(trId, path, params),
}));

vi.mock('./overrides.js', () => ({
  getKisOverrides: () => _getKisOverrides(),
}));

vi.mock('./constants.js', () => ({
  get HAS_REAL_DATA_CLIENT() { return _HAS_REAL_DATA_CLIENT.value; },
}));

let fetchKisStockProgramTrade: typeof import('./query.js').fetchKisStockProgramTrade;
let fetchKisMarketProgramTrade: typeof import('./query.js').fetchKisMarketProgramTrade;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  _realDataKisGet.mockReset();
  _getKisOverrides.mockReset();
  _getKisOverrides.mockReturnValue({});
  _HAS_REAL_DATA_CLIENT.value = false;
  process.env.KIS_APP_KEY = 'test-key';
  delete process.env.DEBUG_PROGRAM_RAW;

  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  const mod = await import('./query.js');
  fetchKisStockProgramTrade = mod.fetchKisStockProgramTrade;
  fetchKisMarketProgramTrade = mod.fetchKisMarketProgramTrade;
});

afterEach(() => {
  delete process.env.KIS_APP_KEY;
  delete process.env.DEBUG_PROGRAM_RAW;
  consoleLogSpy.mockRestore();
  vi.clearAllMocks();
});

describe('DEBUG_PROGRAM_RAW ENV 우회 raw 로깅 (P1 #4 임시 진단 도구)', () => {
  describe('fetchKisStockProgramTrade', () => {
    it('ENV 미설정 (default OFF) 시 raw 로깅 미호출', async () => {
      _realDataKisGet.mockResolvedValue({
        output: { prgm_ntby_qty: '100', prgm_ntby_tr_pbmn: '8000000', prgm_byov_rate: '5' },
      });
      await fetchKisStockProgramTrade('005930');
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(0);
    });

    it('ENV=false (명시적 비활성) 시 raw 로깅 미호출', async () => {
      process.env.DEBUG_PROGRAM_RAW = 'false';
      _realDataKisGet.mockResolvedValue({
        output: { prgm_ntby_qty: '100', prgm_ntby_tr_pbmn: '8000000', prgm_byov_rate: '5' },
      });
      await fetchKisStockProgramTrade('005930');
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(0);
    });

    it('ENV=true 시 raw 응답 + 종목코드 console.log 호출', async () => {
      process.env.DEBUG_PROGRAM_RAW = 'true';
      const rawResp = {
        output: { prgm_ntby_qty: '100', prgm_ntby_tr_pbmn: '8000000', prgm_byov_rate: '5' },
      };
      _realDataKisGet.mockResolvedValue(rawResp);
      await fetchKisStockProgramTrade('005930');
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(1);
      expect(debugCalls[0][0]).toBe('[DEBUG_PROGRAM_RAW] stock');
      expect(debugCalls[0][1]).toBe('005930');
      // raw 전체 dump — JSON.stringify 통과
      expect(debugCalls[0][2]).toBe(JSON.stringify(rawResp));
    });

    it('ENV=true + KIS null 응답 시에도 로깅 (필드 미스매치 진단 목적)', async () => {
      process.env.DEBUG_PROGRAM_RAW = 'true';
      _realDataKisGet.mockResolvedValue(null);
      await fetchKisStockProgramTrade('005930');
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(1);
      expect(debugCalls[0][2]).toBe('null');
    });

    it('ENV=true + output 부재 시에도 로깅 (raw 응답 그대로)', async () => {
      process.env.DEBUG_PROGRAM_RAW = 'true';
      const rawResp = { rt_cd: '0', msg1: 'success', /* output 부재 */ };
      _realDataKisGet.mockResolvedValue(rawResp);
      const result = await fetchKisStockProgramTrade('005930');
      expect(result).toBeNull();
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(1);
      expect(debugCalls[0][2]).toBe(JSON.stringify(rawResp));
    });
  });

  describe('fetchKisMarketProgramTrade', () => {
    it('ENV 미설정 (default OFF) 시 raw 로깅 미호출', async () => {
      _realDataKisGet.mockResolvedValue({
        output: { prgm_ntby_qty: '5000', prgm_ntby_tr_pbmn: '15000000000' },
      });
      await fetchKisMarketProgramTrade();
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(0);
    });

    it('ENV=true 시 raw 응답 console.log 호출 (시장 단위 라벨)', async () => {
      process.env.DEBUG_PROGRAM_RAW = 'true';
      const rawResp = {
        output: { prgm_ntby_qty: '5000', prgm_ntby_tr_pbmn: '15000000000' },
      };
      _realDataKisGet.mockResolvedValue(rawResp);
      await fetchKisMarketProgramTrade();
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(1);
      expect(debugCalls[0][0]).toBe('[DEBUG_PROGRAM_RAW] market');
      expect(debugCalls[0][1]).toBe(JSON.stringify(rawResp));
    });

    it('ENV=true + null 응답 시에도 로깅', async () => {
      process.env.DEBUG_PROGRAM_RAW = 'true';
      _realDataKisGet.mockResolvedValue(null);
      await fetchKisMarketProgramTrade();
      const debugCalls = consoleLogSpy.mock.calls.filter((c: unknown[]) =>
        String(c[0]).includes('[DEBUG_PROGRAM_RAW]'),
      );
      expect(debugCalls).toHaveLength(1);
      expect(debugCalls[0][1]).toBe('null');
    });
  });

  describe('일회성 임시 도구 — 본 파일 제거 시 query.ts DEBUG 블록 동시 제거 의무', () => {
    it('query.ts 의 DEBUG_PROGRAM_RAW 블록 존재 + 본 파일 제거 시 query.ts 도 함께 제거', async () => {
      // 정적 grep 가드 — query.ts 가 아직 DEBUG 로깅 보유 중인지 확인.
      // 5/4 영업일 검증 완료 후 query.ts 정리 PR 시 본 테스트 + 본 파일 함께 삭제.
      const fs = await import('fs');
      const url = await import('url');
      const path = await import('path');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const queryPath = path.join(here, 'query.ts');
      const src = fs.readFileSync(queryPath, 'utf-8');
      expect(src).toContain("process.env.DEBUG_PROGRAM_RAW === 'true'");
      expect(src).toContain('[DEBUG_PROGRAM_RAW] stock');
      expect(src).toContain('[DEBUG_PROGRAM_RAW] market');
      expect(src).toContain('5/4 영업일 검증 후 제거 예정');
    });
  });
});
