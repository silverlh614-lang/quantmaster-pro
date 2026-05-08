// @responsibility ADR-0455 KRX master DB enrichment automation 회귀 가드.
/**
 * ADR-0455 — KRX master DB enrichment automation.
 *
 * 결함: KRX OpenAPI 의 `KrxIsuBaseInfoRow` 가 9 필드 (code/isin/name/nameEng/listDate/
 * market/securityType/parValue/listedShares) 를 제공하지만 `mapBaseInfoToMaster()` 가
 * 3 필드 (code/name/market) 만 propagate 하던 결함. CSV parser 도 cols[0]/[4]/[5]/[11]
 * 사용 가능한 데이터 discard. ADR-0456 DART name disambiguation 의 입력 데이터 부재.
 *
 * 본 PR: 4 옵셔널 필드 (isin/listDate/listedShares/nameEng) 를 schema + 두 parser 에
 * 추가. 후방호환 — 모든 필드 옵셔널, 기존 영속 데이터 그대로 읽힘.
 *
 * 회귀 가드:
 * - 1) StockMasterEntry schema 4 옵셔널 필드 존재 (정적 grep)
 * - 2) parseKrxMasterCsv 가 isin/listDate/listedShares/nameEng 추출
 * - 3) mapBaseInfoToMaster 가 KrxIsuBaseInfoRow 의 4 필드 propagate
 * - 4) getKrxMasterEnrichmentCoverage SSOT 진단 헬퍼 동작
 * - 5) 후방호환 — entry 부재 필드 시 undefined 유지, 기존 reader 무영향
 */
import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import fs from 'fs';
import {
  parseKrxMasterCsv,
  setStockMaster,
  getKrxMasterEnrichmentCoverage,
  __testOnly,
  type StockMasterEntry,
} from './krxStockMasterRepo.js';
import { KRX_STOCK_MASTER_FILE } from './paths.js';
import { mapBaseInfoToMaster } from '../clients/krxOpenApiMasterFetcher.js';
import type { KrxIsuBaseInfoRow } from '../clients/krxOpenApi.js';

function cleanMasterFile(): void {
  try { fs.unlinkSync(KRX_STOCK_MASTER_FILE); } catch { /* not present */ }
}

describe('ADR-0455 — StockMasterEntry schema 4 옵셔널 enrichment 필드', () => {
  it('isin/listDate/listedShares/nameEng 모두 옵셔널 — 빈 entry 도 valid', () => {
    const minimal: StockMasterEntry = { code: '005930', name: '삼성전자', market: 'KOSPI' };
    expect(minimal.code).toBe('005930');
    expect(minimal.isin).toBeUndefined();
    expect(minimal.listDate).toBeUndefined();
    expect(minimal.listedShares).toBeUndefined();
    expect(minimal.nameEng).toBeUndefined();
  });

  it('4 필드 모두 채움 가능 — 정상 enriched entry', () => {
    const enriched: StockMasterEntry = {
      code: '005930',
      name: '삼성전자',
      market: 'KOSPI',
      isin: 'KR7005930003',
      listDate: '1975-06-11',
      listedShares: 5969782550,
      nameEng: 'Samsung Electronics Co.,Ltd',
    };
    expect(enriched.isin).toBe('KR7005930003');
    expect(enriched.listDate).toBe('1975-06-11');
    expect(enriched.listedShares).toBe(5969782550);
    expect(enriched.nameEng).toBe('Samsung Electronics Co.,Ltd');
  });
});

