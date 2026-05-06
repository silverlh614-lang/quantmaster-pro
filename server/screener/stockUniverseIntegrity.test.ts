// @responsibility STOCK_UNIVERSE 시드 무결성 회귀 테스트 (ADR-0266)
/**
 * stockUniverseIntegrity.test.ts — 시드 종목 시장 분류 + format 정합성 회귀 가드.
 *
 * 사용자 5/6 보고: 079550 LIG넥스원 / 105840 우진 / 443060 HD현대마린솔루션
 * 같은 KOSPI 종목이 STOCK_UNIVERSE 에 .KQ (KOSDAQ) 로 잘못 등재 → fetchYahoo
 * 매핑 결함 누적. 본 회귀 테스트가 향후 동일 결함 자동 차단.
 *
 * 검증:
 *   1. 알려진 KOSPI 종목 (방산·중공업·금융 대표) — .KS suffix + 정확 종목명
 *   2. 알려진 KOSDAQ 종목 — .KQ suffix
 *   3. STOCK_UNIVERSE 모든 entry — 코드 6자리 + symbol .KS/.KQ 일치
 *   4. 코드 중복 없음
 */

import { describe, expect, it } from 'vitest';
import { STOCK_UNIVERSE } from './stockUniverse.js';

interface KnownStock {
  code: string;
  name: string;
}

/** 알려진 KOSPI 종목 — 사용자 5/6 보고 결함 진원지 + 회귀 가드. */
const KNOWN_KOSPI_STOCKS: KnownStock[] = [
  { code: '005930', name: '삼성전자' },
  { code: '000660', name: 'SK하이닉스' },
  { code: '079550', name: 'LIG넥스원' },           // 5/6 결함 — KOSDAQ 으로 잘못 등재
  { code: '105840', name: '우진' },                // 5/6 결함 — 동일
  { code: '443060', name: 'HD현대마린솔루션' },     // 5/6 결함 — 코드+이름 매핑 잘못
  { code: '373220', name: 'LG에너지솔루션' },
];

/** 알려진 KOSDAQ 종목 — 시장 분류 정확성 검증. */
const KNOWN_KOSDAQ_STOCKS: KnownStock[] = [
  { code: '247540', name: '에코프로비엠' },
  { code: '086520', name: '에코프로' },
];

describe('STOCK_UNIVERSE 시드 무결성 (ADR-0266)', () => {
  describe('알려진 KOSPI 종목 — .KS suffix + 정확 종목명', () => {
    for (const { code, name } of KNOWN_KOSPI_STOCKS) {
      it(`${code} ${name} — KOSPI .KS 등록`, () => {
        const entry = STOCK_UNIVERSE.find(s => s.code === code);
        expect(entry, `${code} 는 STOCK_UNIVERSE 에 등록되어야 함`).toBeDefined();
        expect(entry?.symbol).toBe(`${code}.KS`);
        expect(entry?.name).toBe(name);
      });
    }
  });

  describe('알려진 KOSDAQ 종목 — .KQ suffix', () => {
    for (const { code, name } of KNOWN_KOSDAQ_STOCKS) {
      it(`${code} ${name} — KOSDAQ .KQ 등록`, () => {
        const entry = STOCK_UNIVERSE.find(s => s.code === code);
        expect(entry, `${code} 는 STOCK_UNIVERSE 에 등록되어야 함`).toBeDefined();
        expect(entry?.symbol).toBe(`${code}.KQ`);
        expect(entry?.name).toBe(name);
      });
    }
  });

  it('모든 entry — 코드 6자리 + symbol .KS/.KQ format', () => {
    const errors: string[] = [];
    for (const entry of STOCK_UNIVERSE) {
      if (!/^\d{6}$/.test(entry.code)) {
        errors.push(`${entry.code} (${entry.name}) — 6자리 숫자 코드 아님`);
      }
      if (!/^\d{6}\.K[SQ]$/.test(entry.symbol)) {
        errors.push(`${entry.code} (${entry.name}) — symbol format 위반: ${entry.symbol}`);
      }
      if (entry.symbol !== `${entry.code}.KS` && entry.symbol !== `${entry.code}.KQ`) {
        errors.push(`${entry.code} (${entry.name}) — symbol prefix 가 code 와 불일치: ${entry.symbol}`);
      }
      if (!entry.name || entry.name.trim().length === 0) {
        errors.push(`${entry.code} — 빈 종목명`);
      }
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('코드 중복 없음', () => {
    const codes = new Map<string, string>();
    const dupes: string[] = [];
    for (const entry of STOCK_UNIVERSE) {
      const existing = codes.get(entry.code);
      if (existing) {
        dupes.push(`${entry.code} — "${existing}" vs "${entry.name}"`);
      } else {
        codes.set(entry.code, entry.name);
      }
    }
    expect(dupes, dupes.join('\n')).toEqual([]);
  });

  it('총 종목 수 — ≥ 200 (시드 충분 확인)', () => {
    expect(STOCK_UNIVERSE.length).toBeGreaterThanOrEqual(200);
  });
});
