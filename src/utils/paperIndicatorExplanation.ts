// @responsibility Translate stored indicator formulas into plain Korean explanations.
import { PAPER_FEATURES, type PaperFeatureKey } from '../types/paperObservationFeatures';
import { PAPER_INVENTED_FEATURE_CUTS, type PaperIndicatorFormula } from '../types/paperIndicatorFormula';

export const PAPER_FEATURE_EXPLANATIONS: Record<PaperFeatureKey, string> = {
  rsi14: '최근 14일 가격의 상승 힘과 하락 힘을 비교합니다.',
  rsiChange5: 'RSI가 5일 전보다 얼마나 달라졌는지 봅니다.',
  volumeRatio20: '최근 완료 거래일의 거래량이 이전 20일 평균의 몇 배인지 봅니다.',
  turnover20: '종가와 거래량으로 추정한 최근 20일 평균 거래 규모입니다.',
  return20: '최근 20거래일 동안 가격이 얼마나 올랐거나 내렸는지 봅니다.',
  peerRelative20: '같은 시장의 관측 종목들과 비교한 20일 수익률 차이입니다.',
  ma20Gap: '완료 종가가 20일 평균 가격보다 얼마나 높거나 낮은지 봅니다.',
  ma60Gap: '완료 종가가 60일 평균 가격보다 얼마나 높거나 낮은지 봅니다.',
  ma20Slope5: '20일 평균 가격이 최근 5일 동안 얼마나 변했는지 봅니다.',
  high20Gap: '완료 종가가 이전 20일 고가에서 얼마나 떨어져 있는지 봅니다.',
  gapPct: '최근 완료 거래일의 시가가 전일 종가보다 얼마나 높거나 낮았는지 봅니다.',
  atr14Pct: '최근 가격 움직임의 폭을 종가 대비 비율로 봅니다.',
  adx14: '가격 추세의 강도를 봅니다. 높다고 상승 추세라는 뜻은 아닙니다.',
  macdHistogramPct: '빠른 가격 흐름과 느린 가격 흐름의 차이가 신호선과 얼마나 벌어졌는지 봅니다.',
  bollingerB: '최근 가격 분포로 만든 볼린저 밴드 안에서 종가의 위치를 봅니다.',
  stochasticK14: '최근 14일 고가·저가 범위에서 종가가 어느 위치에 있는지 봅니다.',
  per: '현재 주가가 주당 이익의 몇 배인지 봅니다. 양수 자료만 사용합니다.',
  pbr: '현재 주가가 주당 순자산의 몇 배인지 봅니다. 양수 자료만 사용합니다.',
  revenueGrowth: '공시된 매출이 전년보다 얼마나 늘거나 줄었는지 봅니다.',
  operatingMargin: '매출 중 영업이익이 차지하는 비율입니다.',
  netMargin: '매출 중 순이익이 차지하는 비율입니다.',
  roe: '자기자본 대비 순이익의 비율입니다.',
  debtRatio: '자기자본 대비 부채의 비율입니다.',
  currentRatio: '단기 부채에 비해 단기 자산이 얼마나 있는지 봅니다.',
  operatingCashFlowSign: '영업활동 현금흐름이 양수·0·음수인지 구분합니다.',
  equityRatio: '전체 자산 중 자기자본이 차지하는 비율입니다.',
  return5: '최근 5거래일 동안의 가격 변화율입니다.',
  realizedVolatility20: '최근 20일 일간 수익률이 얼마나 들쭉날쭉했는지 봅니다.',
  closeLocationPct: '최근 완료 거래일의 고가·저가 사이에서 종가의 위치를 봅니다.',
  volumeFlow20: '최근 20일 종가 위치에 거래량을 반영한 흐름입니다. 실제 투자자별 순매수액은 아닙니다.',
  rangeCompression5To20: '최근 5일 가격 움직임의 폭을 20일 평균과 비교합니다.',
  efficiency10: '최근 10일 동안 오간 거리 중 한 방향으로 이동한 비율을 봅니다.',
};

export function explainPaperIndicator(formula: PaperIndicatorFormula) {
  const left = PAPER_FEATURES[formula.left.feature].label, right = PAPER_FEATURES[formula.right.feature].label;
  const operation = {
    MEAN: { name: '평균', meaning: '두 재료의 기준 대비 수준을 평균으로 묶습니다. 한쪽이 높고 다른 쪽이 낮으면 서로 상쇄될 수 있습니다.',
      example: '환산값이 각각 +1과 −1이면 평균은 0입니다.' },
    DIFFERENCE: { name: '차이', meaning: '첫 번째 재료의 환산값에서 두 번째를 뺍니다. 양수면 첫 번째가 기준 대비 더 높고, 음수면 두 번째가 더 높습니다.',
      example: '환산값이 각각 +1과 −1이면 차이는 +2입니다.' },
    PRODUCT: { name: '곱', meaning: '두 재료가 각자의 기준보다 같은 쪽에 있는지 봅니다. 둘 다 높거나 둘 다 낮으면 양수, 서로 반대쪽이면 음수입니다.',
      example: '환산값이 −1과 −1이어도 곱은 +1입니다. 양수라고 두 재료가 모두 높다는 뜻은 아닙니다.' },
  }[formula.operation];
  return { title: `${left} · ${right} ${operation.name}`, ...operation,
    ingredients: [formula.left, formula.right].map(operand => ({ ...operand,
      label: PAPER_FEATURES[operand.feature].label, meaning: PAPER_FEATURE_EXPLANATIONS[operand.feature] })) };
}

export function inventedRuleRange(bucket: number): string {
  const lower = PAPER_INVENTED_FEATURE_CUTS[bucket - 1], upper = PAPER_INVENTED_FEATURE_CUTS[bucket];
  return lower === undefined ? `${upper} 미만` : upper === undefined ? `${lower} 이상` : `${lower} 이상 ${upper} 미만`;
}
