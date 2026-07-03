// @responsibility Counterfactual KOSPI join display-only excess-return regression tests.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setKisClientOverrides } from '../clients/kisClient/overrides.js';
import type { KisSectorIndexDaily, KisSectorIndexDailyRow } from '../clients/kisClient/types.js';
import type { Gate1DryRunObservationRow } from '../trading/signalScanner/gate1DryRunObservationLedgerAdr0476.js';
import {
  buildCounterfactualKospiJoinContext,
  computeBandKospiExcessD5,
  computeBoardKospiContextD5,
  resetCounterfactualKospiJoinCacheForTest,
  type KospiJoinRowInput,
} from './counterfactualKospiJoin.js';
import {
  buildCounterfactualOutcomeBoard,
  formatCounterfactualGate1,
} from './counterfactualOutcomeBoard.js';

const NOW = new Date('2026-06-12T06:30:00.000Z');
const ORIGINAL_FLAG = process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;

function bar(baseDate: string, close: number): KisSectorIndexDailyRow {
  return { baseDate, close, open: close, high: close, low: close, volume: 1_000, value: 1_000 };
}

// 거래일 캘린더 fixture — 주말(06-06/07, 05-30/31) + 휴장(06-03) 갭 포함 오름차순 원본.
const SERIES_ASC: Array<[string, number]> = [
  ['20260528', 1990],
  ['20260529', 1995],
  ['20260601', 2000],
  ['20260602', 2010],
  ['20260604', 2020],
  ['20260605', 2030],
  ['20260608', 2040],
  ['20260609', 2050],
  ['20260610', 2060],
  ['20260611', 2070],
];

function kospiDaily(): KisSectorIndexDaily {
  return {
    sectorIscd: '0001',
    sectorName: '코스피',
    currentIndex: 2070,
    changePct: 0.5,
    // KIS 실응답은 최신순 — 모듈의 오름차순 정렬을 함께 검증한다.
    series: [...SERIES_ASC].reverse().map(([d, c]) => bar(d, c)),
    fetchedAt: '2026-06-12T06:30:00.000Z',
    source: 'KIS_API',
  };
}

function joinRow(recordedAt: string, kospiAtRecord: number | null = null, returnD5: number | null = null): KospiJoinRowInput {
  return { recordedAt, kospiAtRecord, returnD5 };
}

function installOverride(daily: KisSectorIndexDaily | null = kospiDaily()) {
  const fetchKisSectorIndexDaily = vi.fn(async (_sectorIscd: string) => daily);
  setKisClientOverrides({ fetchKisSectorIndexDaily });
  return fetchKisSectorIndexDaily;
}

function gate1Row(overrides: Partial<Gate1DryRunObservationRow> & Record<string, unknown> = {}): Gate1DryRunObservationRow {
  return {
    id: 'cf-gate1-138530',
    createdAt: '2026-06-02T06:00:00.000Z',
    forDate: '2026-06-02',
    scanId: 'scan-eval-20260602152915',
    sourceSnapshotId: 'snapshot-20260602152915',
    candidateSetId: 'candidate-set-20260602152915',
    source: 'GATE1_NEAR_MISS',
    symbol: '138530',
    name: 'A',
    actualGate1Passed: false,
    actualLiveEligible: false,
    dryRunDecision: 'NEAR_MISS',
    dryRunScenario: 'threshold-minus-5',
    dryRunScore: 68.4,
    requiredScore: 70,
    scoreSource: 'MIN_SIGNAL_TRACE',
    providerIssue: false,
    marketSignal: false,
    sectorEnergyDiagnosticOnly: false,
    sellOnly: false,
    entryReferencePrice: 10_000,
    gate2Evaluated: true,
    gate2Pass: false,
    gate2PrimaryBlocker: 'BREAKOUT_MOMENTUM_NOT_CONFIRMED',
    gate3Evaluated: true,
    gate3Readiness: 'PRE_BREAKOUT_WAIT',
    forwardReturn5D: 12.4,
    mfeD5: 15.1,
    maeD5: -1.8,
    status: 'MATURED_5D',
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
    ...overrides,
  } as Gate1DryRunObservationRow;
}

async function boardFor(rows: Gate1DryRunObservationRow[]) {
  return buildCounterfactualOutcomeBoard({
    now: NOW,
    gate1Rows: rows,
    counterfactualEntries: [],
    legacyEntries: [],
  });
}

beforeEach(() => {
  resetCounterfactualKospiJoinCacheForTest();
  setKisClientOverrides({});
  delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
});

afterEach(() => {
  setKisClientOverrides({});
});

