/**
 * regimeEngine.ts — 6단계 자동매매 레짐 분류기
 *
 * classifyRegime(RegimeVariables) → RegimeLevel
 * REGIME_CONFIGS[RegimeLevel]     → FullRegimeConfig
 *
 * 판정 우선순위:
 *   R6(블랙스완) → R5(복합위험) → R3(상승초기 선행) → R1(완전Bull) → R2(일반Bull) → R4(기본)
 *
 * R3(EARLY)가 핵심 추가 레짐:
 *   지수 60일선 회복 전이지만 선행 지표(외국인Passive 전환·VKOSPI 하락)가 켜지는 구간.
 *   Kelly 60%로 30%만 선취매 → R2 레짐 진입 시 70% 증액하여 상승 사이클을 최대 포획.
 */

import type {
  RegimeVariables,
  RegimeLevel,
  FullRegimeConfig,
} from '../../types/quant';

// ─── REGIME_CONFIGS — 레짐별 완전 트레이딩 설정 맵 ─────────────────────────────

export const REGIME_CONFIGS: Record<RegimeLevel, FullRegimeConfig> = {

  // ── R1 TURBO: 최적 상승 사이클 — 공격 모드 MAX ───────────────────────────────
  R1_TURBO: {
    gate2Required: 6,    // 12개 중 6개
    gate3Required: 4,    // 10개 중 4개
    kellyMultiplier: 1.0,
    maxPositions: 8,
    allowedSignals: ['CONFIRMED_STRONG_BUY', 'STRONG_BUY', 'BUY', 'EARLY_ENTRY'],
    trancheStrategy: '선제 1차 40% → 모멘텀 확인 후 60%',
    stopLoss: {
      profileA: -0.15,
      profileB: -0.12,
      profileC: -0.10,
      profileD: -0.07,
    },
    takeProfitPartial: {
      first:  { trigger: 0.15, ratio: 0.3 },   // +15%에 30% 익절
      second: { trigger: 0.25, ratio: 0.3 },   // +25%에 추가 30%
      third:  'trailing_stop_10%',              // 나머지 트레일링 10%
    },
    dailyLossLimit:  -0.05,
    weeklyLossLimit: -0.08,
  },

  // ── R2 BULL: 상승 추세 확인 — 적극 매수 ─────────────────────────────────────
  R2_BULL: {
    gate2Required: 7,
    gate3Required: 5,
    kellyMultiplier: 0.8,
    maxPositions: 6,
    allowedSignals: ['CONFIRMED_STRONG_BUY', 'STRONG_BUY', 'BUY'],
    trancheStrategy: '1차 40% → 확인 후 35% → 눌림 25%',
    stopLoss: {
      profileA: -0.12,
      profileB: -0.10,
      profileC: -0.08,
      profileD: -0.06,
    },
    takeProfitPartial: {
      first:  { trigger: 0.12, ratio: 0.3 },
      second: { trigger: 0.20, ratio: 0.3 },
      third:  'trailing_stop_8%',
    },
    dailyLossLimit:  -0.03,
    weeklyLossLimit: -0.06,
  },

  // ── R3 EARLY: 상승 초기 선행 신호 — 소규모 선취매 (수익률 최고 구간) ───────────
  R3_EARLY: {
    gate2Required: 6,    // R1과 동일 완화 — 선행 포착이 목적
    gate3Required: 4,
    kellyMultiplier: 0.7, // 선취매 구간 — 신규 진입 슬롯 확보를 위해 소폭 상향
    maxPositions: 5,
    allowedSignals: ['STRONG_BUY', 'BUY', 'EARLY_ENTRY'],
    trancheStrategy: '1차 30% 선진입 → R2 레짐 확인 후 70% 증액',
    stopLoss: {
      profileA: -0.10,
      profileB: -0.08,
      profileC: -0.07,
      profileD: -0.05,
    },
    takeProfitPartial: {
      first:  { trigger: 0.10, ratio: 0.25 },
      second: { trigger: 0.18, ratio: 0.35 },
      third:  'trailing_stop_7%',
    },
    dailyLossLimit:  -0.025,
    weeklyLossLimit: -0.05,
  },

  // ── R4 NEUTRAL: 중립 횡보 — 선택적 진입 ──────────────────────────────────────
  R4_NEUTRAL: {
    gate2Required: 8,
    gate3Required: 6,
    kellyMultiplier: 0.5,
    maxPositions: 6,   // 상승횡보장도 6개 허용 (4→6 상향)
    allowedSignals: ['CONFIRMED_STRONG_BUY', 'STRONG_BUY'],
    trancheStrategy: '분할 3회 균등 (33/33/33)',
    stopLoss: {
      profileA: -0.08,
      profileB: -0.07,
      profileC: -0.06,
      profileD: -0.05,
    },
    takeProfitPartial: {
      first:  { trigger: 0.08, ratio: 0.4 },  // 빨리 익절
      second: { trigger: 0.12, ratio: 0.4 },
      third:  { trigger: 0.18, ratio: 0.2 },
    },
    dailyLossLimit:  -0.02,
    weeklyLossLimit: -0.04,
  },

  // ── R5 CAUTION: 약세 징조 — 방어 우선 ────────────────────────────────────────
  R5_CAUTION: {
    gate2Required: 10,   // 사실상 CONFIRMED_STRONG_BUY 전용
    gate3Required: 8,
    kellyMultiplier: 0.3,
    maxPositions: 2,
    allowedSignals: ['CONFIRMED_STRONG_BUY'],
    trancheStrategy: '단일 진입, 초단기 익절 우선',
    stopLoss: {
      profileA: -0.05,
      profileB: -0.05,
      profileC: -0.05,
      profileD: -0.05,
    },
    takeProfitPartial: {
      first:  { trigger: 0.06, ratio: 0.5 },
      second: { trigger: 0.10, ratio: 0.5 },
      third:  null,
    },
    dailyLossLimit:  -0.015,
    weeklyLossLimit: -0.03,
  },

  // ── R6 DEFENSE: 하락/블랙스완 — 매수 전면 차단 ──────────────────────────────
  R6_DEFENSE: {
    gate2Required: 99,
    gate3Required: 99,
    kellyMultiplier: 0,
    maxPositions: 0,
    allowedSignals: [],  // 신규 매수 없음 — Pre-Mortem 조건 청산만
    trancheStrategy: 'N/A — 신규 매수 차단',
    stopLoss: {
      profileA: -0.05,
      profileB: -0.05,
      profileC: -0.05,
      profileD: -0.05,
    },
    takeProfitPartial: {
      first:  { trigger: 0.05, ratio: 0.5 },
      second: { trigger: 0.10, ratio: 0.5 },
      third:  null,
    },
    dailyLossLimit:  0,
    weeklyLossLimit: 0,
    emergencyExit: '포지션 30% 즉시 시장가 청산',
    cooldown:      '48시간 신규 매수 잠금',
  },
};

