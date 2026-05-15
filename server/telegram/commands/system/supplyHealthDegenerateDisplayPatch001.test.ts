// @responsibility Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001 회귀 가드 — degenerate-zero -100% 라벨 + intraday endpoint wiring 결손 정직 안내.
import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Source-level static grep guards (모듈 import 없이 patch 의도 보존만 검증).
const SOURCE = fs.readFileSync('server/telegram/commands/system/supplyHealth.cmd.ts', 'utf-8');

describe('Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001 — formatPctValueWithZeroContext SSOT', () => {
  let resetEnv: (() => void) | null = null;

  beforeEach(() => {
    const original = process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED;
    delete process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED;
    resetEnv = () => {
      if (original === undefined) delete process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED;
      else process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED = original;
    };
  });

  afterEach(() => {
    if (resetEnv) resetEnv();
  });

  it('exports formatPctValueWithZeroContext SSOT (호출자 측 inline 분기 차단)', () => {
    expect(SOURCE).toContain('export function formatPctValueWithZeroContext');
    expect(SOURCE).toMatch(/formatPctValueWithZeroContext\(\s*value:\s*number\s*\|\s*null\s*\|\s*undefined,\s*latestActual:\s*number\s*\|\s*null\s*\|\s*undefined,?\s*\)/);
  });

  it('shortIncreaseRate display 가 formatPctValueWithZeroContext 사용 (degenerate -100% 컨텍스트)', () => {
    expect(SOURCE).toContain('formatPctValueWithZeroContext(kisPack.shortSelling?.shortSaleIncreaseRate, kisPack.shortSelling?.shortSaleRatio)');
    // Patch 추적 주석 + "전량 회복" 의도 라벨 둘 다 존재 (multi-line — 같은 라인 X)
    expect(SOURCE).toContain('Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001');
    expect(SOURCE).toContain('전량 회복');
  });

  it('ENV `SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED` 정확 비교 (ADR-0157, === \'true\' 또는 !== \'true\')', () => {
    // formatPctValueWithZeroContext (=== 'true') + renderRoutedMarketProgram (!== 'true') 두 위치 모두 정확 비교 사용.
    // ADR-0157 정확 비교 의무: '1' / 'TRUE' / 'yes' / 'on' 같은 fuzzy 비교 영구 금지.
    const exactEqual = SOURCE.match(/process\.env\.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED\s*===\s*'true'/g) || [];
    const exactNotEqual = SOURCE.match(/process\.env\.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED\s*!==\s*'true'/g) || [];
    expect(exactEqual.length + exactNotEqual.length).toBeGreaterThanOrEqual(2);
    // fuzzy 비교 영구 차단
    expect(SOURCE).not.toMatch(/SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED[^']*'1'/);
    expect(SOURCE).not.toMatch(/SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED[^']*'TRUE'/);
    expect(SOURCE).not.toMatch(/SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED[^']*'yes'/i);
  });

  it('-100% degenerate suffix runtime 검증 (latestActual === 0 이면 "전량 회복" 추가)', async () => {
    const mod = await import('./supplyHealth.cmd.js');
    const fn = (mod as unknown as { formatPctValueWithZeroContext: (v: number | null | undefined, l: number | null | undefined) => string }).formatPctValueWithZeroContext;
    expect(fn).toBeTypeOf('function');
    // shortRatio=0 + shortIncreaseRate=-100% → "전량 회복" suffix
    expect(fn(-100, 0)).toContain('전량 회복');
    expect(fn(-100, 0)).toContain('-100.00%');
    // shortRatio=0.001 (effectively zero) + shortIncreaseRate=-99.95% → "전량 회복" (boundary)
    expect(fn(-99.95, 0.001)).toContain('전량 회복');
  });

  it('-100% 가 아닌 정상 변화율은 byte-equivalent (suffix 없음)', async () => {
    const mod = await import('./supplyHealth.cmd.js');
    const fn = (mod as unknown as { formatPctValueWithZeroContext: (v: number | null | undefined, l: number | null | undefined) => string }).formatPctValueWithZeroContext;
    expect(fn(-50, 0)).toBe('-50.00%'); // 50% 감소 (0 이지만 -100% 가 아니므로 suffix 없음)
    expect(fn(-100, 5)).toBe('-100.00%'); // -100% 이지만 latestActual !== 0
    expect(fn(31, 25)).toBe('31.00%'); // 정상 양수
    expect(fn(0, 100)).toBe('0.00%'); // 0% 변화
  });

  it('null/undefined/NaN/Infinity → "N/A" (기존 formatPctValue 와 byte-equivalent)', async () => {
    const mod = await import('./supplyHealth.cmd.js');
    const fn = (mod as unknown as { formatPctValueWithZeroContext: (v: number | null | undefined, l: number | null | undefined) => string }).formatPctValueWithZeroContext;
    expect(fn(null, 0)).toBe('N/A');
    expect(fn(undefined, 0)).toBe('N/A');
    expect(fn(Number.NaN, 0)).toBe('N/A');
    expect(fn(Number.POSITIVE_INFINITY, 0)).toBe('N/A');
    expect(fn(-100, null)).toBe('-100.00%'); // latestActual unknown — suffix 없음 (보수적)
    expect(fn(-100, undefined)).toBe('-100.00%');
  });

  it('ENV ON 시 degenerate 분기 비활성 — 기존 formatPctValue 와 byte-equivalent', async () => {
    process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED = 'true';
    const mod = await import('./supplyHealth.cmd.js');
    const fn = (mod as unknown as { formatPctValueWithZeroContext: (v: number | null | undefined, l: number | null | undefined) => string }).formatPctValueWithZeroContext;
    expect(fn(-100, 0)).toBe('-100.00%'); // suffix 없음 (ENV disabled)
    expect(fn(-100, 0)).not.toContain('전량 회복');
  });

  it('ENV `=== "true"` 정확 비교 — "TRUE"/"1"/"yes" 거부', async () => {
    process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED = 'TRUE';
    let mod = await import('./supplyHealth.cmd.js');
    let fn = (mod as unknown as { formatPctValueWithZeroContext: (v: number | null | undefined, l: number | null | undefined) => string }).formatPctValueWithZeroContext;
    expect(fn(-100, 0)).toContain('전량 회복'); // "TRUE" 거부 → degenerate 분기 활성

    process.env.SUPPLY_HEALTH_DEGENERATE_DISPLAY_DISABLED = '1';
    mod = await import('./supplyHealth.cmd.js');
    fn = (mod as unknown as { formatPctValueWithZeroContext: (v: number | null | undefined, l: number | null | undefined) => string }).formatPctValueWithZeroContext;
    expect(fn(-100, 0)).toContain('전량 회복');
  });
});

describe('Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001 — UNSUPPORTED_INTRADAY 정직성 격상', () => {
  it('renderRoutedMarketProgram 가 isIntradayUnsupported 분기 보유', () => {
    expect(SOURCE).toMatch(/const isIntradayUnsupported\s*=/);
    expect(SOURCE).toContain("decision.routedStatus === 'UNSUPPORTED_INTRADAY'");
    expect(SOURCE).toContain('decision.isIntradaySession === true');
  });

  it('"정상 동작" 거짓 주장 부재 — Patch-006 가정 (KRX 자체 미지원) 미검증 명시', () => {
    // 이전 PR 의 misleading "정상 동작" 라벨 영구 차단 (사용자 지적 정합)
    expect(SOURCE).not.toContain('정상 동작: KRX 장중 endpoint 부재');
    // 정직한 안내 — endpoint wiring 결손 명시
    expect(SOURCE).toContain('주의: KRX intraday endpoint 미연동 가능성');
    expect(SOURCE).toContain('MDCSTAT01701'); // 현재 사용 중인 EOD-only endpoint 명시
    expect(SOURCE).toContain('MDCSTAT00301'); // 후속 PR 검증 대상 (KRX 일중 endpoint 후보)
    expect(SOURCE).toContain('endpoint wiring 검증 필요 (별도 PR)');
  });

  it('isIntradayUnsupported 시 riskReason 미노출 (NEUTRAL marker 유지하되 routedStatus name 미표시)', () => {
    // marker === 'NEUTRAL' 분기에서 isIntradayUnsupported 일 때 riskReason undefined
    expect(SOURCE).toMatch(/!isIntradayUnsupported\s*$/m);
  });

  it('Patch 추적 주석 Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001 포함', () => {
    const matches = SOURCE.match(/Patch-SUPPLY-HEALTH-DEGENERATE-DISPLAY-001/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2); // formatPctValueWithZeroContext + renderRoutedMarketProgram
  });

  it('LIVE 매매 본체 import 0건 (정적 grep 가드 — KIS 주문 함수 + autoTradeEngine + orderExecutor)', () => {
    // KIS 주문 5종 (절대 규칙 #2/#4)
    expect(SOURCE).not.toMatch(/import\s+.*\bplaceKisMarketBuyOrder\b/);
    expect(SOURCE).not.toMatch(/import\s+.*\bplaceKisMarketSellOrder\b/);
    expect(SOURCE).not.toMatch(/import\s+.*\bplaceKisStopLossOrder\b/);
    expect(SOURCE).not.toMatch(/import\s+.*\bplaceKisTakeProfitOrder\b/);
    expect(SOURCE).not.toMatch(/import\s+.*\bcancelKisOrder\b/);
    // 매매 엔진 본체
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*autoTradeEngine[^'"]*['"]/);
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*orderExecutor[^'"]*['"]/);
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*trancheExecutor[^'"]*['"]/);
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*entryEngine[^'"]*['"]/);
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*exitEngine[^'"]*['"]/);
    // 외부 fetch
    expect(SOURCE).not.toMatch(/import\s+axios\b/);
    expect(SOURCE).not.toMatch(/import\s+.*\bnodeFetch\b/);
    // signalScanner read-only consumer (scanDiagnostics + investorFlowProviderRouterAdr0477 진단 모듈) 만 허용 — 본체 import 없음
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*signalScanner['"]/); // signalScanner 본체 (sub-path 만 허용)
  });
});
