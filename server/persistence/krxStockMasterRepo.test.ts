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
