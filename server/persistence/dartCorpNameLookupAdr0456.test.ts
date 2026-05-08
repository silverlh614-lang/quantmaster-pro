// @responsibility ADR-0456 DART name disambiguation 회귀 가드.
/**
 * ADR-0456 — DART corp_name → stockCode 역매핑 SSOT.
 *
 * 결함: `dartPoller.ts:567,795` 가 DART 가 stock_code 없이 반환한 disclosure 를
 * `'000000'` 으로 silent pad → watchlist 매칭 실패 → disclosure 영구 손실.
 *
 * 본 PR: ADR-0455 의 `isin` / `nameEng` 입력 활용한 SSOT 역매핑 helper +
 * `dartPoller.ts` fallback wiring (DART stock_code 부재 시 corpName lookup).
 *
 * 회귀 가드:
 * - lookupStockCodeByIsin (12자리 ISIN 정규식 + 대문자 정규화 + 모호 처리)
 * - lookupStockCodeByExactName (한국어 우선 + 영문 fallback + 모호 처리)
 * - diagnoseCorpNameMatch (모호 진단 SSOT)
 * - resolveStockCodeFromDart (dartPoller fallback 진입점 6 source 분기)
 * - ENV 정확 비교 (ADR-0157)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import {
  lookupStockCodeByIsin,
  lookupStockCodeByExactName,
  diagnoseCorpNameMatch,
  resolveStockCodeFromDart,
  isDartNameDisambiguationDisabled,
} from './dartCorpNameLookup.js';
import { setStockMaster, __testOnly } from './krxStockMasterRepo.js';
import { KRX_STOCK_MASTER_FILE } from './paths.js';

function cleanMasterFile(): void {
  try { fs.unlinkSync(KRX_STOCK_MASTER_FILE); } catch { /* not present */ }
}

beforeEach(() => {
  cleanMasterFile();
  __testOnly.reset();
  delete process.env.DART_NAME_DISAMBIGUATION_DISABLED;
});

afterEach(() => {
  cleanMasterFile();
  __testOnly.reset();
  delete process.env.DART_NAME_DISAMBIGUATION_DISABLED;
});

describe('ADR-0456 — ENV gate (ADR-0157 정확 비교)', () => {
  it('default OFF → isDartNameDisambiguationDisabled() = false', () => {
    expect(isDartNameDisambiguationDisabled()).toBe(false);
  });

  it("'true' → DISABLED", () => {
    process.env.DART_NAME_DISAMBIGUATION_DISABLED = 'true';
    expect(isDartNameDisambiguationDisabled()).toBe(true);
  });

  it("'1' / 'TRUE' / 'yes' / '' 모두 거부 (정확 비교)", () => {
    process.env.DART_NAME_DISAMBIGUATION_DISABLED = '1';
    expect(isDartNameDisambiguationDisabled()).toBe(false);
    process.env.DART_NAME_DISAMBIGUATION_DISABLED = 'TRUE';
    expect(isDartNameDisambiguationDisabled()).toBe(false);
    process.env.DART_NAME_DISAMBIGUATION_DISABLED = 'yes';
    expect(isDartNameDisambiguationDisabled()).toBe(false);
    process.env.DART_NAME_DISAMBIGUATION_DISABLED = '';
    expect(isDartNameDisambiguationDisabled()).toBe(false);
  });

  it("'false' → 비활성화 안 됨 (default 동작)", () => {
    process.env.DART_NAME_DISAMBIGUATION_DISABLED = 'false';
    expect(isDartNameDisambiguationDisabled()).toBe(false);
  });
});

