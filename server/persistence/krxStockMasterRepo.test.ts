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
  MASTER_TTL_MS,
  __testOnly,
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
});
