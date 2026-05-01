// @responsibility marketDataRefresh 시장 프로그램 매매 wiring 회귀 — ADR-0138.
// 정적 grep 가드 — 본 PR 의 wiring 위치 + 단위 환산 + programSource='NONE' 분기 검증.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh.ts');

describe('marketDataRefresh ADR-0138 wiring (정적 grep 가드)', () => {
  let source: string;

  beforeAll();

  function beforeAll() {
    source = fs.readFileSync(SOURCE_PATH, 'utf-8');
  }

  it('fetchKisMarketProgramTrade import 존재', () => {
    expect(source).toMatch(/fetchKisMarketProgramTrade/);
  });

  it('ADR-0138 주석 + 시장 프로그램 매매 섹션 존재', () => {
    expect(source).toContain('ADR-0138');
    expect(source).toContain('시장 종합 프로그램 매매');
  });

  it('억원 환산 (100_000_000 분모) 적용', () => {
    expect(source).toMatch(/programNetBuyAmount\s*\/\s*100_000_000/);
  });

  it('programArbitrageNetBuy null 분기 (강제 0 fallback 차단)', () => {
    expect(source).toMatch(/programArbitrageNetBuy === null/);
  });

  it('정상 응답 시 programSource = KIS_API 영속', () => {
    expect(source).toMatch(/computed\.programSource\s*=\s*['"]KIS_API['"]/);
  });

  it('실패 시 programSource = NONE 영속 (silent degradation 차단)', () => {
    expect(source).toMatch(/computed\.programSource\s*=\s*['"]NONE['"]/);
  });

  it('정상 응답 시 4 필드 모두 영속 (Amount/Arbitrage/FetchedAt/Source)', () => {
    expect(source).toMatch(/computed\.programNetBuyAmount\s*=/);
    expect(source).toMatch(/computed\.programArbitrageNetBuy\s*=/);
    expect(source).toMatch(/computed\.programFetchedAt\s*=/);
  });

  it('catch graceful → null 폴백 (KIS throw 가 cron 차단 안 함)', () => {
    expect(source).toMatch(/fetchKisMarketProgramTrade\(\)\.catch\(\(\)\s*=>\s*null\)/);
  });

  it('진단 console.log 보강 — 차익 미수집 분기', () => {
    expect(source).toMatch(/KIS 시장 프로그램 매매/);
    expect(source).toMatch(/차익 미수집/);
  });
});

describe('marketDataRefresh ADR-0138 정합성', () => {
  let source: string;
  beforeAll();

  function beforeAll() {
    source = fs.readFileSync(SOURCE_PATH, 'utf-8');
  }

  it('FSS 수급 (③) 다음, KRX 공매도 (⑥) 이전에 위치 (③-c)', () => {
    const fssIdx = source.indexOf('③ FSS 수급');
    const programIdx = source.indexOf('ADR-0138');
    const shortIdx = source.indexOf('⑥ KRX 공매도');
    expect(fssIdx).toBeGreaterThan(0);
    expect(programIdx).toBeGreaterThan(fssIdx);
    expect(shortIdx).toBeGreaterThan(programIdx);
  });
});