afterAll(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.KIS_SECTOR_INDEX_DAILY_ENABLED;
  else process.env.KIS_SECTOR_INDEX_DAILY_ENABLED = ORIGINAL_FLAG;
});

describe('counterfactualKospiJoin — 거래일 산술', () => {
  it('D5 = bar index+5 (달력일 아님) — 주말/휴장 갭을 건너뛴다', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    expect(ctx.status).toBe('JOINED');
    // 20260602(i=3) → i+5 = 20260610 (달력일로는 8일 뒤): (2060/2010-1)*100 = 2.49
    expect(ctx.joinD5(joinRow('2026-06-02T06:00:00.000Z'))).toEqual({
      kospiReturnD5: 2.49,
      baseSource: 'DAY_CLOSE',
    });
  });

  it('기록일이 비거래일이면 그 이전 최근 거래일의 bar 를 i 로 사용한다', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-03T06:00:00.000Z')], NOW);
    // 20260603 휴장 → i = 20260602 → 20260602 기준과 동일.
    expect(ctx.joinD5(joinRow('2026-06-03T06:00:00.000Z')).kospiReturnD5).toBe(2.49);
  });

  it('bar[i+5] 가 시계열 끝을 넘으면(미성숙) null — 시계열 시작 이전 기록도 null', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-09T06:00:00.000Z')], NOW);
    expect(ctx.joinD5(joinRow('2026-06-09T06:00:00.000Z'))).toEqual({ kospiReturnD5: null, baseSource: null });
    expect(ctx.joinD5(joinRow('2026-05-01T06:00:00.000Z'))).toEqual({ kospiReturnD5: null, baseSource: null });
  });

  it('동일 조회창은 리포트당 1콜 — TTL 캐시로 재빌드 시 fetch 재호출 없음', async () => {
    const fetchMock = installOverride();
    const rows = [joinRow('2026-06-02T06:00:00.000Z')];
    await buildCounterfactualKospiJoinContext(rows, NOW);
    await buildCounterfactualKospiJoinContext(rows, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('0001');
  });
});

describe('counterfactualKospiJoin — base 우선순위', () => {
  it('kospiAtRecord 존재 시 base=AT_RECORD (기록 시점 지수 레벨 우선)', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    // base=2000 → (2060/2000-1)*100 = 3.00
    expect(ctx.joinD5(joinRow('2026-06-02T06:00:00.000Z', 2000))).toEqual({
      kospiReturnD5: 3,
      baseSource: 'AT_RECORD',
    });
  });

  it('kospiAtRecord 부재/무효(0 이하) 시 base=DAY_CLOSE (기록일 종가)', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    expect(ctx.joinD5(joinRow('2026-06-02T06:00:00.000Z', null)).baseSource).toBe('DAY_CLOSE');
    expect(ctx.joinD5(joinRow('2026-06-02T06:00:00.000Z', 0)).baseSource).toBe('DAY_CLOSE');
  });
});

