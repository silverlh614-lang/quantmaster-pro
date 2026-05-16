/**
 * shadowTradeRepo.test.ts — computeShadowMonthlyStats 계약 테스트.
 *
 * SSOT(fills) 기반 당월 종결 집계를 검증한다.
 * - WIN/LOSS 혼합
 * - 미결 포지션 카운트
 * - 표본 부족 플래그
 * - STRONG_BUY 승률 분리
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('computeShadowMonthlyStats', () => {
  let tmpDir: string;
  let repo: typeof import('./shadowTradeRepo.js');

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-stats-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // 동적 import — PERSIST_DATA_DIR 반영된 이후 paths.ts 가 해석되도록.
    repo = await import('./shadowTradeRepo.js');
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  const thisMonth = new Date().toISOString().slice(0, 7);
  const ymd = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
    return d.toISOString();
  };

  function makeTrade(opts: {
    id: string;
    status: 'HIT_TARGET' | 'HIT_STOP' | 'ACTIVE' | 'PENDING';
    exitTime?: string;
    entryPrice: number;
    exitPrice?: number;
    qty: number;
    signalGrade?: 'STRONG_BUY' | 'BUY';
  }) {
    const pnlPct = opts.exitPrice != null
      ? ((opts.exitPrice - opts.entryPrice) / opts.entryPrice) * 100
      : 0;
    const pnl = opts.exitPrice != null ? (opts.exitPrice - opts.entryPrice) * opts.qty : 0;
    const fills: any[] = [
      {
        id: `${opts.id}-b`,
        type: 'BUY',
        qty: opts.qty,
        price: opts.entryPrice,
        reason: 'init',
        timestamp: ymd(-5),
        status: 'CONFIRMED',
      },
    ];
    if (opts.exitPrice != null) {
      fills.push({
        id: `${opts.id}-s`,
        type: 'SELL',
        qty: opts.qty,
        price: opts.exitPrice,
        pnl,
        pnlPct,
        reason: 'exit',
        timestamp: opts.exitTime ?? ymd(-1),
        status: 'CONFIRMED',
      });
    }
    const trade: any = {
      id: opts.id,
      stockCode: opts.id,
      stockName: `종목${opts.id}`,
      signalTime: ymd(-5),
      signalPrice: opts.entryPrice,
      shadowEntryPrice: opts.entryPrice,
      quantity: opts.exitPrice != null ? 0 : opts.qty,
      stopLoss: opts.entryPrice * 0.95,
      targetPrice: opts.entryPrice * 1.1,
      status: opts.status,
      exitPrice: opts.exitPrice,
      exitTime: opts.exitTime,
      fills,
    };
    if (opts.signalGrade) {
      trade.entryKellySnapshot = {
        tier: 'CONVICTION',
        signalGrade: opts.signalGrade,
        rawKellyMultiplier: 0.5,
        effectiveKelly: 0.3,
        fractionalCap: 0.5,
        ipsAtEntry: 65,
        regimeAtEntry: 'R2_BULL',
        accountRiskBudgetPctAtEntry: 2,
        confidenceModifier: 1,
        snapshotAt: ymd(-5),
      };
    }
    return trade;
  }

  it('WIN/LOSS 혼합 + STRONG_BUY 승률 분리', () => {
    const thisMonthISO = `${thisMonth}-15T10:00:00.000Z`;
    const trades = [
      // 2 WIN (STRONG_BUY × 1)
      makeTrade({ id: 'A', status: 'HIT_TARGET', entryPrice: 10_000, exitPrice: 11_000, qty: 10, exitTime: thisMonthISO, signalGrade: 'STRONG_BUY' }),
      makeTrade({ id: 'B', status: 'HIT_TARGET', entryPrice: 20_000, exitPrice: 21_000, qty: 5,  exitTime: thisMonthISO, signalGrade: 'BUY' }),
      // 1 LOSS (STRONG_BUY)
      makeTrade({ id: 'C', status: 'HIT_STOP', entryPrice: 30_000, exitPrice: 27_000, qty: 3, exitTime: thisMonthISO, signalGrade: 'STRONG_BUY' }),
      // 미결
      makeTrade({ id: 'D', status: 'ACTIVE', entryPrice: 40_000, qty: 2 }),
      makeTrade({ id: 'E', status: 'PENDING', entryPrice: 50_000, qty: 1 }),
    ];
    repo.saveShadowTrades(trades);

    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.month).toBe(thisMonth);
    expect(stats.totalClosed).toBe(3);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(66.67, 1);
    expect(stats.openPositions).toBe(2);
    // avg netPct = mean(10, 5, -10) = 5/3 ≈ 1.67
    expect(stats.avgReturnPct).toBeCloseTo(5 / 3, 1);
    // STRONG_BUY: A WIN, C LOSS → 50%
    expect(stats.strongBuyWinRate).toBeCloseTo(50, 1);
    // 표본 3 < 5
    expect(stats.sampleSufficient).toBe(false);
    // Profit factor = (10+5)/10 = 1.5
    expect(stats.profitFactor).toBeCloseTo(1.5, 2);
  });

  it('TP1 후 본절 종료는 WIN_BREAKEVEN으로 월간 통계에 반영하고 lossCount를 늘리지 않는다', () => {
    const thisMonthISO = `${thisMonth}-16T10:00:00.000Z`;
    const trade = makeTrade({
      id: 'TP1BE',
      status: 'HIT_STOP',
      entryPrice: 10_000,
      exitPrice: 10_000,
      qty: 10,
      exitTime: thisMonthISO,
    });
    trade.fills = [
      { id: 'TP1BE-b', type: 'BUY', qty: 10, price: 10_000, reason: 'init', timestamp: ymd(-5), status: 'CONFIRMED' },
      { id: 'TP1BE-tp1', type: 'SELL', subType: 'PARTIAL_TP', qty: 5, price: 11_000, pnl: 5_000, pnlPct: 10, reason: 'tp1', timestamp: thisMonthISO, status: 'CONFIRMED' },
      { id: 'TP1BE-be', type: 'SELL', subType: 'STOP_LOSS', qty: 5, price: 10_000, pnl: 0, pnlPct: 0, reason: 'entry stop', timestamp: thisMonthISO, status: 'CONFIRMED' },
    ];
    repo.saveShadowTrades([trade]);

    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(1);
    expect(stats.winBreakevens).toBe(1);
    expect(stats.losses).toBe(0);
    expect(stats.economicWinRate).toBe(100);
    expect(stats.riskControlSuccessRate).toBe(100);
  });

  it('표본 부족 플래그 — 당월 종결 1건', () => {
    const thisMonthISO = `${thisMonth}-05T10:00:00.000Z`;
    repo.saveShadowTrades([
      makeTrade({ id: 'X', status: 'HIT_TARGET', entryPrice: 1_000, exitPrice: 1_050, qty: 5, exitTime: thisMonthISO }),
    ]);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(1);
    expect(stats.sampleSufficient).toBe(false);
    expect(stats.openPositions).toBe(0);
    expect(stats.profitFactor).toBeNull(); // 손실 없음
  });

  it('표본 ≥ 5 이면 sampleSufficient=true', () => {
    const thisMonthISO = `${thisMonth}-10T10:00:00.000Z`;
    const trades = Array.from({ length: 5 }).map((_, i) => makeTrade({
      id: `T${i}`,
      status: i % 2 === 0 ? 'HIT_TARGET' : 'HIT_STOP',
      entryPrice: 10_000,
      exitPrice: i % 2 === 0 ? 11_000 : 9_500,
      qty: 1,
      exitTime: thisMonthISO,
    }));
    repo.saveShadowTrades(trades);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(5);
    expect(stats.sampleSufficient).toBe(true);
  });

  it('당월 밖 exitTime 은 집계에서 제외', () => {
    const thisMonthISO = `${thisMonth}-10T10:00:00.000Z`;
    const otherMonth = '2020-01-15T10:00:00.000Z';
    repo.saveShadowTrades([
      makeTrade({ id: 'M', status: 'HIT_TARGET', entryPrice: 1000, exitPrice: 1100, qty: 1, exitTime: thisMonthISO }),
      makeTrade({ id: 'N', status: 'HIT_TARGET', entryPrice: 1000, exitPrice: 1200, qty: 1, exitTime: otherMonth }),
    ]);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(1);
  });

  it('종결/미결 모두 없으면 zero 집계', () => {
    repo.saveShadowTrades([]);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    expect(stats.totalClosed).toBe(0);
    expect(stats.openPositions).toBe(0);
    expect(stats.winRate).toBe(0);
    expect(stats.avgReturnPct).toBe(0);
    expect(stats.profitFactor).toBeNull();
    expect(stats.sampleSufficient).toBe(false);
  });

  // ADR-0005: 레거시 trade (entryKellySnapshot 미존재) 에서도 profileType + RRR + 강세 레짐
  // 조건으로 STRONG_BUY 승률을 복원해 SHADOW 졸업 조건이 막히지 않도록 한다.
  it('ADR-0005 STRONG_BUY fallback — 레거시 trade 복원', () => {
    const thisMonthISO = `${thisMonth}-12T09:00:00.000Z`;
    const trades: any[] = [
      // 1) snapshot 없지만 profileType A + RRR 3.2 + R2_BULL → fallback STRONG_BUY, WIN
      {
        ...makeTrade({ id: 'LEG1', status: 'HIT_TARGET', entryPrice: 10_000, exitPrice: 11_500, qty: 10, exitTime: thisMonthISO }),
        profileType: 'A',
        entryRegime: 'R2_BULL',
        preMortemStructured: { targetScenario: { rrr: 3.2, targetPrice: 13_200, expectedDays: 20, profitTrancheCount: 3 } },
      },
      // 2) 동일 조건, LOSS
      {
        ...makeTrade({ id: 'LEG2', status: 'HIT_STOP', entryPrice: 20_000, exitPrice: 18_000, qty: 5, exitTime: thisMonthISO }),
        profileType: 'B',
        entryRegime: 'R1_TURBO',
        preMortemStructured: { targetScenario: { rrr: 3.5, targetPrice: 27_000, expectedDays: 10, profitTrancheCount: 3 } },
      },
      // 3) fallback 제외 — RRR 2.5 미달
      {
        ...makeTrade({ id: 'LEG3', status: 'HIT_TARGET', entryPrice: 30_000, exitPrice: 31_000, qty: 1, exitTime: thisMonthISO }),
        profileType: 'A',
        entryRegime: 'R2_BULL',
        preMortemStructured: { targetScenario: { rrr: 2.5, targetPrice: 33_000, expectedDays: 15, profitTrancheCount: 3 } },
      },
      // 4) fallback 제외 — R4_NEUTRAL 은 강세 레짐 아님
      {
        ...makeTrade({ id: 'LEG4', status: 'HIT_TARGET', entryPrice: 40_000, exitPrice: 42_000, qty: 1, exitTime: thisMonthISO }),
        profileType: 'A',
        entryRegime: 'R4_NEUTRAL',
        preMortemStructured: { targetScenario: { rrr: 3.5, targetPrice: 45_000, expectedDays: 15, profitTrancheCount: 3 } },
      },
    ];
    repo.saveShadowTrades(trades);
    const stats = repo.computeShadowMonthlyStats(thisMonth);
    // LEG1(WIN) + LEG2(LOSS) 만 STRONG_BUY 로 인정 → 50%
    expect(stats.strongBuyWinRate).toBeCloseTo(50, 1);

    // 명시적 signalGrade 가 'BUY' 로 설정된 trade 는 fallback 으로 승격되지 않아야 함
    const explicitBuy = {
      ...makeTrade({ id: 'EXB', status: 'HIT_TARGET', entryPrice: 10_000, exitPrice: 11_000, qty: 1, exitTime: thisMonthISO, signalGrade: 'BUY' }),
      profileType: 'A',
      entryRegime: 'R2_BULL',
      preMortemStructured: { targetScenario: { rrr: 4.0, targetPrice: 14_000, expectedDays: 20, profitTrancheCount: 3 } },
    };
    repo.saveShadowTrades([...trades, explicitBuy]);
    const stats2 = repo.computeShadowMonthlyStats(thisMonth);
    // 여전히 STRONG_BUY 2건만 (LEG1/LEG2) 인정
    expect(stats2.totalClosed).toBe(5);
    // strongBuyWinRate 은 LEG1(WIN) + LEG2(LOSS) 기준 50%
    expect(stats2.strongBuyWinRate).toBeCloseTo(50, 1);
  });
});

// ─── ADR-0060: sector 영속 + lazy 백필 ─────────────────────────────────────────

describe('ADR-0060 sector 영속 + 레거시 백필', () => {
  let tmpDir: string;
  let repo: typeof import('./shadowTradeRepo.js');
  let shadowFilePath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-sector-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // paths.ts 는 module top-level 에서 DATA_DIR 을 박제하므로 vi.resetModules() 로
    // 캐시 강제 무효화. 같은 프로세스 내 다른 describe 의 PERSIST_DATA_DIR 누수 차단.
    vi.resetModules();
    // 동적 import — PERSIST_DATA_DIR 반영된 이후 paths.ts 가 해석되도록.
    repo = await import('./shadowTradeRepo.js');
    // 실제 사용된 SHADOW_FILE 경로 — paths.ts 가 module top-level 캐시되므로
    // import 시점의 DATA_DIR 을 그대로 가져온다.
    const paths = await import('./paths.js');
    shadowFilePath = paths.SHADOW_FILE;
  });

  afterEach(() => {
    delete process.env.PERSIST_DATA_DIR;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  function makeMinimalTrade(code: string, sector?: string): any {
    return {
      id: `T-${code}`,
      stockCode: code,
      stockName: `종목${code}`,
      signalTime: new Date().toISOString(),
      signalPrice: 10_000,
      shadowEntryPrice: 10_000,
      quantity: 10,
      stopLoss: 9_000,
      targetPrice: 11_000,
      status: 'PENDING',
      ...(sector !== undefined ? { sector } : {}),
    };
  }

  it('sector 명시 영속 round-trip — 저장한 값이 그대로 로드', () => {
    const original = [
      makeMinimalTrade('005930', '반도체'),
      makeMinimalTrade('035420', 'IT서비스'),
    ];
    repo.saveShadowTrades(original);

    const loaded = repo.loadShadowTrades();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.sector).toBe('반도체');
    expect(loaded[1]?.sector).toBe('IT서비스');
  });

  it('레거시 trade(sector 부재) → loadShadowTrades 진입 시 lazy 백필', () => {
    // sector 없이 직접 디스크에 기록된 레거시 데이터 시뮬레이션.
    const legacy = [makeMinimalTrade('005930')]; // 삼성전자 (sector 부재)
    repo.saveShadowTrades(legacy);

    const loaded = repo.loadShadowTrades();
    // SECTOR_MAP MANUAL_OVERRIDES 에 005930 → '반도체' 등록되어 있어야 백필.
    expect(loaded[0]?.sector).toBeDefined();
    expect(loaded[0]?.sector).toBe('반도체');
  });

  it('이미 sector 가 있는 trade 는 백필이 덮어쓰지 않음', () => {
    // 사용자가 일부러 다른 sector 값을 설정한 경우 보존되어야 한다.
    const explicit = [makeMinimalTrade('005930', '커스텀섹터')];
    repo.saveShadowTrades(explicit);

    const loaded = repo.loadShadowTrades();
    expect(loaded[0]?.sector).toBe('커스텀섹터');
  });

  it('sectorMap 미커버 종목은 "미분류" fallback 으로 sector 채움', () => {
    // 999999 는 SECTOR_MAP/KRX 자동맵 모두 미커버 → getSectorByCode '미분류' 반환.
    const unknown = [makeMinimalTrade('999999')];
    repo.saveShadowTrades(unknown);

    const loaded = repo.loadShadowTrades();
    // '미분류' 도 truthy string 이라 sector 필드는 채워짐.
    expect(loaded[0]?.sector).toBe('미분류');
  });

  it('saveShadowTrades 는 sector 필드를 포함해 디스크 영속', () => {
    const trades = [makeMinimalTrade('005930', '반도체')];
    repo.saveShadowTrades(trades);

    // 디스크 raw read — paths.ts 가 module top-level 에서 박제한 SHADOW_FILE 사용.
    const raw = fs.readFileSync(shadowFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sector).toBe('반도체');
  });

  // ─── ADR-0028 §PR-D3-C: PriceBase 메타 영속 round-trip ────────────────────
  it('entryPriceMetadata 영속 round-trip — 저장한 PriceBase 가 그대로 로드', () => {
    const trade = makeMinimalTrade('005930', '반도체');
    trade.entryPriceMetadata = {
      value: 70000,
      asOf: '2026-04-28T00:00:00.000Z',
      source: 'KIS_REALTIME',
    };
    repo.saveShadowTrades([trade]);
    const loaded = repo.loadShadowTrades();
    expect(loaded[0]?.entryPriceMetadata).toBeDefined();
    expect(loaded[0]?.entryPriceMetadata?.value).toBe(70000);
    expect(loaded[0]?.entryPriceMetadata?.asOf).toBe('2026-04-28T00:00:00.000Z');
    expect(loaded[0]?.entryPriceMetadata?.source).toBe('KIS_REALTIME');
  });

  it('PositionFill.priceMetadata 영속 round-trip — fill 시점 메타 보존', () => {
    const trade = makeMinimalTrade('005930');
    trade.fills = [{
      id: 'f1',
      type: 'BUY',
      qty: 10,
      price: 70000,
      reason: 'INITIAL_BUY',
      timestamp: '2026-04-28T01:00:00.000Z',
      priceMetadata: {
        value: 70000,
        asOf: '2026-04-28T01:00:00.000Z',
        source: 'KIS_REALTIME',
        staleAfterDays: 1,
      },
    }];
    repo.saveShadowTrades([trade]);
    const loaded = repo.loadShadowTrades();
    expect(loaded[0]?.fills?.[0]?.priceMetadata).toBeDefined();
    expect(loaded[0]?.fills?.[0]?.priceMetadata?.source).toBe('KIS_REALTIME');
    expect(loaded[0]?.fills?.[0]?.priceMetadata?.staleAfterDays).toBe(1);
  });

  it('레거시 trade (entryPriceMetadata 부재) 정상 로드 — 후방호환', () => {
    const legacy = makeMinimalTrade('035420');
    expect((legacy as Record<string, unknown>).entryPriceMetadata).toBeUndefined();
    repo.saveShadowTrades([legacy]);
    const loaded = repo.loadShadowTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.entryPriceMetadata).toBeUndefined();
    // 다른 필드는 정상 영속
    expect(loaded[0]?.shadowEntryPrice).toBe(10_000);
  });

  it('priceMetadata + entryPriceMetadata 동시 영속 — 두 메타 모두 보존', () => {
    const trade = makeMinimalTrade('005930', '반도체');
    trade.entryPriceMetadata = {
      value: 70000,
      asOf: '2026-04-28T00:00:00.000Z',
      source: 'KIS_REALTIME',
    };
    trade.fills = [{
      id: 'f1',
      type: 'SELL',
      qty: 5,
      price: 71000,
      reason: 'PARTIAL_TP',
      timestamp: '2026-04-28T05:00:00.000Z',
      priceMetadata: {
        value: 71000,
        asOf: '2026-04-28T05:00:00.000Z',
        source: 'KIS_REALTIME',
      },
    }];
    repo.saveShadowTrades([trade]);
    const loaded = repo.loadShadowTrades();
    expect(loaded[0]?.entryPriceMetadata?.value).toBe(70000);
    expect(loaded[0]?.fills?.[0]?.priceMetadata?.value).toBe(71000);
  });

  it('디스크 raw read — entryPriceMetadata 가 JSON 직렬화로 그대로 저장', () => {
    const trade = makeMinimalTrade('005930');
    trade.entryPriceMetadata = {
      value: 70000,
      asOf: '2026-04-28T00:00:00.000Z',
      source: 'YAHOO_INTRADAY',
    };
    repo.saveShadowTrades([trade]);
    const raw = fs.readFileSync(shadowFilePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed[0].entryPriceMetadata.source).toBe('YAHOO_INTRADAY');
    expect(parsed[0].entryPriceMetadata.value).toBe(70000);
  });
});