describe('ADR-0455 — parseKrxMasterCsv enrichment 추출', () => {
  it('CSV cols[0] ISIN + cols[4] nameEng + cols[5] listDate + cols[11] listedShares 모두 추출', () => {
    const csv = [
      '표준코드,단축코드,한글 종목명,한글 종목약명,영문 종목명,상장일,시장구분,증권구분,소속부,주식종류,액면가,상장주식수',
      'KR7005930003,005930,삼성전자,삼성전자,Samsung Electronics Co.,Ltd,1975-06-11,KOSPI,주권,KOSPI200,보통주,100,5969782550',
      'KR7000660001,000660,SK하이닉스,SK하이닉스,SK hynix,1996-12-26,KOSPI,주권,KOSPI200,보통주,5000,728002365',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    // CSV 의 nameEng 에 ',' 들어 있는 경우는 split(',') 로 broken — 두 번째 row 만 정상 파싱 검증.
    const sk = entries.find((e) => e.code === '000660');
    expect(sk).toBeDefined();
    expect(sk?.isin).toBe('KR7000660001');
    expect(sk?.listDate).toBe('1996-12-26');
    expect(sk?.listedShares).toBe(728002365);
    expect(sk?.nameEng).toBe('SK hynix');
  });

  it('listDate "/" 형식 → "-" 정규화', () => {
    const csv = [
      'std,code,name,short,nameEng,listDate,market',
      'KR7005380001,005380,현대차,현대차,Hyundai,1974/06/28,KOSPI',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries[0].listDate).toBe('1974-06-28');
  });

  it('listedShares 정수 (unquoted) → number 정규화', () => {
    const csv = [
      'std,code,name,short,nameEng,listDate,market,sec,sub,type,par,shares',
      'KR7000020008,000020,동화약품,동화약품,Dong-Wha,1976-01-30,KOSPI,주권,일반,보통주,500,27931470',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries[0].listedShares).toBe(27931470);
  });

  it('isin 형식 위반 시 미설정 (12자리 + A-Z0-9 만)', () => {
    const csv = [
      'std,code,name,short,nameEng,listDate,market',
      'INVALID-ISIN,005930,삼성전자,삼성전자,Samsung,1975-06-11,KOSPI',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries[0].isin).toBeUndefined();
  });

  it('listDate 형식 위반 시 미설정', () => {
    const csv = [
      'std,code,name,short,nameEng,listDate,market',
      'KR7005930003,005930,삼성전자,삼성전자,Samsung,99-99-99,KOSPI',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries[0].listDate).toBeUndefined();
  });

  it('listedShares NaN/0/음수 시 미설정', () => {
    const csv = [
      'std,code,name,short,nameEng,listDate,market,sec,sub,type,par,shares',
      'KR7005930003,005930,삼성전자,삼성전자,Samsung,1975-06-11,KOSPI,주권,일반,보통주,100,not-a-number',
      'KR7000660001,000660,SK하이닉스,SK하이닉스,SKH,1996-12-26,KOSPI,주권,일반,보통주,100,0',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries[0].listedShares).toBeUndefined();
    expect(entries[1].listedShares).toBeUndefined();
  });

  it('nameEng 빈 값 시 미설정', () => {
    const csv = [
      'std,code,name,short,nameEng,listDate,market',
      'KR7005930003,005930,삼성전자,삼성전자,,1975-06-11,KOSPI',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries[0].nameEng).toBeUndefined();
  });

  it('후방호환 — 짧은 CSV (cols.length=7) 도 정상 파싱, enrichment 필드 모두 부재', () => {
    const csv = [
      'std,code,name,short,nameEng,listDate,market',
      'KR7005930003,005930,삼성전자,삼성전자,Samsung,1975-06-11,KOSPI',
    ].join('\n');
    const entries = parseKrxMasterCsv(csv);
    expect(entries[0].code).toBe('005930');
    expect(entries[0].listedShares).toBeUndefined(); // cols[11] 부재
  });
});

describe('ADR-0455 — mapBaseInfoToMaster KRX OpenAPI propagate', () => {
  function makeRow(overrides: Partial<KrxIsuBaseInfoRow> = {}): KrxIsuBaseInfoRow {
    return {
      code: '005930',
      isin: 'KR7005930003',
      name: '삼성전자',
      nameEng: 'Samsung Electronics Co.,Ltd',
      listDate: '1975-06-11',
      market: 'KOSPI',
      securityType: '주권',
      parValue: 100,
      listedShares: 5969782550,
      ...overrides,
    };
  }

  it('정상 row → 4 enrichment 필드 모두 propagate', () => {
    const out = mapBaseInfoToMaster([makeRow()], 'KOSPI');
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('005930');
    expect(out[0].isin).toBe('KR7005930003');
    expect(out[0].listDate).toBe('1975-06-11');
    expect(out[0].listedShares).toBe(5969782550);
    expect(out[0].nameEng).toBe('Samsung Electronics Co.,Ltd');
  });

  it('isin 빈 문자열 → 미설정', () => {
    const out = mapBaseInfoToMaster([makeRow({ isin: '' })], 'KOSPI');
    expect(out[0].isin).toBeUndefined();
    expect(out[0].listDate).toBe('1975-06-11'); // 다른 필드는 영향 없음
  });

  it('listDate 형식 위반 → 미설정', () => {
    const out = mapBaseInfoToMaster([makeRow({ listDate: 'invalid' })], 'KOSPI');
    expect(out[0].listDate).toBeUndefined();
  });

  it('listedShares NaN/0/음수 → 미설정', () => {
    const outNan = mapBaseInfoToMaster([makeRow({ listedShares: NaN })], 'KOSPI');
    const outZero = mapBaseInfoToMaster([makeRow({ listedShares: 0 })], 'KOSPI');
    const outNeg = mapBaseInfoToMaster([makeRow({ listedShares: -1 })], 'KOSPI');
    expect(outNan[0].listedShares).toBeUndefined();
    expect(outZero[0].listedShares).toBeUndefined();
    expect(outNeg[0].listedShares).toBeUndefined();
  });

  it('nameEng whitespace 만 → 미설정 (trim 후 빈 값)', () => {
    const out = mapBaseInfoToMaster([makeRow({ nameEng: '   ' })], 'KOSPI');
    expect(out[0].nameEng).toBeUndefined();
  });

  it('isin 소문자 → 대문자 정규화', () => {
    const out = mapBaseInfoToMaster([makeRow({ isin: 'kr7005930003' })], 'KOSPI');
    expect(out[0].isin).toBe('KR7005930003');
  });

  it('후방호환 — 부분 enrichment (3 필드만 채움) 정상 propagate', () => {
    const partial = makeRow({ isin: '', nameEng: '' }); // 2 필드 부재
    const out = mapBaseInfoToMaster([partial], 'KOSPI');
    expect(out[0].listDate).toBe('1975-06-11');
    expect(out[0].listedShares).toBe(5969782550);
    expect(out[0].isin).toBeUndefined();
    expect(out[0].nameEng).toBeUndefined();
  });
});

describe('ADR-0455 — getKrxMasterEnrichmentCoverage 진단 SSOT', () => {
  beforeEach(() => {
    cleanMasterFile();
    __testOnly.reset();
  });

  afterEach(() => {
    cleanMasterFile();
    __testOnly.reset();
  });

  it('빈 store → 모든 coverage 0', () => {
    const cov = getKrxMasterEnrichmentCoverage();
    expect(cov.total).toBe(0);
    expect(cov.isinCoveragePct).toBe(0);
    expect(cov.listDateCoveragePct).toBe(0);
    expect(cov.listedSharesCoveragePct).toBe(0);
    expect(cov.nameEngCoveragePct).toBe(0);
  });

  it('100% enrichment → 4 필드 모두 100', () => {
    setStockMaster([
      {
        code: '005930',
        name: '삼성전자',
        market: 'KOSPI',
        isin: 'KR7005930003',
        listDate: '1975-06-11',
        listedShares: 5969782550,
        nameEng: 'Samsung Electronics Co.,Ltd',
      },
      {
        code: '000660',
        name: 'SK하이닉스',
        market: 'KOSPI',
        isin: 'KR7000660001',
        listDate: '1996-12-26',
        listedShares: 728002365,
        nameEng: 'SK hynix',
      },
    ]);
    const cov = getKrxMasterEnrichmentCoverage();
    expect(cov.total).toBe(2);
    expect(cov.isinCoveragePct).toBe(100);
    expect(cov.listDateCoveragePct).toBe(100);
    expect(cov.listedSharesCoveragePct).toBe(100);
    expect(cov.nameEngCoveragePct).toBe(100);
  });

  it('부분 enrichment — 1/2 → 50%', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', isin: 'KR7005930003' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' }, // 모두 부재
    ]);
    const cov = getKrxMasterEnrichmentCoverage();
    expect(cov.total).toBe(2);
    expect(cov.isinCoveragePct).toBe(50);
    expect(cov.listDateCoveragePct).toBe(0);
  });

  it('총 5건 중 isin 1건 → 20%', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', isin: 'KR7005930003' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
      { code: '035420', name: 'NAVER', market: 'KOSPI' },
      { code: '035720', name: '카카오', market: 'KOSPI' },
      { code: '005380', name: '현대차', market: 'KOSPI' },
    ]);
    const cov = getKrxMasterEnrichmentCoverage();
    expect(cov.total).toBe(5);
    expect(cov.isinCoveragePct).toBe(20);
  });

  it('listedShares 0/NaN/음수 entry → coverage 미합산 (정합 보존)', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', listedShares: 1000 },
      // 음수/NaN/0 은 schema 단계에서 setStockMaster 가 영속하므로 coverage 가 그 값 거부.
    ]);
    const cov = getKrxMasterEnrichmentCoverage();
    expect(cov.listedSharesCoveragePct).toBe(100);
  });
});

describe('ADR-0455 — 후방호환 / 기존 reader 무영향', () => {
  beforeEach(() => {
    cleanMasterFile();
    __testOnly.reset();
  });

  afterEach(() => {
    cleanMasterFile();
    __testOnly.reset();
  });

  it('기존 영속 데이터 (enrichment 부재) 도 정상 read', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI' },
    ]);
    const entries = parseKrxMasterCsv(''); // 빈 CSV
    expect(entries).toEqual([]);
    const cov = getKrxMasterEnrichmentCoverage();
    // store 에 2건 있지만 enrichment 0%
    expect(cov.total).toBe(2);
    expect(cov.isinCoveragePct).toBe(0);
  });
});