describe('counterfactualKospiJoin — graceful UNAVAILABLE (providerIssue≠marketSignal)', () => {
  it('KIS null(flag OFF/미인증) → UNAVAILABLE, join 은 전부 null', async () => {
    // override 없음 + flag 미설정 → fetchKisSectorIndexDaily 가 null 반환 (네트워크 0콜).
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    expect(ctx.status).toBe('UNAVAILABLE');
    expect(ctx.reason).toBe('KIS_SECTOR_INDEX_DAILY_UNAVAILABLE');
    expect(ctx.joinD5(joinRow('2026-06-02T06:00:00.000Z'))).toEqual({ kospiReturnD5: null, baseSource: null });
  });

  it('fetch throw 도 UNAVAILABLE graceful — 예외 전파 없음', async () => {
    setKisClientOverrides({
      fetchKisSectorIndexDaily: vi.fn(async () => {
        throw new Error('transport down');
      }),
    });
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    expect(ctx.status).toBe('UNAVAILABLE');
  });

  it('rows 비어있으면 KIS 콜 0 (NO_ROWS)', async () => {
    const fetchMock = installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([], NOW);
    expect(ctx.status).toBe('UNAVAILABLE');
    expect(ctx.reason).toBe('NO_ROWS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('counterfactualKospiJoin — 밴드 집계 정합 (양음 혼합)', () => {
  it('avgExcessD5/winVsMarketD5/kospiJoinedD5 — 양쪽 D5 존재 row 만 표본', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    const rows = [
      joinRow('2026-06-02T06:00:00.000Z', null, 12.4), // excess +9.91, win
      joinRow('2026-06-02T06:00:00.000Z', null, -2), // excess -4.49, lose
      joinRow('2026-06-02T06:00:00.000Z', null, null), // stock D5 미성숙 → 표본 제외
      joinRow('2026-06-09T06:00:00.000Z', null, 5), // KOSPI D5 미성숙 → 표본 제외
    ];
    expect(computeBandKospiExcessD5(rows, ctx)).toEqual({
      avgExcessD5: 2.71,
      winVsMarketD5: 0.5,
      kospiJoinedD5: 2,
      // 두 row 모두 kospiReturnD5=+2.49 > 0 → 상승창. 짝수(2) median = 중앙 2개 평균 = avg.
      marketUpD5: { n: 2, avgExcessD5: 2.71, winVsMarketD5: 0.5 },
      marketDownD5: { n: 0, avgExcessD5: null, winVsMarketD5: null },
      medianExcessD5: 2.71,
    });
    expect(computeBoardKospiContextD5(rows, ctx)).toEqual({
      kospiAvgD5: 2.49,
      kospiJoinStatus: 'JOINED',
    });
  });

  it('표본 0 이면 null/0 (N/A 표기 경로)', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    expect(computeBandKospiExcessD5([joinRow('2026-06-02T06:00:00.000Z', null, null)], ctx)).toEqual({
      avgExcessD5: null,
      winVsMarketD5: null,
      kospiJoinedD5: 0,
      marketUpD5: { n: 0, avgExcessD5: null, winVsMarketD5: null },
      marketDownD5: { n: 0, avgExcessD5: null, winVsMarketD5: null },
      medianExcessD5: null,
    });
  });
});

describe('counterfactualKospiJoin — 시장 국면 bucket 분해 + median (patch 2)', () => {
  // kospiAtRecord 로 base 를 제어해 kospiReturnD5 부호를 혼합한다 (target=20260610 close 2060).
  it('mktUp(>0)/mktDn(<=0) bucket n·avg·winVsMkt 정합 — 경계 kospiReturnD5=0 은 mktDn 포함', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    const rows = [
      joinRow('2026-06-02T06:00:00.000Z', 2000, 5), // kospi +3.00 → Up, excess +2.0 win
      joinRow('2026-06-02T06:00:00.000Z', 2000, 2), // kospi +3.00 → Up, excess -1.0 lose
      joinRow('2026-06-02T06:00:00.000Z', 2060, 2), // kospi 0.00 경계 → Dn, excess +2.0 win
      joinRow('2026-06-02T06:00:00.000Z', 2100, -4), // kospi -1.90 → Dn, excess -2.1 lose
    ];
    const agg = computeBandKospiExcessD5(rows, ctx);
    expect(agg.kospiJoinedD5).toBe(4);
    expect(agg.marketUpD5).toEqual({ n: 2, avgExcessD5: 0.5, winVsMarketD5: 0.5 });
    expect(agg.marketDownD5).toEqual({ n: 2, avgExcessD5: -0.05, winVsMarketD5: 0.5 });
    // 짝수(4) median = 중앙 2개(-1.0, +2.0) 평균 = +0.5.
    expect(agg.medianExcessD5).toBe(0.5);
  });

  it('경계 단독 검증 — kospiReturnD5=0 인 row 는 mktUp 이 아니라 mktDn 에만 집계된다', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    const agg = computeBandKospiExcessD5([joinRow('2026-06-02T06:00:00.000Z', 2060, 1)], ctx);
    expect(agg.marketUpD5).toEqual({ n: 0, avgExcessD5: null, winVsMarketD5: null });
    expect(agg.marketDownD5).toEqual({ n: 1, avgExcessD5: 1, winVsMarketD5: 1 });
  });

  it('median 홀수 표본 + 복권형 왜곡 — avgExcessD5 양수인데 medianExcessD5 음수', async () => {
    installOverride();
    const ctx = await buildCounterfactualKospiJoinContext([joinRow('2026-06-02T06:00:00.000Z')], NOW);
    const rows = [
      joinRow('2026-06-02T06:00:00.000Z', 2000, 13), // excess +10 (복권 1건이 평균을 끌어올림)
      joinRow('2026-06-02T06:00:00.000Z', 2000, 2), // excess -1
      joinRow('2026-06-02T06:00:00.000Z', 2000, 1), // excess -2
    ];
    const agg = computeBandKospiExcessD5(rows, ctx);
    expect(agg.avgExcessD5).toBe(2.33); // (10-1-2)/3 — 평균만 보면 양수
    expect(agg.medianExcessD5).toBe(-1); // 홀수(3) median = 중앙값 — 표본 다수는 음수
  });
});

