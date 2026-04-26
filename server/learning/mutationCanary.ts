// @responsibility mutationCanary 학습 엔진 모듈
/**
 * mutationCanary.ts — Phase 2차 C4: 판단 로직 돌연변이 카나리아.
 *
 * 매 시간 고정 입력을 evaluateServerGate 에 넣어 고정 출력을 검증한다.
 * 결과가 어긋나면 판단 로직에 우발적 변경이 일어난 것 — 배포 실수·코드
 * 병합 충돌·자기학습 가중치 오류 등. 즉시 CRITICAL 경보.
 *
 * 설계 원칙:
 *   - 입력·기대출력은 코드 내 상수로 hard-coding (외부 파일 의존 금지).
 *   - 가중치도 DEFAULT_CONDITION_WEIGHTS 사용 → 학습된 값이 달라도 카나리아
 *     결과는 동일해야 함.
 *   - 불일치 시 incidentLogRepo 영속화 + Telegram 발송.
 */

import { evaluateServerGate, DEFAULT_CONDITION_WEIGHTS } from '../quantFilter.js';
import type { YahooQuoteExtended } from '../screener/stockScreener.js';
import { recordIncident } from '../persistence/incidentLogRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';

// ── 카나리아 케이스 (fixed input → fixed output) ─────────────────────────────
//
// 각 케이스는 독립적 — 한 케이스 실패해도 나머지는 검증 계속.
// 숫자 정확도는 소수점 5자리 tolerance (evaluateServerGate 내부 floor 연산 흡수).

interface CanaryCase {
  label: string;
  quote: YahooQuoteExtended;
  kospi20dReturn?: number;
  expect: {
    conditionKeysSorted: string[];
    gateScoreApprox: number;
    signalType?: 'STRONG' | 'NORMAL' | 'SKIP';
  };
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

const CANARY_CASES: CanaryCase[] = [
  {
    // Gate 2 (momentum) 단독 발화 — changePercent 2.5%, 다른 필드는 중립.
    label: 'momentum-only-2.5pct',
    quote: baseQuote({
      changePercent: 2.5,
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high5d: 0, high20d: 0,
      avgVolume: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }),
    expect: {
      conditionKeysSorted: ['momentum'],
      gateScoreApprox: 1.0,
    },
  },
  {
    // Gate 24 (breakout_momentum) 단독 발화 — 5일 고점 돌파 + 거래량.
    // volume_breakout 2× 임계 바로 아래(1.8×)로 설정해 오직 breakout_momentum 만 점화.
    label: 'breakout-momentum-only',
    quote: baseQuote({
      changePercent: 0,
      high5d: 10000, price: 10150,        // +1.5%
      volume: 180, avgVolume: 100,        // 1.8× — breakout_momentum 강한 돌파는 충족, volume_breakout 은 미달
      rsi14: 30, rsi5dAgo: 30,
      ma5: 0, ma20: 0, ma60: 0,
      per: 0, high20d: 0,
      macdHistogram: -1, macd5dHistAgo: -1,
      bbWidthCurrent: 1, bbWidth20dAvg: 1,
      vol5dAvg: 1, vol20dAvg: 1,
      atr5d: 1, atr20avg: 1,
      ma60TrendUp: false, weeklyRSI: 30,
    }),
    expect: {
      conditionKeysSorted: ['breakout_momentum'],
      gateScoreApprox: 1.0,
    },
  },
];

// ── 실행 ──────────────────────────────────────────────────────────────────────

export interface CanaryResult {
  label: string;
  ok: boolean;
  expected: CanaryCase['expect'];
  actual: { conditionKeysSorted: string[]; gateScore: number; signalType: string };
  mismatch?: string;
}

export function runCanaryCases(): CanaryResult[] {
  const out: CanaryResult[] = [];
  for (const c of CANARY_CASES) {
    const r = evaluateServerGate(c.quote, DEFAULT_CONDITION_WEIGHTS, c.kospi20dReturn);
    const actualKeys = [...r.conditionKeys].sort();
    const expectedKeys = [...c.expect.conditionKeysSorted].sort();
    const keysMatch = actualKeys.join(',') === expectedKeys.join(',');
    const scoreMatch = Math.abs(r.gateScore - c.expect.gateScoreApprox) < 1e-4;
    const signalMatch = c.expect.signalType ? r.signalType === c.expect.signalType : true;
    const ok = keysMatch && scoreMatch && signalMatch;
    out.push({
      label: c.label,
      ok,
      expected: c.expect,
      actual: { conditionKeysSorted: actualKeys, gateScore: r.gateScore, signalType: r.signalType },
      mismatch: ok ? undefined : [
        !keysMatch && `keys expected=${expectedKeys.join(',')} actual=${actualKeys.join(',')}`,
        !scoreMatch && `gateScore expected≈${c.expect.gateScoreApprox} actual=${r.gateScore}`,
        !signalMatch && `signalType expected=${c.expect.signalType} actual=${r.signalType}`,
      ].filter(Boolean).join('; '),
    });
  }
  return out;
}

/**
 * cron 에서 호출. 불일치 케이스가 하나라도 있으면 incident + Telegram.
 * 모두 통과하면 조용히 성공 로그.
 */
export async function runHourlyCanary(): Promise<void> {
  const results = runCanaryCases();
  const failures = results.filter(r => !r.ok);
  if (failures.length === 0) {
    console.log(`[MutationCanary] ✅ ${results.length}/${results.length} 케이스 통과`);
    return;
  }
  const summary = failures.map(f => `• ${f.label}: ${f.mismatch}`).join('\n');
  recordIncident('mutationCanary', `Canary mismatch — ${failures.length} case(s)`, 'CRITICAL', {
    failedCases: failures.map(f => f.label).join(','),
  });
  await sendTelegramAlert(
    `🧪 <b>[Mutation Canary] 판단 로직 이상 감지</b>\n${summary}\n\n` +
    `evaluateServerGate/ConditionEvaluator 우발적 변경 가능성. ` +
    `판단 로직 해시(주간 리포트) 및 최근 배포 로그 확인.`,
    { priority: 'CRITICAL', dedupeKey: 'mutation-canary' },
  ).catch(console.error);
}
