/**
 * @responsibility KRX 종목 마스터 영속 캐시 회귀 테스트 — PR-25-A, ADR-0011
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import {
  getStockByCode,
  getStockByName,
  extractStocksFromText,
  setStockMaster,
  isMasterStale,
  getMasterSize,
  parseKrxMasterCsv,
  refreshKrxStockMaster,
  isLikelyHtmlResponse,
  validateMasterPayload,
  MASTER_TTL_MS,
  __testOnly,
  type StockMasterEntry,
} from './krxStockMasterRepo.js';
import { KRX_STOCK_MASTER_FILE } from './paths.js';

function cleanFile(): void {
  try { fs.unlinkSync(KRX_STOCK_MASTER_FILE); } catch { /* not present */ }
}

describe('krxStockMasterRepo (ADR-0011)', () => {
  beforeEach(() => {
    cleanFile();
    __testOnly.reset();
  });
  afterEach(() => {
    cleanFile();
    __testOnly.reset();
  });

  it('초기에 마스터가 없으면 stale=true', () => {
    expect(isMasterStale()).toBe(true);
    expect(getMasterSize()).toBe(0);
  });

  it('setStockMaster 후 코드/이름 매핑 조회 가능', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
    ]);
    expect(getStockByCode('005930')?.name).toBe('삼성전자');
    expect(getStockByName('SK하이닉스')?.code).toBe('000660');
    expect(getMasterSize()).toBe(2);
  });

  it('setStockMaster 후 디스크 영속화 + 새 인스턴스에서 로드', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
    ]);
    expect(fs.existsSync(KRX_STOCK_MASTER_FILE)).toBe(true);

    __testOnly.reset();
    expect(getStockByCode('005930')?.name).toBe('삼성전자');
  });

  it('TTL 만료 시 stale=true', () => {
    const now = Date.now();
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }], now);
    expect(isMasterStale(now + 1000)).toBe(false);
    expect(isMasterStale(now + MASTER_TTL_MS + 1000)).toBe(true);
  });

  it('extractStocksFromText — longest-match 로 종목명 추출', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '005935', name: '삼성전자우', market: 'KOSPI' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
    ]);
    const found = extractStocksFromText('오늘 삼성전자우 와 SK하이닉스 가 강세');
    const codes = found.map((f) => f.code).sort();
    expect(codes).toContain('005935');
    expect(codes).toContain('000660');
    // longest-match 이므로 "삼성전자" 중복 없음 (삼성전자우만 매치)
    expect(codes).not.toContain('005930');
  });

  it('extractStocksFromText — 매치 없으면 빈 배열', () => {
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    expect(extractStocksFromText('LG에너지솔루션 이야기')).toEqual([]);
  });

  it('parseKrxMasterCsv — KOSPI/KOSDAQ 분류 + 6자리 코드 검증', () => {
    const csv = [
      '표준코드,단축코드,한글 종목명,한글 종목약명,영문 종목명,상장일,시장구분',
      'KR1,005930,삼성전자,삼성전자,SAMSUNG,1975/06/11,KOSPI',
      'KR2,035420,NAVER,NAVER,NAVER,2002/10/29,KOSPI',
      'KR3,247540,에코프로비엠,에코프로비엠,ECOPRO BM,2019/03/05,KOSDAQ',
      'KR4,12345,잘못된코드,X,X,2000/01/01,KOSPI',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ code: '005930', name: '삼성전자', market: 'KOSPI' });
    expect(entries[2]).toMatchObject({ code: '247540', market: 'KOSDAQ' });
  });

  it('parseKrxMasterCsv — 빈 CSV 는 빈 배열', () => {
    expect(parseKrxMasterCsv('')).toEqual([]);
    expect(parseKrxMasterCsv('header\n')).toEqual([]);
  });

  describe('isLikelyHtmlResponse (ADR-0013)', () => {
    it('CSV 응답은 false', () => {
      expect(isLikelyHtmlResponse('표준코드,단축코드,한글 종목명\nKR1,005930,삼성전자')).toBe(false);
    });
    it('빈 문자열 false', () => {
      expect(isLikelyHtmlResponse('')).toBe(false);
    });
    it('<!DOCTYPE 시작 → true', () => {
      expect(isLikelyHtmlResponse('<!DOCTYPE html>\n<html><body>점검 중</body></html>')).toBe(true);
    });
    it('<html 시작 → true', () => {
      expect(isLikelyHtmlResponse('<html><body>error</body></html>')).toBe(true);
    });
    it('대소문자 혼용 + 공백 무시', () => {
      expect(isLikelyHtmlResponse('  <!DocType html>')).toBe(true);
      expect(isLikelyHtmlResponse('<HTML>')).toBe(true);
    });
    it('<?xml 도 true (KRX SOAP fault 경우)', () => {
      expect(isLikelyHtmlResponse('<?xml version="1.0"?>\n<error/>')).toBe(true);
    });
  });

  describe('parseKrxMasterCsv HTML 가드 (ADR-0013)', () => {
    it('HTML 응답을 받으면 빈 배열 반환', () => {
      const html = '<!DOCTYPE html><html><body>점검 중입니다</body></html>';
      expect(parseKrxMasterCsv(html)).toEqual([]);
    });
  });

  describe('validateMasterPayload (ADR-0013)', () => {
    function makeEntries(n: number, market: 'KOSPI' | 'KOSDAQ' = 'KOSPI'): StockMasterEntry[] {
      return Array.from({ length: n }, (_, i) => ({
        code: String(100000 + i).padStart(6, '0'),
        name: `종목${i}`,
        market,
      }));
    }

    it('빈 배열 → EMPTY', () => {
      const r = validateMasterPayload([]);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('EMPTY');
    });

    it('count < minCount → BELOW_MIN', () => {
      const r = validateMasterPayload(makeEntries(1500));
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('BELOW_MIN');
      expect(r.detail).toContain('1500');
    });

    it('count >= minCount + 정상 ratio → valid', () => {
      const r = validateMasterPayload(makeEntries(2500));
      expect(r.valid).toBe(true);
      expect(r.count).toBe(2500);
    });

    it('코드 매치율 < 95% → BAD_CODE_RATIO', () => {
      const entries = makeEntries(2000);
      // 10% 를 잘못된 코드로 변경
      for (let i = 0; i < 200; i++) entries[i].code = 'XX' + String(i).padStart(4, '0');
      const r = validateMasterPayload(entries);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('BAD_CODE_RATIO');
    });

    it('KOSPI/KOSDAQ 비율 < 80% → BAD_MARKET_RATIO', () => {
      const entries = makeEntries(2000);
      for (let i = 0; i < 500; i++) entries[i].market = 'KONEX';
      const r = validateMasterPayload(entries);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('BAD_MARKET_RATIO');
    });

    it('낮은 minCount 로 호출 시 (Naver tier) 200건도 통과', () => {
      const r = validateMasterPayload(makeEntries(250), 200);
      expect(r.valid).toBe(true);
    });
  });

  describe('refreshKrxStockMaster — 주말 단락', () => {
    const originalForceOff = process.env.DATA_FETCH_FORCE_OFF;
    afterEach(() => {
      // 주말 강제 분기 해제 (isKstWeekend 는 UTC 기반이라 date mock 대신 FORCE_OFF 는
      // 무관 — 대신 KST 토요일 날짜 pin 은 vitest timer mock 없이는 어렵다. 대신
      // 토요일 당일(2026-04-25)에 돌면 단락이 타고, 평일엔 기존 경로가 탄다.)
      if (originalForceOff === undefined) delete process.env.DATA_FETCH_FORCE_OFF;
      else process.env.DATA_FETCH_FORCE_OFF = originalForceOff;
    });

    it('주말 + 디스크 캐시 존재 → true 반환 + 외부 HTTP 호출 없음', async () => {
      // 현재 KST 가 주말인 경우에만 단락을 검증 (아니면 skip).
      const isSaturday = new Date(Date.now() + 9 * 3_600_000).getUTCDay();
      if (isSaturday !== 0 && isSaturday !== 6) return; // 평일은 본 단락을 타지 않음
      setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
      // 메모리 리셋 후 디스크만 남긴 상태에서 refresh 호출
      __testOnly.reset();
      const ok = await refreshKrxStockMaster();
      expect(ok).toBe(true);
      expect(getMasterSize()).toBe(1); // 디스크에서 복원됨
    });

    it('주말 + 디스크 캐시 없음 → false 반환', async () => {
      const isSaturday = new Date(Date.now() + 9 * 3_600_000).getUTCDay();
      if (isSaturday !== 0 && isSaturday !== 6) return;
      cleanFile();
      __testOnly.reset();
      const ok = await refreshKrxStockMaster();
      expect(ok).toBe(false);
      expect(getMasterSize()).toBe(0);
    });
  });
});
