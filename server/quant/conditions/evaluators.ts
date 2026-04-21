/**
 * @responsibility 14개 조건의 단일책임 ConditionEvaluator 구현체 모음 (registry 등록 대상)
 *
 * 각 평가기는 inputs 선언으로 정적 분석을 가능하게 하고, evaluate 본체는
 * ctx 를 read-only 로 사용하여 기존 evaluateServerGate 와 동일한 결과를 반환한다.
 */

import type { ConditionEvaluator } from './types.js';
import { isPullbackSetup } from '../../screener/pipelineHelpers.js';

// ─── 가중치 헬퍼 ─────────────────────────────────────────────────────────────
//
// evaluator 가 weight 를 직접 다루도록 헬퍼 분리. orchestrator 와 동일한 clamping 정책.
const W_MIN = 0.1;
const W_MAX = 2.0;
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }

function weightFor(weights: Record<string, number>, key: string): number {
  const raw = weights[key];
  if (typeof raw !== 'number' || Number.isNaN(raw)) return 1.0;
  return clamp(raw, W_MIN, W_MAX);
}

// ─── 조건 2: 모멘텀 ──────────────────────────────────────────────────────────

export const momentumEvaluator: ConditionEvaluator = {
  key: 'momentum',
  description: '당일 +2% 이상 또는 (소폭 상승 + RSI 가속 + 5일 비과급등) 시 모멘텀 인정',
  inputs: ['quote.changePercent', 'quote.rsi14', 'quote.rsi5dAgo', 'quote.return5d'],
  evaluate({ quote, weights }) {
    const w = weightFor(weights, 'momentum');
    const rsiAccel = (quote.rsi14 - quote.rsi5dAgo) >= 3;
    if (quote.changePercent >= 2) {
      return { score: w, conditionKey: 'momentum',
        detail: `모멘텀 +${quote.changePercent.toFixed(1)}%` };
    }
    if (quote.changePercent >= 0.5 && rsiAccel && quote.return5d < 8) {
      return { score: w * 0.7, conditionKey: 'momentum',
        detail: `모멘텀(RSI가속) +${quote.changePercent.toFixed(1)}% RSI${quote.rsi14.toFixed(0)}` };
    }
    return null;
  },
};

// ─── 조건 10: 정배열 (MA5 > MA20 > MA60) ─────────────────────────────────────

export const maAlignmentEvaluator: ConditionEvaluator = {
  key: 'ma_alignment',
  description: '5일 > 20일 > 60일 이동평균 정배열',
  inputs: ['quote.ma5', 'quote.ma20', 'quote.ma60'],
  evaluate({ quote, weights }) {
    if (!(quote.ma5 > 0 && quote.ma20 > 0 && quote.ma60 > 0)) return null;
    if (!(quote.ma5 > quote.ma20 && quote.ma20 > quote.ma60)) return null;
    return {
      score: weightFor(weights, 'ma_alignment'),
      conditionKey: 'ma_alignment',
      detail: '정배열 (MA5>MA20>MA60)',
    };
  },
};

// ─── 조건 11: 거래량 돌파 (5일 평균 2배 이상) ────────────────────────────────

export const volumeBreakoutEvaluator: ConditionEvaluator = {
  key: 'volume_breakout',
  description: '거래량 5일 평균 2배 이상',
  inputs: ['quote.volume', 'quote.avgVolume'],
  evaluate({ quote, weights }) {
    if (!(quote.avgVolume > 0 && quote.volume >= quote.avgVolume * 2)) return null;
    return {
      score: weightFor(weights, 'volume_breakout'),
      conditionKey: 'volume_breakout',
      detail: `거래량 ${(quote.volume / quote.avgVolume).toFixed(1)}배`,
    };
  },
};

// ─── 조건 13: PER 밸류에이션 (0 < PER < 20) ──────────────────────────────────

export const perEvaluator: ConditionEvaluator = {
  key: 'per',
  description: 'PER 0~20 (적정 밸류에이션)',
  inputs: ['quote.per'],
  evaluate({ quote, weights }) {
    if (!(quote.per > 0 && quote.per < 20)) return null;
    return {
      score: weightFor(weights, 'per'),
      conditionKey: 'per',
      detail: `PER ${quote.per.toFixed(1)}`,
    };
  },
};

// ─── 조건 18: 터틀 돌파 (20일 신고가) ────────────────────────────────────────