describe('counterfactual board + /counterfactual_gate1 렌더 통합', () => {
  const bandRows = () => [
    gate1Row(),
    gate1Row({ id: 'cf-gate1-007390', symbol: '007390', dryRunScore: 66, forwardReturn5D: -2, mfeD5: 1, maeD5: -6 }),
  ];

  it('JOINED: 밴드 additive 필드 + board 시장 컨텍스트 + 렌더 컬럼', async () => {
    installOverride();
    const board = await boardFor(bandRows());
    expect(board.kospiJoinStatus).toBe('JOINED');
    expect(board.kospiAvgD5).toBe(2.49);
    const band = board.gate1Bands.find((b) => b.key === '65~70');
    expect(band?.avgExcessD5).toBe(2.71);
    expect(band?.winVsMarketD5).toBe(0.5);
    expect(band?.kospiJoinedD5).toBe(2);

    const text = formatCounterfactualGate1(board);
    expect(text).toContain('excessD5=+2.71% winVsMkt=50% (idx n=2)');
    // 표본 없는 밴드는 N/A + n=0.
    expect(text).toContain('excessD5=N/A winVsMkt=N/A (idx n=0)');
    expect(text).toContain('kospiD5Avg=+2.49% joinStatus=JOINED');
    // patch 2: joined 표본>0 밴드 라인 바로 아래 시장 국면 서브라인 1줄 (표본 0 밴드는 서브라인 없음).
    const lines = text.split('\n');
    const bandLineIdx = lines.findIndex((line) => line.startsWith('65~70:'));
    expect(lines[bandLineIdx + 1]).toBe(
      '  ↳ mktUp n=2 excess=+2.71% winVsMkt=50% | mktDn n=0 excess=N/A | medianExcess=+2.71%',
    );
    expect(text.split('↳').length - 1).toBe(1);
  });

  it('UNAVAILABLE: excessD5=N/A graceful + 기존 밴드 값 무변경 (additive 검증)', async () => {
    installOverride();
    const joined = await boardFor(bandRows());
    resetCounterfactualKospiJoinCacheForTest();
    setKisClientOverrides({});
    const unavailable = await boardFor(bandRows());

    expect(unavailable.kospiJoinStatus).toBe('UNAVAILABLE');
    expect(unavailable.kospiAvgD5).toBeNull();
    // kospi additive 필드를 제외하면 밴드 집계가 byte 동일 — 기존 값 무변경.
    const strip = (bands: typeof joined.gate1Bands) =>
      bands.map(({ avgExcessD5, winVsMarketD5, kospiJoinedD5, marketUpD5, marketDownD5, medianExcessD5, ...rest }) => rest);
    expect(strip(unavailable.gate1Bands)).toEqual(strip(joined.gate1Bands));
    expect(unavailable.gate1Bands.every((b) => b.kospiJoinedD5 === 0 && b.avgExcessD5 === null)).toBe(true);

    const text = formatCounterfactualGate1(unavailable);
    expect(text).toContain('excessD5=N/A(idx=UNAVAILABLE)');
    expect(text).toContain('kospiD5Avg=N/A joinStatus=UNAVAILABLE');
    expect(text).not.toContain('winVsMkt=');
    expect(text).toContain('thresholdAutoChanged=false');
    // patch 2: UNAVAILABLE 이면 시장 국면 서브라인 자체 생략 — kospi additive 필드를 전부 제거한
    // board 와 렌더 byte 동일 = UNAVAILABLE 경로 기존 출력 무변경 증명.
    expect(text).not.toContain('↳');
    expect(text).not.toContain('mktUp');
    const prePatch2Shape = { ...unavailable, gate1Bands: strip(unavailable.gate1Bands) } as typeof unavailable;
    expect(formatCounterfactualGate1(prePatch2Shape)).toBe(text);
  });

  it('gate2/gate3 뷰(밴드 공용 포매터)는 kospi suffix 미출력 — byte 무변경', async () => {
    installOverride();
    const board = await boardFor(bandRows());
    const { formatCounterfactualGate2, formatCounterfactualGate3 } = await import('./counterfactualOutcomeBoardFormat.js');
    expect(formatCounterfactualGate2(board)).not.toContain('excessD5=');
    expect(formatCounterfactualGate3(board)).not.toContain('excessD5=');
    expect(formatCounterfactualGate2(board)).not.toContain('↳');
    expect(formatCounterfactualGate3(board)).not.toContain('↳');
  });
});