describe('ADR-0456 — lookupStockCodeByIsin', () => {
  it('빈 입력 / null / undefined → null', () => {
    expect(lookupStockCodeByIsin(null)).toBeNull();
    expect(lookupStockCodeByIsin(undefined)).toBeNull();
    expect(lookupStockCodeByIsin('')).toBeNull();
  });

  it('빈 master → null', () => {
    expect(lookupStockCodeByIsin('KR7005930003')).toBeNull();
  });

  it('정상 ISIN → stockCode', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', isin: 'KR7005930003' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI', isin: 'KR7000660001' },
    ]);
    expect(lookupStockCodeByIsin('KR7005930003')).toBe('005930');
    expect(lookupStockCodeByIsin('KR7000660001')).toBe('000660');
  });

  it('소문자 ISIN → 대문자 정규화 후 매칭', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', isin: 'KR7005930003' },
    ]);
    expect(lookupStockCodeByIsin('kr7005930003')).toBe('005930');
    expect(lookupStockCodeByIsin('  Kr7005930003  ')).toBe('005930');
  });

  it('형식 위반 (12자리 미만 / 비-알파숫자) → null', () => {
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI', isin: 'KR7005930003' }]);
    expect(lookupStockCodeByIsin('INVALID')).toBeNull();
    expect(lookupStockCodeByIsin('KR700593000')).toBeNull();  // 11자리
    expect(lookupStockCodeByIsin('KR7005930003-')).toBeNull(); // 13자리
    expect(lookupStockCodeByIsin('KR-005930-003')).toBeNull();  // hyphen 포함
  });

  it('master entries 중 isin 부재 entry 무시 (정합 보존)', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' }, // isin 부재
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI', isin: 'KR7000660001' },
    ]);
    expect(lookupStockCodeByIsin('KR7000660001')).toBe('000660');
    // 005930 의 isin 이 부재이므로 매칭되지 않음 (회귀 안전)
    expect(lookupStockCodeByIsin('KR7005930003')).toBeNull();
  });
});

describe('ADR-0456 — lookupStockCodeByExactName', () => {
  beforeEach(() => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', nameEng: 'Samsung Electronics Co.,Ltd' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI', nameEng: 'SK hynix' },
      { code: '006400', name: '삼성SDI', market: 'KOSPI', nameEng: 'Samsung SDI' },
    ]);
  });

  it('한국어 정확 일치 → stockCode', () => {
    expect(lookupStockCodeByExactName('삼성전자', null)).toBe('005930');
    expect(lookupStockCodeByExactName('SK하이닉스', null)).toBe('000660');
  });

  it('영문 정확 일치 (대소문자 무관) → stockCode', () => {
    expect(lookupStockCodeByExactName(null, 'Samsung Electronics Co.,Ltd')).toBe('005930');
    expect(lookupStockCodeByExactName(null, 'SK HYNIX')).toBe('000660');
  });

  it('한국어 우선 — 한국어 정확 일치 시 영문 무시', () => {
    expect(lookupStockCodeByExactName('삼성전자', 'Wrong English Name')).toBe('005930');
  });

  it('한국어 무매칭 → 영문 fallback', () => {
    expect(lookupStockCodeByExactName('비매칭', 'Samsung SDI')).toBe('006400');
  });

  it('빈 입력 양쪽 → null', () => {
    expect(lookupStockCodeByExactName(null, null)).toBeNull();
    expect(lookupStockCodeByExactName('', '')).toBeNull();
    expect(lookupStockCodeByExactName('  ', '  ')).toBeNull();
  });

  it('한국어 모호 매칭 → null + console.warn', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '999999', name: '삼성전자', market: 'KOSPI' }, // 동일 한국어명 (가짜 시나리오)
    ]);
    expect(lookupStockCodeByExactName('삼성전자', null)).toBeNull();
  });

  it('영문 모호 매칭 → null', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', nameEng: 'Samsung Electronics' },
      { code: '999999', name: '가짜', market: 'KOSPI', nameEng: 'Samsung Electronics' }, // 동일 영문명
    ]);
    expect(lookupStockCodeByExactName(null, 'Samsung Electronics')).toBeNull();
  });
});

