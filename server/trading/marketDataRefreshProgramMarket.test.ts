// @responsibility marketDataRefresh 시장 프로그램 매매 wiring 회귀 — ADR-0138.
// 정적 grep 가드 — 본 PR 의 wiring 위치 + 단위 환산 + programSource='NONE' 분기 검증.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const SOURCE_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh.ts');
// ADR-0589 분해: 프로그램 매매 순수 helper(buildUnitCandidates/snapshot 조립)는 추출 모듈로 이동.
const HELPERS_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh/helpers.ts');
// ADR-0595 분해: 프로그램 매매 섹션 본문(computeProgramMarketSnapshot/refreshProgramMarketSection)은
// marketDataRefresh/programMarketSection.ts 로 이동 — 본문 + 서브모듈을 함께 grep (ADR-0444 패턴).
const PROGRAM_PATH = path.join(process.cwd(), 'server/trading/marketDataRefresh/programMarketSection.ts');

describe('marketDataRefresh ADR-0138 wiring (정적 grep 가드)', () => {
  let source: string;
  let helpersSource: string;

  beforeAll();

  function beforeAll() {
    source = fs.readFileSync(SOURCE_PATH, 'utf-8') + fs.readFileSync(PROGRAM_PATH, 'utf-8');
    helpersSource = fs.readFileSync(HELPERS_PATH, 'utf-8');
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

  it('unit 미검증 및 불일치 시 shadow/excluded / execution NONE 강제', () => {
    expect(source).toMatch(/mappingConfidence:\s*'MAPPING_VERIFIED'/);
    expect(source).toMatch(/scoring:\s*\(invariants\.violated \|\| legInvariantViolated\) \? 'excluded' : 'advisory'/);
    expect(source).toMatch(/useForExecution:\s*false/);
    expect(source).toMatch(/executionImpact:\s*'NONE'/);
    expect(source).toMatch(/blockGateUsage:\s*true/);
    expect(source).toMatch(/blockRegimeUsage:\s*true/);
  });

  it('unitCandidates 3종(KRW/KRW_1K/KRW_1M) 계산 helper 존재', () => {
    expect(helpersSource).toMatch(/function buildUnitCandidates/);
    expect(helpersSource).toMatch(/KRW_1K:\s*formatEokAmount\(rawValue === null \? null : rawValue \* 1000/);
    expect(helpersSource).toMatch(/KRW_1M:\s*formatEokAmount\(rawValue === null \? null : rawValue \* 1_000_000/);
  });

  it('raw non-zero 보존 + structured 로그 태그 추가', () => {
    expect(source).toMatch(/rawNonZero/);
    expect(source).toContain('[PROGRAM_MARKET_RAW_NONZERO_PRESERVED]');
    expect(source).toContain('[PROGRAM_MARKET_REGIME_DECOUPLED]');
  });

  it('snapshotId 항상 생성 포맷 (mpg_yyyymmdd_HHmmss_random6)', () => {
    expect(helpersSource).toMatch(/mpg_\$\{ymd\}_\$\{hms\}_\$\{random6\}/);
  });

  it('invariant 위반 시 SNAPSHOT_INCONSISTENT + scoring excluded + executionImpact NONE', () => {
    expect(source).toContain("'SNAPSHOT_INCONSISTENT'");
    expect(source).toMatch(/scoring:\s*\(invariants\.violated \|\| legInvariantViolated\) \? 'excluded' : 'advisory'/);
    expect(source).toMatch(/executionImpact:\s*'NONE'/);
  });

  it('KOSPI/KOSDAQ 0행이면 KOSPI_PLUS_KOSDAQ 금지 invariant 존재', () => {
    expect(helpersSource).toMatch(/empty split rows cannot be KOSPI_PLUS_KOSDAQ/);
  });

  it('rows=[] 불변식: selected/raw/display 강제 null\/N\\/A', () => {
    expect(helpersSource).toMatch(/if \(rows\.length === 0\)/);
    expect(helpersSource).toMatch(/selectedBsopHour:\s*null/);
    expect(helpersSource).toMatch(/rawWholeNetBuy:\s*null/);
    expect(helpersSource).toMatch(/displayWholeNetBuy:\s*'N\/A'/);
  });

  it('rows=0인데 raw 존재 시 SNAPSHOT_INCONSISTENT 사유 RAW_EXISTS_WITH_EMPTY_ROWS', () => {
    expect(source).toMatch(/RAW_EXISTS_WITH_EMPTY_ROWS/);
    expect(source).toMatch(/leg\.rawWholeNetBuy !== null && leg\.outputLength === 0/);
  });

  it('split 0\/0이면 combinedSource KOSPI_PLUS_KOSDAQ 불가', () => {
    expect(helpersSource).toMatch(/if \(input\.kospiLen === 0 && input\.kosdaqLen === 0 && input\.combinedSource === 'KOSPI_PLUS_KOSDAQ'\)/);
  });

  it('KIS output 배열을 combined rows에 주입 (split unavailable 시 SINGLE_KIS_RESPONSE)', () => {
    expect(source).toMatch(/const kisRawOutput =/);
    expect(source).toMatch(/: \(\(\(\(bundle\.combined as any\)\?\.rows as Array<Record<string, unknown>> \| undefined\) \?\? kisRawOutput\)/);
  });



  it('rowBreakdown COMBINED raw는 snapshot.combined 합산값(sumNullablePair) 사용', () => {
    expect(source).toMatch(/const combinedWholeNetBuy = sumNullablePair\(kospiLeg\.rawWholeNetBuy, kosdaqLeg\.rawWholeNetBuy\)/);
    expect(source).toMatch(/const combinedArbitrageNetBuy = sumNullablePair\(kospiLeg\.rawArbitrageNetBuy, kosdaqLeg\.rawArbitrageNetBuy\)/);
    expect(source).toMatch(/const combinedNonArbitrageNetBuy = sumNullablePair\(kospiLeg\.rawNonArbitrageNetBuy, kosdaqLeg\.rawNonArbitrageNetBuy\)/);
    expect(source).toMatch(/rowBreakdown:\s*\{[\s\S]*combined:\s*\{[\s\S]*rawWholeNetBuy:\s*combinedWholeNetBuy,[\s\S]*rawArbitrageNetBuy:\s*combinedArbitrageNetBuy,[\s\S]*rawNonArbitrageNetBuy:\s*combinedNonArbitrageNetBuy,/);
  });

  it('rowBreakdown COMBINED는 KOSDAQ/loop 마지막 leg 직접 재사용 금지', () => {
    expect(source).not.toMatch(/rowBreakdown:\s*\{[\s\S]*combined:\s*\{[\s\S]*rawWholeNetBuy:\s*kosdaqLeg\.rawWholeNetBuy/);
    expect(source).not.toMatch(/rowBreakdown:\s*\{[\s\S]*combined:\s*\{[\s\S]*rawArbitrageNetBuy:\s*kosdaqLeg\.rawArbitrageNetBuy/);
    expect(source).not.toMatch(/rowBreakdown:\s*\{[\s\S]*combined:\s*\{[\s\S]*rawNonArbitrageNetBuy:\s*kosdaqLeg\.rawNonArbitrageNetBuy/);
  });

  it('COMBINED unitCandidates/display는 combined raw 기반', () => {
    expect(source).toMatch(/displayWholeNetBuy:\s*formatEokAmount\(combinedWholeNetBuy, 'KRW_1K'\)/);
    expect(source).toMatch(/unitCandidates:\s*buildUnitCandidates\(combinedWholeNetBuy\)/);
  });
  it('SINGLE_KIS_RESPONSE일 때 splitAvailable=false, combinedOnly=true 경로 존재', () => {
    expect(source).toMatch(/const provisionalSplitAvailable = combinedSource === 'KOSPI_PLUS_KOSDAQ' && hasSplitRows/);
    expect(source).toMatch(/const combinedOnly = !splitAvailable/);
  });

  it('display/final status 분리 및 SINGLE_RESPONSE_VERIFIED 상태 포함', () => {
    expect(source).toMatch(/'SINGLE_RESPONSE_VERIFIED'/);
    expect(source).toMatch(/rawStatus:\s*marketProgram\.marketProgramStatus/);
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