export const turtleHighEvaluator: ConditionEvaluator = {
  key: 'turtle_high',
  description: '20일 신고가 돌파',
  inputs: ['quote.high20d', 'quote.price'],
  evaluate({ quote, weights }) {
    if (!(quote.high20d > 0 && quote.price >= quote.high20d)) return null;
    return {
      score: weightFor(weights, 'turtle_high'),
      conditionKey: 'turtle_high',
      detail: '20일 신고가 돌파',
    };
  },
};

// ─── 상대강도 — KOSPI 대비 20일 누적 (모멘텀과 시간축 분리) ──────────────────
//
// Phase 1 B3 후속(공선성 완전 제거):
//   1차 B3 에서는 kospiDayReturn 을 필수화해 fallback 을 제거했으나,
//   momentum(quote.changePercent) 과 relative_strength(quote.changePercent − kospiDayReturn)
//   이 여전히 같은 "당일 변동률" 변수를 공유해 강한 양의 상관을 보였다.
//   경험적으로 개별 종목이 2%+ 오르는 날 KOSPI 가 1%p 이상 덜 오르는 빈도는 70%+ 여서
//   두 조건은 독립 정보가 아니었다(→ Gate 2/24 이중 기여로 모멘텀 편향 증폭).
//
//   본 평가기는 시간축을 다르게 잡아 입력 자체를 분리한다:
//     - momentum           : "오늘 얼마나 올랐나" (당일 1일 변동)
//     - relative_strength  : "지난 20일 KOSPI 를 얼마나 앞섰나" (누적 초과수익)
//   이는 institutionalFootprintEngine 의 detectBetaSeparation(10d) 과 SRRPanel 의
//   RS Ratio(20d) 와 같은 시간축이다 — 코드베이스 내 "진짜 상대강도" 정의 일치.
//
//   kospi20dReturn 미제공 시 발화하지 않는다(안전 기본).

export const relativeStrengthEvaluator: ConditionEvaluator = {
  key: 'relative_strength',
  description: 'KOSPI 대비 20일 누적 +3.0%p 초과 — momentum 과 시간축·입력 모두 분리',
  inputs: ['quote.return20d', 'ctx.kospi20dReturn'],
  evaluate({ quote, weights, kospi20dReturn }) {
    if (kospi20dReturn === undefined) return null; // 벤치마크 없이 발화 금지
    const gap = quote.return20d - kospi20dReturn;
    if (!(gap > 3.0)) return null;
    return {
      score: weightFor(weights, 'relative_strength'),
      conditionKey: 'relative_strength',
      detail: `상대강도 20d +${gap.toFixed(1)}%p (종목 ${quote.return20d.toFixed(1)}% vs KOSPI ${kospi20dReturn.toFixed(1)}%)`,
    };
  },
};

// ─── Gate 24 새 의미: Breakout Momentum (5일 고점 대비 + 거래량) ─────────────
//
// 의미적으로 독립: momentum 은 "오늘 얼마나 올랐나",
// breakout_momentum 은 "최근 5일 박스권을 뚫고 매물대를 돌파하는가" 를 측정.
// 입력: high5d, price, volume, avgVolume (changePercent 미사용 → 명시적 독립).
//
// 점수 체계:
//   - 강한 돌파: 현재가가 5일 고점의 101% 이상 + 거래량 5일 평균 1.5배  → 만점
//   - 약한 돌파: 현재가가 5일 고점의 99%~101% + 거래량 1.2배           → 0.6점
//   - 미달: null

export const breakoutMomentumEvaluator: ConditionEvaluator = {
  key: 'breakout_momentum',
  description: '5일 고점 돌파 + 거래량 확인 (momentum 과 입력 독립)',
  inputs: ['quote.high5d', 'quote.price', 'quote.volume', 'quote.avgVolume'],
  evaluate({ quote, weights }) {
    if (!(quote.high5d > 0 && quote.price > 0 && quote.avgVolume > 0)) return null;
    const posVsHigh = quote.price / quote.high5d;
    const volRatio  = quote.volume / quote.avgVolume;
    const w = weightFor(weights, 'breakout_momentum');
    if (posVsHigh >= 1.01 && volRatio >= 1.5) {
      return {
        score: w,
        conditionKey: 'breakout_momentum',
        detail: `5일돌파 ${((posVsHigh - 1) * 100).toFixed(1)}% + 거래량 ${volRatio.toFixed(1)}배`,
      };
    }
    if (posVsHigh >= 0.99 && volRatio >= 1.2) {
      return {
        score: w * 0.6,
        conditionKey: 'breakout_momentum',
        detail: `5일고점근접 (${((posVsHigh - 1) * 100).toFixed(1)}%) 거래량 ${volRatio.toFixed(1)}배`,
      };
    }
    return null;
  },
};