// ─── classifyRegime — 7축 변수 → 6단계 레짐 분류 ───────────────────────────────

/**
 * 7축 실시간 데이터를 받아 6단계 RegimeLevel을 결정.
 * 자동매매 엔진(autoTradeEngine.ts)이 매 사이클마다 호출.
 *
 * 판정 우선순위 (내려갈수록 완화):
 *   R6 블랙스완 → R5 복합 위험 → R3 선행 상승 초기 → R1 완전 Bull → R2 일반 Bull → R4 기본
 *
 * ※ R3을 R1/R2 앞에 체크하는 이유:
 *   지수가 60일선을 아직 회복하지 못한 상태에서 외국인 Passive 전환·VKOSPI 하락이
 *   먼저 포착되는 순간이 수익률이 가장 높은 진입 타이밍이기 때문.
 */
export function classifyRegime(v: RegimeVariables): RegimeLevel {

  // ── R6: 블랙스완 (최우선) ────────────────────────────────────────────────────
  if (
    v.vkospiDayChange   > 30   ||   // VKOSPI 단일일 +30% 급등
    Math.abs(v.usdKrwDayChange) > 3 ||  // USD/KRW ±3% 이상 단일일 이동
    v.kospiDayReturn    < -5         // KOSPI 단일일 -5% 하락
  ) {
    return 'R6_DEFENSE';
  }

  // ── R5: 복합 위험 신호 (6개 중 3개 이상) ─────────────────────────────────────
  const cautionSignals = [
    v.vkospi           > 28,
    v.mhsScore         < 35,
    v.foreignNetBuy5d  < -3000,
    !v.kospiAbove60MA,
    v.spx20dReturn     < -5,
    v.usdKrw20dChange  > 3,
  ];
  if (cautionSignals.filter(Boolean).length >= 3) return 'R5_CAUTION';

  // ── R3: 상승 초기 선행 신호 (5개 중 3개 이상 + MHS ≥ 45) ─────────────────────
  // R1/R2 이전에 체크: 아직 완전한 Bull이 아니지만 선행 지표가 먼저 켜지는 구간
  const earlySignals = [
    v.vkospi5dTrend     < -3,                          // 공포지수 5일 하락 중
    v.foreignNetBuy5d   > 0 && !v.passiveActiveBoth,   // Passive 전환 시작 (Active 미동반)
    v.kospi20dReturn    > 0 && !v.kospiAbove60MA,       // 반등 시도 중 (60일선 미회복)
    v.spx20dReturn      > 1,                            // 글로벌 선행 회복
    v.vix               < 20 && v.dxy5dChange < 0,     // 공포 해소 + 달러 약세
  ];
  if (earlySignals.filter(Boolean).length >= 3 && v.mhsScore >= 45) return 'R3_EARLY';

  // ── R1: 완전한 Bull (8개 중 6개 이상) ───────────────────────────────────────
  const turboSignals = [
    v.vkospi          < 17,
    v.mhsScore        >= 80,
    v.foreignNetBuy5d > 3000,
    v.passiveActiveBoth,
    v.kospiAbove60MA,
    v.spx20dReturn    > 3,
    v.usdKrw20dChange < -1,                // 원화 강세 (달러약세)
    v.sectorCycleStage === 'EARLY' || v.sectorCycleStage === 'MID',
  ];
  if (turboSignals.filter(Boolean).length >= 6) return 'R1_TURBO';

  // ── R2: 일반 Bull ────────────────────────────────────────────────────────────
  if (
    v.vkospi          <= 22  &&
    v.mhsScore        >= 65  &&
    v.kospiAbove20MA         &&
    v.foreignNetBuy5d > 500
  ) {
    return 'R2_BULL';
  }

  // ── R3 강제 승급: KOSPI MA20 대비 +5% 이상 + 외국인 순매수 진입(≥1일) ─────────
  // 보수적 R4에서도 상승 모멘텀이 명확하면 기회를 잡을 수 있도록 강제 승급.
  // FSS 5일 누적이 0인 첫날에도 KIS 당일 보정값(≥1)이 들어오면 즉시 승급한다.
  if (
    (v.kospiAboveMA20Pct ?? 0) > 5 &&
    (v.foreignContinuousBuyDays ?? 0) >= 1
  ) {
    return 'R3_EARLY';
  }

  // ── 기본: R4 Neutral ─────────────────────────────────────────────────────────
  return 'R4_NEUTRAL';
}

