// @responsibility marketDataRefresh ADR-0141 Stage 1 wiring 회귀 — 정적 grep 가드.
import { describe, expect, it, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh.ts');

describe('marketDataRefresh ADR-0141 Stage 1 wiring (정적 grep 가드)', () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_PATH, 'utf-8');
  });

  it('appendFssDetailRecord import 존재', () => {
    expect(source).toMatch(/import.*appendFssDetailRecord.*fssDetailRepo/);
  });

  it('fetchInvestorTradingDetail import 존재', () => {
    expect(source).toMatch(/import.*fetchInvestorTradingDetail.*krxClient/);
  });

  it('ADR-0141 주석 + Stage 1 raw 영속 명문화', () => {
    expect(source).toContain('ADR-0141');
    expect(source).toMatch(/Stage 1/);
    expect(source).toMatch(/매핑 미적용|raw/);
  });

  it('정상 응답 시 fssDetailSource = KRX_BLD 영속', () => {
    expect(source).toMatch(/computed\.fssDetailSource\s*=\s*['"]KRX_BLD['"]/);
  });

  it('실패 시 fssDetailSource = NONE 영속 (silent degradation 차단)', () => {
    expect(source).toMatch(/computed\.fssDetailSource\s*=\s*['"]NONE['"]/);
  });

  it('FSS_DETAIL_FETCHER_DISABLED ENV 우회', () => {
    expect(source).toMatch(/FSS_DETAIL_FETCHER_DISABLED/);
  });

  it('try/catch 격리 (KRX throw 가 cron 차단 안 함)', () => {
    const callIdx = source.indexOf('fetchInvestorTradingDetail()');
    expect(callIdx).toBeGreaterThan(0);
    const beforeCall = source.slice(0, callIdx);
    const lastTry = beforeCall.lastIndexOf('try {');
    expect(lastTry).toBeGreaterThan(callIdx - 500);
  });

  it('appendFssDetailRecord 호출 — date/rows/fetchedAt 3 필드 영속', () => {
    expect(source).toMatch(/appendFssDetailRecord\(\s*\{[\s\S]{0,200}date:/);
    expect(source).toMatch(/appendFssDetailRecord\(\s*\{[\s\S]{0,200}rows:/);
    expect(source).toMatch(/appendFssDetailRecord\(\s*\{[\s\S]{0,200}fetchedAt:/);
  });

  it('⑥-c 섹션 위치 — KRX 공매도(⑥) 다음, FRED(⑧) 이전', () => {
    const shortIdx = source.indexOf('⑥ KRX 공매도');
    const stage1Idx = source.indexOf('ADR-0141');
    const fredIdx = source.indexOf('⑧ FRED');
    expect(shortIdx).toBeGreaterThan(0);
    expect(stage1Idx).toBeGreaterThan(shortIdx);
    expect(fredIdx).toBeGreaterThan(stage1Idx);
  });
});