// ─── 조건 25: VCP — Compression Score 기반 ───────────────────────────────────

function calculateCompressionScore(quote: {
  bbWidth20dAvg: number; bbWidthCurrent: number;
  vol20dAvg: number; vol5dAvg: number;
  atr20avg: number; atr5d: number;
}): number {
  const bbRatio  = quote.bbWidth20dAvg > 0 ? quote.bbWidthCurrent / quote.bbWidth20dAvg : 1;
  const volRatio = quote.vol20dAvg     > 0 ? quote.vol5dAvg       / quote.vol20dAvg     : 1;
  const atrRatio = quote.atr20avg      > 0 ? quote.atr5d          / quote.atr20avg      : 1;
  const cs = (1 - bbRatio) * 0.4 + (1 - volRatio) * 0.4 + (1 - atrRatio) * 0.2;
  return Math.max(0, Math.min(1, cs));
}

export const vcpEvaluator: ConditionEvaluator = {
  key: 'vcp',
  description: 'Compression Score ≥ 0.6 강한압축 / ≥ 0.4 중간압축',
  inputs: [
    'quote.bbWidthCurrent', 'quote.bbWidth20dAvg',
    'quote.vol5dAvg', 'quote.vol20dAvg',
    'quote.atr5d', 'quote.atr20avg',
  ],
  evaluate({ quote, weights }) {
    const cs = calculateCompressionScore(quote);
    const w = weightFor(weights, 'vcp');
    if (cs >= 0.6) return { score: w,       conditionKey: 'vcp', detail: `VCP 강한압축 (CS=${cs.toFixed(2)})` };
    if (cs >= 0.4) return { score: w * 0.5, conditionKey: 'vcp', detail: `VCP 중간압축 (CS=${cs.toFixed(2)})` };
    return null;
  },
};

/** Orchestrator 가 result.compressionScore 필드를 채울 수 있도록 외부 노출 */
export { calculateCompressionScore };

// ─── 조건 27: 거래량 급증 + 상승 (3배 & +1%) ─────────────────────────────────

export const volumeSurgeEvaluator: ConditionEvaluator = {
  key: 'volume_surge',
  description: '거래량 5일 평균 3배 이상 AND 당일 +1% 이상',
  inputs: ['quote.volume', 'quote.avgVolume', 'quote.changePercent'],
  evaluate({ quote, weights }) {
    if (!(quote.avgVolume > 0 && quote.volume >= quote.avgVolume * 3 && quote.changePercent >= 1)) return null;
    return {
      score: weightFor(weights, 'volume_surge'),
      conditionKey: 'volume_surge',
      detail: '거래량 급증+상승',
    };
  },
};

// ─── RSI 건강구간 (40~70) ─────────────────────────────────────────────────────

export const rsiZoneEvaluator: ConditionEvaluator = {
  key: 'rsi_zone',
  description: 'RSI(14) 40~70 건강구간 (과매도 탈출 + 과매수 미달)',
  inputs: ['quote.rsi14'],
  evaluate({ quote, weights }) {
    if (!(quote.rsi14 >= 40 && quote.rsi14 <= 70)) return null;
    return {
      score: weightFor(weights, 'rsi_zone'),
      conditionKey: 'rsi_zone',
      detail: `RSI ${quote.rsi14.toFixed(0)}`,
    };
  },
};

// ─── MACD 가속 ────────────────────────────────────────────────────────────────

export const macdBullEvaluator: ConditionEvaluator = {
  key: 'macd_bull',
  description: 'MACD 히스토그램 양수 + 5일 전 대비 확대(가속)',
  inputs: ['quote.macdHistogram', 'quote.macd5dHistAgo'],
  evaluate({ quote, weights }) {
    const w = weightFor(weights, 'macd_bull');
    if (quote.macdHistogram > 0 && quote.macdHistogram > quote.macd5dHistAgo) {
      return {
        score: w,
        conditionKey: 'macd_bull',
        detail: `MACD가속 ${quote.macd5dHistAgo.toFixed(2)}→${quote.macdHistogram.toFixed(2)}`,
      };
    }
    if (quote.macdHistogram > 0) {
      return {
        score: w * 0.5,
        conditionKey: 'macd_bull',
        detail: `MACD+ ${quote.macdHistogram.toFixed(2)} (가속미확인)`,
      };
    }
    return null;
  },
};

