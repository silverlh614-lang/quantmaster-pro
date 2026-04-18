/**
 * sell/volumeDryupAlert.ts — VDA (Volume Dry-up Alert)
 *
 * 가격보다 3~5거래일 선행하는 "매수 세력 피로" 감지 레이어.
 * 가격은 버티는데 거래량이 마르는 현상 = 매수 세력 이탈의 선행 지표.
 *
 * 판정식:
 *   volumeRatio = avgVolume20d / avgVolume60d
 *   priceStdRatio = priceStd20d / priceStd60d
 *   dryupScore = 가중 조합
 *
 * 단계:
 *   score ≥ 0.95 AND 구름대 지지선 접근 → 30% 분할 매도 (VDA_ALERT)
 *   score ≥ 0.80 → 경보만 (모니터링, sellRatio=0)
 *
 * 이 모듈은 매도 엔진이 '이미 떨어진 다음'이 아닌 '떨어지기 전'에 대응하는
 * 유일한 레이어다.
 */

import type {
  ActivePosition,
  SellSignal,
  VolumeStats,
  OHLCCandle,
} from '../../../types/sell';
import { computeIchimokuSeries } from './ichimokuExit';

// ─── 파라미터 ─────────────────────────────────────────────────────────────────

/** 거래량 마름 비율 기준 (20일 평균 / 60일 평균). 0.4 이하 = 극심한 마름 */
const VOLUME_DRYUP_THRESHOLD = 0.40;

/** 가격 변동성 마름 기준 (20일 std / 60일 std). 0.7 이하 = 변동성 수축 */
const PRICE_STD_DRYUP_THRESHOLD = 0.70;

/**
 * 경보 단계 임계값.
 *   0.80 이상 → 모니터링 경보 (sellRatio=0)
 *   0.95 이상 + 구름대 지지선 접근 → 30% 분할 매도
 */
const MONITORING_SCORE_THRESHOLD = 0.80;
const SELL_SCORE_THRESHOLD       = 0.95;

/** 구름대 지지선 접근 판정: 종가가 구름대 상단 근접(≤ 3%) 위에 있을 때 */
const CLOUD_PROXIMITY_PCT = 0.03;

// ─── 점수 계산 ───────────────────────────────────────────────────────────────

export interface VdaScoreBreakdown {
  /** avgVolume20d / avgVolume60d */
  volumeRatio: number;
  /** priceStd20d / priceStd60d */
  priceStdRatio: number;
  /** 0 ~ 1 — 높을수록 건조(위험) */
  score: number;
}

/**
 * dryupScore 계산.
 *   volumeRatio가 0.4 이하면 → volumePart = 1 (완전 건조)
 *   volumeRatio가 1.0 이상이면 → volumePart = 0
 *   선형 보간.
 *   priceStdRatio도 동일 원리.
 *   score = 0.6 × volumePart + 0.4 × priceStdPart (거래량 우선)
 */
export function calcVdaScore(stats: VolumeStats): VdaScoreBreakdown {
  if (stats.avgVolume60d <= 0 || stats.priceStd60d <= 0) {
    return { volumeRatio: 1, priceStdRatio: 1, score: 0 };
  }

  const volumeRatio   = stats.avgVolume20d / stats.avgVolume60d;
  const priceStdRatio = stats.priceStd20d  / stats.priceStd60d;

  const linearMap = (r: number, dryThreshold: number): number => {
    if (r <= dryThreshold) return 1;
    if (r >= 1.0) return 0;
    return (1.0 - r) / (1.0 - dryThreshold);
  };

  const volumePart   = linearMap(volumeRatio,   VOLUME_DRYUP_THRESHOLD);
  const priceStdPart = linearMap(priceStdRatio, PRICE_STD_DRYUP_THRESHOLD);
  const score = 0.6 * volumePart + 0.4 * priceStdPart;

  return { volumeRatio, priceStdRatio, score };
}

// ─── 구름대 지지선 접근 판정 ──────────────────────────────────────────────────

/**
 * 현재 종가가 구름대 상단과 CLOUD_PROXIMITY_PCT 이내로 접근했는지.
 * 캔들 미주입 시 false 반환 (안전 측).
 */
function isNearCloudSupport(candles: readonly OHLCCandle[] | undefined): boolean {
  if (!candles || candles.length < 52) return false;
  const series = computeIchimokuSeries(candles);
  if (!series) return false;
  const n = series.closes.length;
  if (n === 0) return false;
  const close = series.closes[n - 1];
  const spanA = series.senkouA[n - 1];
  const spanB = series.senkouB[n - 1];
  if (!Number.isFinite(spanA) || !Number.isFinite(spanB)) return false;
  const cloudTop = Math.max(spanA, spanB);
  if (close < cloudTop) return false; // 이미 구름대 아래 → ichimokuExit 담당
  const gap = (close - cloudTop) / cloudTop;
  return gap <= CLOUD_PROXIMITY_PCT;
}

// ─── 통합 판정 ───────────────────────────────────────────────────────────────

export function evaluateVdaAlert(
  position: ActivePosition,
  stats: VolumeStats | undefined,
  candles: readonly OHLCCandle[] | undefined,
): SellSignal | null {
  if (!stats) return null;
  const { score, volumeRatio, priceStdRatio } = calcVdaScore(stats);

  if (score < MONITORING_SCORE_THRESHOLD) return null;

  const nearCloud = isNearCloudSupport(candles);

  if (score >= SELL_SCORE_THRESHOLD && nearCloud) {
    return {
      action: 'VDA_ALERT',
      ratio: 0.30,
      orderType: 'LIMIT',
      price: position.currentPrice,
      severity: 'HIGH',
      reason: `VDA ${score.toFixed(2)} + 구름대 지지선 접근 — 30% 분할 매도. `
        + `volumeRatio=${volumeRatio.toFixed(2)}, priceStdRatio=${priceStdRatio.toFixed(2)}`,
    };
  }

  // 경보만 (모니터링)
  return {
    action: 'VDA_ALERT',
    ratio: 0,
    orderType: 'LIMIT',
    price: position.currentPrice,
    severity: 'MEDIUM',
    reason: `VDA 모니터링 ${score.toFixed(2)} — 거래량 마름 감지, 매도 없음 (${nearCloud ? '구름 접근' : '구름 여유'}). `
      + `volumeRatio=${volumeRatio.toFixed(2)}, priceStdRatio=${priceStdRatio.toFixed(2)}`,
  };
}
