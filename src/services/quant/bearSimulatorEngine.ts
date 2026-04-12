/**
 * bearSimulatorEngine.ts — 아이디어 8: Bear Mode 손익 시뮬레이터
 *
 * 사용자가 입력한 Bear 구간 시나리오를 기반으로 롱 포트폴리오 수익률과
 * Gate -1 감지 후 KODEX 인버스 2X 전환 시뮬레이션 수익률의 알파 차이를 계산한다.
 */

import type {
  BearModeSimulatorInput,
  BearModeSimulatorResult,
  BearModeSimulatorScenarioResult,
} from '../../types/quant';

/** KODEX 인버스 2X ETF 실효 배율 (슬리피지·롤링 비용 반영) */
const BEAR_SIM_INVERSE_2X_MULTIPLIER = 1.8;

/** Bear Mode 시뮬레이터에서 사용할 기본 인버스 ETF 명칭 */
const BEAR_SIM_ETF_NAME = 'KODEX 인버스 2X (122630)';

/** Gate -1 감지 후 Bear Mode 전환까지 대기하는 거래일 수 (D+3) */
const BEAR_SIM_SWITCH_DELAY_DAYS = 3;

/**
 * Gate -1 감지일로부터 지정된 거래일 수만큼 뒤의 날짜를 계산한다.
 * 토·일은 거래일에서 제외한다.
 * 참고: 한국 공휴일은 별도 처리하지 않으며, 실제 D+3 전환일은 공휴일 여부에 따라
 * 하루 이상 차이가 날 수 있다 (시뮬레이션 추정치로 사용).
 */
function addTradingDays(fromDateStr: string, days: number): string {
  const date = new Date(fromDateStr);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    const dow = date.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return date.toISOString().split('T')[0];
}

/**
 * 아이디어 8: Bear Mode 손익 시뮬레이터
 *
 * 사용자가 입력한 Bear 구간 시나리오를 기반으로 다음을 계산한다:
 *   1. 롱 포트폴리오가 Bear 구간에서 기록한 실제 수익률 (사용자 입력)
 *   2. Gate -1이 Bear를 감지한 D+3에 KODEX 인버스 2X로 전환했을 경우 시뮬레이션 수익률
 *   3. 두 수익률의 알파 차이 (%p)
 *
 * Bear Mode 수익 추정:
 *   bearModeReturn = -1 × marketReturn × INVERSE_2X_MULTIPLIER (1.8)
 *
 * @param inputs 사용자가 입력한 Bear 구간 시나리오 목록
 */
export function evaluateBearModeSimulator(
  inputs: BearModeSimulatorInput[],
): BearModeSimulatorResult {
  const now = new Date().toISOString();

  const scenarios: BearModeSimulatorScenarioResult[] = inputs.map(input => {
    const switchDate = addTradingDays(input.gateDetectionDate, BEAR_SIM_SWITCH_DELAY_DAYS);

    // Bear Mode 수익률: 시장 하락 × 인버스 2X 배율 (시장이 하락하면 양의 수익)
    const bearModeReturn = parseFloat(
      (-input.marketReturn * BEAR_SIM_INVERSE_2X_MULTIPLIER).toFixed(2),
    );
    const longReturn = input.longPortfolioReturn;
    const alphaDifference = parseFloat((bearModeReturn - longReturn).toFixed(2));

    let recommendation: string;
    if (alphaDifference > 20) {
      recommendation = `🔴 강력한 전환 신호 — Bear Mode 전환 시 ${alphaDifference.toFixed(1)}%p 알파 획득 가능. 다음 Gate -1 감지 시 D+3 즉시 전환 권고.`;
    } else if (alphaDifference > 0) {
      recommendation = `🟡 유의미한 알파 — ${alphaDifference.toFixed(1)}%p 개선. 시스템 신호를 따르는 것이 직관 대비 유리.`;
    } else {
      recommendation = `🟢 Bear Mode 전환 효과 미미 — 해당 구간에서는 롱 포트폴리오가 Bear Mode 대비 우위.`;
    }

    return {
      label: input.label,
      bearStartDate: input.bearStartDate,
      bearEndDate: input.bearEndDate,
      switchDate,
      switchDayOffset: BEAR_SIM_SWITCH_DELAY_DAYS,
      longReturn,
      bearModeReturn,
      alphaDifference,
      inverseEtfName: BEAR_SIM_ETF_NAME,
      recommendation,
    };
  });

  // 최고 알파 시나리오: 동일 알파 시 먼저 나온 시나리오(낮은 인덱스) 선택
  const bestScenario = scenarios.length > 0
    ? [...scenarios].sort((a, b) => b.alphaDifference - a.alphaDifference)[0]
    : null;

  let conclusionMessage: string;
  if (scenarios.length === 0) {
    conclusionMessage = '🟢 시나리오 없음 — Bear 구간 데이터를 입력하면 손익 시뮬레이션이 자동 계산됩니다.';
  } else if (bestScenario && bestScenario.alphaDifference > 0) {
    conclusionMessage = `📊 시스템 신호를 따랐다면 최대 +${bestScenario.alphaDifference.toFixed(1)}%p 알파 획득 가능 (${bestScenario.label}). 데이터가 말했고, 그걸 따랐다면 이만큼 벌었다.`;
  } else {
    conclusionMessage = '📊 시뮬레이션 완료 — 입력된 시나리오에서는 Bear Mode 전환 효과가 제한적입니다.';
  }

  return {
    scenarios,
    bestScenario,
    conclusionMessage,
    lastUpdated: now,
  };
}
