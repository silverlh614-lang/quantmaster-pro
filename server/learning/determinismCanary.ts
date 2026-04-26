/**
 * @responsibility 매일 02:00 fixture 5건 게이트 평가 결과를 어제값과 비교해 비결정성 출현을 알린다.
 *
 * 결정성 패치 Tier 2 #6 — `mutationCanary` 와 SRP 분리:
 *   - mutationCanary = 고정 입력 → 고정 기대값 (코드 변경 영향 추적)
 *   - determinismCanary = 어제값 → 오늘값 비교 (데이터/시간/부동소수점 비결정성 추적)
 *
 * 의도된 가중치 변경(F2W) 외 불일치 발견 시 텔레그램 CRITICAL 경보 + 영속.
 */

import fs from 'fs';
import { evaluateServerGate, DEFAULT_CONDITION_WEIGHTS } from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import { DETERMINISM_CANARY_FILE, ensureDataDir } from '../persistence/paths.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

interface CanaryFixture {
  label: string;
  quote: YahooQuoteExtended;
  kospi20dReturn?: number;
}

function baseQuote(overrides: Partial<YahooQuoteExtended>): YahooQuoteExtended {
  return {
    price: 10000, dayOpen: 9900, prevClose: 9900,
    changePercent: 0,
    volume: 100, avgVolume: 100,
    ma5: 10000, ma20: 9800, ma60: 9600,
    high5d: 10000, high20d: 10000, high60d: 11000,
    atr: 200, atr20avg: 250, atr5d: 200,
    per: 10,
    rsi14: 55, rsi5dAgo: 50, weeklyRSI: 55,
    macd: 0, macdSignal: 0, macdHistogram: 0,
    macd5dHistAgo: 0,
    return5d: 0,
    return20d: 0,
    bbWidthCurrent: 0.05, bbWidth20dAvg: 0.05,
    vol5dAvg: 100, vol20dAvg: 100,
    ma60TrendUp: false,
    monthlyAboveEMA12: false, monthlyEMARising: false,
    weeklyAboveCloud: false, weeklyLaggingSpanUp: false,
    dailyVolumeDrying: false,
    isHighRisk: false,
    ...overrides,
  };
}

// 5 fixture 는 mutationCanary 와 의도적으로 다른 패턴 — 5 가지 결정 분기를 커버.
const FIXTURES: CanaryFixture[] = [
  { label: 'momentum-strong', quote: baseQuote({ changePercent: 5.0, ma5: 10500, ma20: 10000, ma60: 9500, rsi14: 70, weeklyRSI: 65, ma60TrendUp: true }), kospi20dReturn: 0.03 },
  { label: 'breakout-mid', quote: baseQuote({ changePercent: 2.5, ma5: 10100, ma20: 9900, ma60: 9700, rsi14: 60, high20d: 9950, high60d: 9950 }), kospi20dReturn: 0.01 },
  { label: 'oversold-bounce', quote: baseQuote({ changePercent: 1.0, rsi14: 28, rsi5dAgo: 22, macd: -100, macdHistogram: 50, macd5dHistAgo: -100 }), kospi20dReturn: -0.02 },
  { label: 'volume-spike', quote: baseQuote({ changePercent: 3.0, volume: 500, avgVolume: 100, vol5dAvg: 400, vol20dAvg: 100 }), kospi20dReturn: 0.0 },
  { label: 'neutral-hold', quote: baseQuote({}), kospi20dReturn: 0.0 },
];

interface CanaryResult {
  label: string;
  gateScore: number;
  conditionKeys: string[];
  signalType?: string;
}

interface CanaryRun {
  date: string;
  weightsHash: string;
  results: CanaryResult[];
}

interface CanaryStore {
  runs: CanaryRun[];
}

const MAX_HISTORY = 30;

function ensureLoaded(): CanaryStore {
  ensureDataDir();
  if (!fs.existsSync(DETERMINISM_CANARY_FILE)) return { runs: [] };
  try {
    return JSON.parse(fs.readFileSync(DETERMINISM_CANARY_FILE, 'utf-8')) as CanaryStore;
  } catch { return { runs: [] }; }
}