describe('ADR-0456 — diagnoseCorpNameMatch (모호성 진단)', () => {
  beforeEach(() => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', nameEng: 'Samsung Electronics' },
      { code: '006400', name: '삼성SDI', market: 'KOSPI', nameEng: 'Samsung SDI' },
    ]);
  });

  it('빈 입력 → matches=[] ambiguous=false', () => {
    const r = diagnoseCorpNameMatch('');
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toBe(false);
  });

  it('정확 1건 매칭 → ambiguous=false', () => {
    const r = diagnoseCorpNameMatch('삼성전자');
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].code).toBe('005930');
    expect(r.ambiguous).toBe(false);
  });

  it('영문 정확 매칭 (한국어 무매칭) → ambiguous=false', () => {
    const r = diagnoseCorpNameMatch('Samsung SDI');
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0].code).toBe('006400');
  });

  it('한국어 + 영문 양쪽 매칭 dedup', () => {
    setStockMaster([
      { code: '005930', name: 'Samsung', market: 'KOSPI', nameEng: 'Samsung' },
    ]);
    const r = diagnoseCorpNameMatch('Samsung');
    expect(r.matches).toHaveLength(1); // dedup by code
    expect(r.ambiguous).toBe(false);
  });

  it('다중 매칭 → ambiguous=true', () => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI' },
      { code: '999999', name: '삼성전자', market: 'KOSPI' }, // 동일명
    ]);
    const r = diagnoseCorpNameMatch('삼성전자');
    expect(r.matches).toHaveLength(2);
    expect(r.ambiguous).toBe(true);
  });

  it('매칭 없음 → ambiguous=false (정합)', () => {
    const r = diagnoseCorpNameMatch('비상장회사');
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toBe(false);
  });
});