// ─── 눌림목 셋업 ──────────────────────────────────────────────────────────────

export const pullbackEvaluator: ConditionEvaluator = {
  key: 'pullback',
  description: '고점 대비 조정 + 변동성 축소 + 장기 추세 유지 (isPullbackSetup)',
  inputs: ['quote.high60d', 'quote.price'],
  evaluate({ quote, weights }) {
    if (!isPullbackSetup(quote)) return null;
    const drawdown = quote.high60d > 0 ? (quote.high60d - quote.price) / quote.high60d * 100 : 0;
    return {
      score: weightFor(weights, 'pullback'),
      conditionKey: 'pullback',
      detail: `눌림목 (고점대비 -${drawdown.toFixed(1)}%)`,
    };
  },
};

// ─── MA60 우상향 ──────────────────────────────────────────────────────────────

export const ma60RisingEvaluator: ConditionEvaluator = {
  key: 'ma60_rising',
  description: 'MA60 5일 전보다 상승 — 대세 하락 중 단기 반등 필터',
  inputs: ['quote.ma60TrendUp'],
  evaluate({ quote, weights }) {
    if (!quote.ma60TrendUp) return null;
    return {
      score: weightFor(weights, 'ma60_rising'),
      conditionKey: 'ma60_rising',
      detail: 'MA60 우상향',
    };
  },
};

// ─── 주봉 RSI 건강구간 ────────────────────────────────────────────────────────

export const weeklyRsiZoneEvaluator: ConditionEvaluator = {
  key: 'weekly_rsi_zone',
  description: '주봉 RSI(9) 40~70 — 타임프레임 정렬 보조',
  inputs: ['quote.weeklyRSI'],
  evaluate({ quote, weights }) {
    if (!(quote.weeklyRSI >= 40 && quote.weeklyRSI <= 70)) return null;
    return {
      score: weightFor(weights, 'weekly_rsi_zone'),
      conditionKey: 'weekly_rsi_zone',
      detail: `주봉RSI ${quote.weeklyRSI.toFixed(0)}`,
    };
  },
};

// ─── 수급 합치 (KIS 기관/외인) ────────────────────────────────────────────────

export const supplyConfluenceEvaluator: ConditionEvaluator = {
  key: 'supply_confluence',
  description: 'KIS 기관·외인 동반 순매수 (단독 시 0.6 가중)',
  inputs: ['ctx.kisFlow.institutionalNetBuy', 'ctx.kisFlow.foreignNetBuy'],
  evaluate({ kisFlow, weights }) {
    if (!kisFlow) return null;
    const w = weightFor(weights, 'supply_confluence');
    const instBuy  = kisFlow.institutionalNetBuy > 0;
    const foreiBuy = kisFlow.foreignNetBuy > 0;
    if (instBuy && foreiBuy) {
      return {
        score: w,
        conditionKey: 'supply_confluence',
        detail:
          `수급합치 기관+${(kisFlow.institutionalNetBuy / 1000).toFixed(0)}천주 ` +
          `외인+${(kisFlow.foreignNetBuy / 1000).toFixed(0)}천주`,
      };
    }
    if (instBuy || foreiBuy) {
      const label = instBuy
        ? `기관+${(kisFlow.institutionalNetBuy / 1000).toFixed(0)}천주`
        : `외인+${(kisFlow.foreignNetBuy / 1000).toFixed(0)}천주`;
      return {
        score: w * 0.6,
        conditionKey: 'supply_confluence',
        detail: `수급단독 ${label}`,
      };
    }
    return null;
  },
};

// ─── OCF 품질 (DART 영업현금흐름 비율) ────────────────────────────────────────

export const earningsQualityEvaluator: ConditionEvaluator = {
  key: 'earnings_quality',
  description: 'DART OCF/매출 ≥ 5% 양호 / ≥ 1% 기본',
  inputs: ['ctx.dartFin.ocfRatio'],
  evaluate({ dartFin, weights }) {
    if (dartFin?.ocfRatio == null) return null;
    const w = weightFor(weights, 'earnings_quality');
    if (dartFin.ocfRatio >= 5.0) {
      return { score: w,       conditionKey: 'earnings_quality', detail: `OCF품질 ${dartFin.ocfRatio.toFixed(1)}%` };
    }
    if (dartFin.ocfRatio >= 1.0) {
      return { score: w * 0.5, conditionKey: 'earnings_quality', detail: `OCF기본 ${dartFin.ocfRatio.toFixed(1)}%` };
    }
    return null;
  },
};