// ─── 레짐 전환 감지 헬퍼 ──────────────────────────────────────────────────────

/**
 * 이전 레짐과 현재 레짐을 비교하여 전환 정보를 반환.
 * 자동매매 엔진에서 텔레그램 알림 발송 여부 결정에 사용.
 */
export function detectRegimeTransition(
  previous: RegimeLevel,
  current: RegimeLevel,
): {
  changed: boolean;
  isUpgrade: boolean;   // 방어 → 공격 방향
  isDowngrade: boolean; // 공격 → 방어 방향
  message: string;
} {
  const ORDER: RegimeLevel[] = [
    'R6_DEFENSE', 'R5_CAUTION', 'R4_NEUTRAL', 'R3_EARLY', 'R2_BULL', 'R1_TURBO',
  ];
  if (previous === current) {
    return { changed: false, isUpgrade: false, isDowngrade: false, message: '' };
  }
  const prevIdx = ORDER.indexOf(previous);
  const currIdx = ORDER.indexOf(current);
  const isUpgrade   = currIdx > prevIdx;
  const isDowngrade = currIdx < prevIdx;

  const cfg = REGIME_CONFIGS[current];
  const message = [
    `🔄 레짐 전환: ${previous} → ${current}`,
    `⚙️  Gate2: ${cfg.gate2Required}개 | Gate3: ${cfg.gate3Required}개`,
    `💰 Kelly: ×${cfg.kellyMultiplier} | 최대 보유: ${cfg.maxPositions}종목`,
    `📉 일손실 한도: ${(cfg.dailyLossLimit * 100).toFixed(1)}%`,
  ].join('\n');

  return { changed: true, isUpgrade, isDowngrade, message };
}