describe('ADR-0456 — resolveStockCodeFromDart (dartPoller fallback 진입점)', () => {
  beforeEach(() => {
    setStockMaster([
      { code: '005930', name: '삼성전자', market: 'KOSPI', isin: 'KR7005930003', nameEng: 'Samsung Electronics' },
      { code: '000660', name: 'SK하이닉스', market: 'KOSPI', isin: 'KR7000660001' },
    ]);
  });

  it('정상 stock_code (6자리) → DART_RAW', () => {
    const r = resolveStockCodeFromDart({ dartStockCode: '005930' });
    expect(r.stockCode).toBe('005930');
    expect(r.source).toBe('DART_RAW');
  });

  it("stock_code='000000' (legacy pad 결과) → ISIN/corpName fallback 시도", () => {
    const r = resolveStockCodeFromDart({
      dartStockCode: '000000',
      corpName: '삼성전자',
    });
    expect(r.stockCode).toBe('005930');
    expect(r.source).toBe('NAME_KO_LOOKUP');
  });

  it('stock_code 부재 + ISIN 가용 → ISIN_LOOKUP', () => {
    const r = resolveStockCodeFromDart({
      dartStockCode: null,
      isin: 'KR7005930003',
    });
    expect(r.stockCode).toBe('005930');
    expect(r.source).toBe('ISIN_LOOKUP');
  });

  it('stock_code 부재 + corpName 한국어 → NAME_KO_LOOKUP', () => {
    const r = resolveStockCodeFromDart({
      dartStockCode: '',
      corpName: 'SK하이닉스',
    });
    expect(r.stockCode).toBe('000660');
    expect(r.source).toBe('NAME_KO_LOOKUP');
  });

  it('stock_code 부재 + corpNameEng → NAME_ENG_LOOKUP', () => {
    const r = resolveStockCodeFromDart({
      dartStockCode: '',
      corpNameEng: 'Samsung Electronics',
    });
    expect(r.stockCode).toBe('005930');
    expect(r.source).toBe('NAME_ENG_LOOKUP');
  });

  it('한국어 모호 매칭 → AMBIGUOUS', () => {
    setStockMaster([
      { code: '005930', name: '삼성', market: 'KOSPI' },
      { code: '999999', name: '삼성', market: 'KOSPI' },
    ]);
    const r = resolveStockCodeFromDart({
      dartStockCode: null,
      corpName: '삼성',
    });
    expect(r.stockCode).toBeNull();
    expect(r.source).toBe('AMBIGUOUS');
  });

  it('모든 입력 부재 → NOT_FOUND', () => {
    const r = resolveStockCodeFromDart({});
    expect(r.stockCode).toBeNull();
    expect(r.source).toBe('NOT_FOUND');
  });

  it('master 부재 + stock_code 부재 → NOT_FOUND', () => {
    cleanMasterFile();
    __testOnly.reset();
    const r = resolveStockCodeFromDart({
      corpName: '삼성전자',
    });
    expect(r.stockCode).toBeNull();
    expect(r.source).toBe('NOT_FOUND');
  });

  it('ENV DISABLED → 항상 null + DISABLED source', () => {
    process.env.DART_NAME_DISAMBIGUATION_DISABLED = 'true';
    const r = resolveStockCodeFromDart({
      dartStockCode: '005930', // 정상 입력에도
      corpName: '삼성전자',
    });
    expect(r.stockCode).toBeNull();
    expect(r.source).toBe('DISABLED');
  });

  it('우선순위: DART_RAW > ISIN > NAME_KO > NAME_ENG', () => {
    // 정상 stock_code 우선
    const r1 = resolveStockCodeFromDart({
      dartStockCode: '005930',
      isin: 'KR7000660001', // 다른 stockCode 매칭
      corpName: '다른이름',
    });
    expect(r1.stockCode).toBe('005930');
    expect(r1.source).toBe('DART_RAW');

    // ISIN 우선 (stock_code 부재)
    const r2 = resolveStockCodeFromDart({
      dartStockCode: '',
      isin: 'KR7005930003',
      corpName: 'SK하이닉스', // 다른 매칭
    });
    expect(r2.stockCode).toBe('005930');
    expect(r2.source).toBe('ISIN_LOOKUP');
  });

  it('회귀 시나리오 — DART disclosure 영구 손실 차단 (사용자 핵심 결함)', () => {
    // Before ADR-0456: stock_code='' → padStart('000000') → watchCodes.has('000000')=false → 손실
    // After ADR-0456: corpName='삼성전자' fallback → stockCode='005930' → 정상 매칭
    const r = resolveStockCodeFromDart({
      dartStockCode: '',
      corpName: '삼성전자',
    });
    expect(r.stockCode).toBe('005930');
    expect(r.source).toBe('NAME_KO_LOOKUP');
    // 즉, 사용자 watchlist 에 005930 이 등록되어 있으면 disclosure 가 정상 매칭됨.
  });
});

describe('ADR-0456 — dartPoller wiring (정적 grep 가드)', () => {
  it('dartPoller.ts 가 resolveStockCodeFromDart import + 2 site wiring (정적 검증)', () => {
    const src = fs.readFileSync(
      new URL('../alerts/dartPoller.ts', import.meta.url),
      'utf-8',
    );
    // import 검증
    expect(src).toContain("import { resolveStockCodeFromDart } from '../persistence/dartCorpNameLookup.js'");
    // 2 wiring site 검증 (legacy padStart 보존 + ?? fallback)
    const wiringPattern = /resolveStockCodeFromDart\(\{ dartStockCode: d\.stock_code, corpName \}\)/g;
    const wiringMatches = src.match(wiringPattern) ?? [];
    expect(wiringMatches.length).toBe(2);
    // legacy padStart 보존 (graceful — resolved.stockCode null 시)
    const padStartPattern = /resolved\.stockCode \?\? \(d\.stock_code \?\? ''\)\.padStart\(6, '0'\)/g;
    const padMatches = src.match(padStartPattern) ?? [];
    expect(padMatches.length).toBe(2);
    // ADR-0456 추적 주석
    expect(src).toContain('ADR-0456');
  });
});
