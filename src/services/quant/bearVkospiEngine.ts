// @responsibility quant bearVkospiEngine 엔진 모듈
/**
 * bearVkospiEngine.ts — VKOSPI 공포지수 트리거 & Market Neutral 모드 엔진
 *
 * 아이디어 4: VKOSPI 공포지수 트리거 시스템
 * 아이디어 9: Market Neutral 모드 — 롱/인버스 동시 보유로 변동성 수익 추구
 */

import type {
  VkospiTriggerResult,
  VkospiTriggerLevel,
  MarketNeutralResult,
  MarketNeutralLeg,
  BetaNeutralScenario,
  BearRegimeResult,
} from '../../types/quant';

// ─── 아이디어 4: VKOSPI 공포지수 트리거 시스템 ──────────────────────────────────

/**
 * VKOSPI 수치를 4단계 트리거 레벨로 평가하여 인버스 ETF 전략 및 현금 비중을 반환한다.
 * VKOSPI ≥ 50 (역사적 공포) 시 인버스 포지션 최대화 + V자 반등 준비 종목 리스트 병행 생성.
 */
export function evaluateVkospiTrigger(vkospi: number): VkospiTriggerResult {
  const now = new Date().toISOString();

  const INVERSE_ETFS = [
    'KODEX 200선물인버스2X (233740)',
    'KODEX 코스닥150선물인버스 (251340)',
    'TIGER 200선물인버스2X (252670)',
  ];

  const V_RECOVERY_STOCKS = [
    '삼성전자 (005930) — 반도체 V반등 선도주',
    'SK하이닉스 (000660) — HBM 수요 회복 수혜',
    '현대차 (005380) — 글로벌 수출 정상화',
    'POSCO홀딩스 (005490) — 철강 수요 반등',
    'KB금융 (105560) — 금리 안정화 수혜 금융주',
    'KODEX 200 (069500) — 지수 회복 직접 수혜',
  ];

  let level: VkospiTriggerLevel;
  let cashRatio: number;
  let inversePosition: number;
  let description: string;
  let actionMessage: string;
  let dualPositionActive: boolean;
  let vRecoveryStocks: string[] | undefined;

  if (vkospi >= 50) {
    level = 'HISTORICAL_FEAR';
    cashRatio = 10;
    inversePosition = 80;
    dualPositionActive = true;
    vRecoveryStocks = V_RECOVERY_STOCKS;
    description = `VKOSPI ${vkospi.toFixed(1)} — 역사적 공포 이벤트 (2008 금융위기·2020 코로나 수준).`;
    actionMessage = '🚨 역사적 공포 이벤트 — 인버스 ETF 최대 포지션(80%) 유지. 동시에 V자 반등 준비 리스트 자동 생성. 추가 공포 매도 시 분할 역발상 롱 준비.';
  } else if (vkospi >= 40) {
    level = 'ENTRY_2';
    cashRatio = 20;
    inversePosition = 60;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 고공포 구간. 인버스 ETF 추가 진입 신호.`;
    actionMessage = '🔴 인버스 ETF 추가 진입 — 포지션 60%까지 확대. 손절선: VKOSPI 35 하향 복귀 시 절반 청산.';
  } else if (vkospi >= 30) {
    level = 'ENTRY_1';
    cashRatio = 40;
    inversePosition = 30;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 공포 구간 진입. 인버스 ETF 1차 진입 적기.`;
    actionMessage = '🟠 인버스 ETF 1차 진입 — 포지션 30% 구축. 추가 상승 시(VKOSPI 40+) 2차 진입 대기.';
  } else if (vkospi >= 25) {
    level = 'WARNING';
    cashRatio = 20;
    inversePosition = 0;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 경계 구간. Bear Mode 경계경보 발령.`;
    actionMessage = '🟡 Bear Mode 경계경보 — 현금 비중 20% 확보. 신규 롱 포지션 규모 축소. 인버스 ETF 준비 대기.';
  } else {
    level = 'NORMAL';
    cashRatio = 0;
    inversePosition = 0;
    dualPositionActive = false;
    description = `VKOSPI ${vkospi.toFixed(1)} — 정상 시장. Risk-On 최적 환경.`;
    actionMessage = '🟢 정상 시장 — VKOSPI 20 이하는 Risk-On 최적기. 27조건 롱 시스템 전면 가동.';
  }

  return {
    level,
    vkospi,
    cashRatio,
    inversePosition,
    dualPositionActive,
    inverseEtfSuggestions: inversePosition > 0 ? INVERSE_ETFS : [],
    vRecoveryStocks,
    description,
    actionMessage,
    lastUpdated: now,
  };
}

// ─── 아이디어 9: Market Neutral 모드 — 롱/인버스 동시 보유로 변동성 수익 추구 ──

/**
 * TRANSITION 레짐에서 Market Neutral 전략을 평가한다.
 * 롱(50%) + 인버스(30%) + 현금(20%) 구조로 베타를 중립화하여
 * 시장 방향과 무관하게 롱 종목의 개별 알파(초과 수익)만 추구한다.
 *
 * 핵심 공식:
 *   포트폴리오 수익 = 롱 비중 × (시장 수익 + 알파) + 인버스 비중 × (−시장 수익 × 2배) + 현금
 *   → 시장 베타가 상쇄되어 알파가 전체 성과를 좌우한다.
 */
export function evaluateMarketNeutral(
  bearRegimeResult: BearRegimeResult,
): MarketNeutralResult {
  const now = new Date().toISOString();
  const regime = bearRegimeResult.regime;
  const isActive = regime === 'TRANSITION';

  const legs: MarketNeutralLeg[] = [
    {
      type: 'LONG',
      weightPct: 50,
      label: '롱 포지션 (실적 주도주)',
      description: '3-Gate 시스템이 선별한 최고 품질 종목. 조선·방산 등 시장 대비 아웃퍼폼 기대 섹터.',
      examples: ['HD현대중공업', 'LIG넥스원', '한화에어로스페이스', 'HD한국조선해양'],
    },
    {
      type: 'INVERSE',
      weightPct: 30,
      label: '인버스 ETF (시장 헤지)',
      description: 'KOSPI 200 지수 하락 시 수익을 내는 인버스 ETF로 시장 베타를 상쇄한다.',
      examples: ['KODEX 200선물인버스 (114800)', 'TIGER 200선물인버스2X (252670)'],
    },
    {
      type: 'CASH',
      weightPct: 20,
      label: '현금 (기회 대기)',
      description: 'TRANSITION 구간이 BEAR로 전환될 경우 즉시 인버스를 추가하거나, BULL 전환 시 롱 비중을 확대한다.',
      examples: ['CMA', '단기채 ETF'],
    },
  ];

  // 베타 중립화 시나리오: 시장 −5%, 롱 알파 +3%, 인버스 2배 레버리지 기준
  // 롱 수익 = 50% × (−5% + 3%) = −1%
  // 인버스 수익 = 30% × (+10%) = +3%
  // 현금 = 20% × 0% = 0%
  // 합계 = +2%
  const marketReturn = -5;
  const longAlpha = 3;
  const inverseReturn = 10; // 인버스 2배 ETF 기준, 시장 −5% → +10%
  const longReturn = (marketReturn + longAlpha) * (50 / 100);
  const invReturn = inverseReturn * (30 / 100);
  const totalReturn = parseFloat((longReturn + invReturn).toFixed(2));

  const betaNeutralScenario: BetaNeutralScenario = {
    marketReturn,
    longAlpha,
    inverseReturn,
    totalReturn,
    description:
      `시장 ${marketReturn}% 하락 시: 롱(50%) ${longReturn > 0 ? '+' : ''}${longReturn.toFixed(1)}% ` +
      `+ 인버스(30%) +${invReturn.toFixed(1)}% = 포트폴리오 ${totalReturn >= 0 ? '+' : ''}${totalReturn}%`,
  };

  const strategyDescription =
    'TRANSITION 구간(변동성 ↑, 방향 불명확)에서 롱과 인버스를 동시 보유해 시장 방향에 무관하게 ' +
    '롱 종목의 개별 알파만 수익화하는 베타 중립 전략. ' +
    'QuantMaster Pro의 3-Gate 시스템이 선별한 최고 품질 종목에 이 전략을 결합하면 샤프 지수를 극적으로 개선할 수 있다.';

  const sharpeImprovementNote =
    '롱 단독 대비 변동성을 약 40% 축소하면서 알파를 보존 → 샤프 지수 1.2 → 2.0+ 개선 기대';

  const actionMessage = isActive
    ? '🟡 Market Neutral 모드 활성화 — 롱 50% / 인버스 30% / 현금 20% 구조로 베타를 중립화하세요. 3-Gate 선별 실적 주도주 롱 + KODEX 200선물인버스 헤지 권고.'
    : regime === 'BEAR'
    ? '🔴 BEAR 모드 — Market Neutral 전략 비활성. 인버스 비중 확대 및 롱 포지션 전면 청산 권고.'
    : '🟢 BULL 모드 — Market Neutral 전략 불필요. 27조건 롱 시스템 전면 가동.';

  return {
    isActive,
    regime,
    legs,
    betaNeutralScenario,
    sharpeImprovementNote,
    strategyDescription,
    actionMessage,
    lastUpdated: now,
  };
}