function persist(store: CanaryStore): void {
  ensureDataDir();
  try {
    fs.writeFileSync(DETERMINISM_CANARY_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.warn('[determinismCanary] 저장 실패:', e instanceof Error ? e.message : e);
  }
}

function hashWeights(weights: Record<string, number>): string {
  // 간단 결정적 해시 — 키 정렬 + 소수점 6자리 고정.
  const keys = Object.keys(weights).sort();
  const seed = keys.map((k) => `${k}:${(weights[k] ?? 0).toFixed(6)}`).join('|');
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

function evalFixture(fix: CanaryFixture): CanaryResult {
  const evalResult = evaluateServerGate(fix.quote, DEFAULT_CONDITION_WEIGHTS, fix.kospi20dReturn);
  return {
    label: fix.label,
    gateScore: Number((evalResult.gateScore ?? 0).toFixed(5)),
    conditionKeys: [...(evalResult.conditionKeys ?? [])].sort(),
    signalType: evalResult.signalType,
  };
}

function dateKey(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

interface RunReport {
  date: string;
  weightsHash: string;
  previousDate: string | null;
  previousWeightsHash: string | null;
  weightsChanged: boolean;
  totalFixtures: number;
  matched: number;
  mismatched: number;
  /** 가중치 변경 없는데 결과가 달라진 경우 — 비결정성 의심. */
  unexpectedDrift: Array<{ label: string; before: CanaryResult; after: CanaryResult }>;
  /** 의도된 가중치 변경에 따른 결과 차이 — 정상. */
  intendedDrift: Array<{ label: string; before: CanaryResult; after: CanaryResult }>;
}

function diffResults(a: CanaryResult, b: CanaryResult): boolean {
  if (a.gateScore !== b.gateScore) return true;
  if ((a.signalType ?? '') !== (b.signalType ?? '')) return true;
  if (a.conditionKeys.length !== b.conditionKeys.length) return true;
  for (let i = 0; i < a.conditionKeys.length; i++) {
    if (a.conditionKeys[i] !== b.conditionKeys[i]) return true;
  }
  return false;
}

function compareRuns(today: CanaryRun, yesterday: CanaryRun | null): RunReport {
  if (!yesterday) {
    return {
      date: today.date,
      weightsHash: today.weightsHash,
      previousDate: null,
      previousWeightsHash: null,
      weightsChanged: false,
      totalFixtures: today.results.length,
      matched: today.results.length,
      mismatched: 0,
      unexpectedDrift: [],
      intendedDrift: [],
    };
  }
  const weightsChanged = today.weightsHash !== yesterday.weightsHash;
  const yMap = new Map(yesterday.results.map((r) => [r.label, r]));
  const unexpected: RunReport['unexpectedDrift'] = [];
  const intended: RunReport['intendedDrift'] = [];
  let matched = 0, mismatched = 0;
  for (const r of today.results) {
    const prev = yMap.get(r.label);
    if (!prev) continue;
    if (diffResults(r, prev)) {
      mismatched++;
      const entry = { label: r.label, before: prev, after: r };
      if (weightsChanged) intended.push(entry);
      else unexpected.push(entry);
    } else {
      matched++;
    }
  }
  return {
    date: today.date,
    weightsHash: today.weightsHash,
    previousDate: yesterday.date,
    previousWeightsHash: yesterday.weightsHash,
    weightsChanged,
    totalFixtures: today.results.length,
    matched,
    mismatched,
    unexpectedDrift: unexpected,
    intendedDrift: intended,
  };
}

/**
 * Canary 1회 실행 — fixture 5건 평가 후 어제 결과와 비교, 영속.
 * 의도되지 않은 drift 발견 시 텔레그램 CRITICAL 알림.
 *
 * @returns 비교 리포트.
 */
export async function runDeterminismCanary(now: Date = new Date()): Promise<RunReport> {
  const today: CanaryRun = {
    date: dateKey(now),
    weightsHash: hashWeights(DEFAULT_CONDITION_WEIGHTS as unknown as Record<string, number>),
    results: FIXTURES.map(evalFixture),
  };
  const store = ensureLoaded();
  const yesterday = store.runs.length > 0 ? store.runs[store.runs.length - 1] : null;
  const report = compareRuns(today, yesterday);
  // 같은 날 재실행 시 마지막 entry 교체, 그 외엔 append.
  if (yesterday && yesterday.date === today.date) {
    store.runs[store.runs.length - 1] = today;
  } else {
    store.runs.push(today);
  }
  if (store.runs.length > MAX_HISTORY) store.runs = store.runs.slice(-MAX_HISTORY);
  persist(store);

  if (report.unexpectedDrift.length > 0) {
    try {
      const lines = report.unexpectedDrift.slice(0, 3).map((d) =>
        `• ${d.label}: ${d.before.gateScore}→${d.after.gateScore} (${d.before.signalType ?? '-'}→${d.after.signalType ?? '-'})`,
      );
      await sendTelegramAlert(
        `🛑 비결정성 출현 — Canary ${report.unexpectedDrift.length}건 drift\n가중치 변경 없음 (hash 동일)\n${lines.join('\n')}`,
        { priority: 'CRITICAL', dedupeKey: `determinism_canary:${report.date}`, category: 'determinism_canary' },
      );
    } catch (e) {
      console.warn('[determinismCanary] 경보 실패:', e instanceof Error ? e.message : e);
    }
  }
  return report;
}

/** 진단 — 최근 N회 결과. */
export function getCanaryHistory(limit = 7): CanaryRun[] {
  const store = ensureLoaded();
  return store.runs.slice(-limit);
}

export const __testOnly = {
  fixtures: FIXTURES,
  hashWeights,
  diffResults,
  compareRuns,
};
