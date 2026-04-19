/**
 * @responsibility 레짐 분류 결과로부터 신규 매수 차단 신호의 ENTRY 단계 진행 여부 한 가지만 검사한다
 *
 * 역사:
 *   원래 4개 충돌(REGIME_TYPE_MISMATCH / LIFECYCLE_BREACH_THRESHOLD_MISMATCH /
 *   POSITION_SIZE_LIMIT_IGNORED / BUYING_HALTED_ENTRY_OPEN)을 런타임에 감지했다.
 *   RegimeContext 도입으로 앞 3개는 컴파일 타임에 발생 자체가 불가능해져 검사를
 *   삭제했다. BUYING_HALTED_ENTRY_OPEN 만 운용 단계 가드로 남는다.
 *
 * 남은 단 하나의 검사:
 *   [CRITICAL] BUYING_HALTED_ENTRY_OPEN
 *     레짐 분류기 buyingHalted=true 일 때 호출 측이 실제로 ENTRY 단계 진입을
 *     차단했는지 책임지는 것은 주문 실행 레이어다. 본 함수는 dashboard 에서
 *     "현재 buyingHalted 상태에서 사용자가 진입 시도 가능한 UI 가 열려 있는지"
 *     를 표면화하여 운영자에게 경보한다.
 */

import type { MarketRegimeClassifierResult } from '../../types/macro';
import type { ParameterConflict, SystemInterferenceResult } from '../../types/interference';

/**
 * 매수 중단 신호가 출력된 상태에서 ENTRY 진입이 여전히 허용되는지 표면화.
 * RegimeContext 자체는 buyingHalted 를 read-only 로 노출만 하므로, 주문 실행
 * 레이어가 이를 무시할 가능성은 본 가드를 통해 운영자에게 알린다.
 */
function detectBuyingHaltedConflict(
  regimeResult: MarketRegimeClassifierResult,
): ParameterConflict | null {
  if (!regimeResult.buyingHalted) return null;

  return {
    id: 'BUYING_HALTED_ENTRY_OPEN',
    severity: 'CRITICAL',
    systems: ['레짐 분류기', '주문 실행 레이어'],
    title: '신규 매수 중단 신호 활성 [CRITICAL]',
    description:
      `레짐 분류기가 ${regimeResult.classification} 레짐으로 신규 매수 전면 중단(buyingHalted=true)을 출력했습니다. ` +
      'RegimeContext.buyingHalted 를 주문 실행 레이어가 즉시 반영했는지 확인하세요.',
    resolution:
      '주문 실행 레이어(서버: signalScanner / 클라이언트: 매수 핸들러)에서 ' +
      'regimeContext.buyingHalted === true 면 ENTRY 진입을 즉시 차단하도록 강제하세요.',
    parameterDetails: {
      expected: 'order.allowEntry = false (buyingHalted 반영)',
      actual:   'order.allowEntry = unknown (실행 레이어 수동 확인 필요)',
    },
  };
}

/**
 * 시장 레짐 자동 분류기 결과만 입력 받아 BUYING_HALTED 충돌 1건을 검사한다.
 *
 * dynamicStop / lifecycle 입력은 더 이상 받지 않는다(RegimeContext 도입으로
 * 양측 파라미터 동기화가 컴파일 타임에 보장됨).
 */
export function checkSystemInterference(
  regimeResult: MarketRegimeClassifierResult | null,
): SystemInterferenceResult {
  const checkedAt = new Date().toISOString();

  if (!regimeResult) {
    return {
      conflicts: [],
      totalConflicts: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      hasBlockingConflict: false,
      summary: '레짐 분류기 결과가 없어 매수 차단 가드 검사를 수행할 수 없습니다.',
      checkedAt,
    };
  }

  const conflict = detectBuyingHaltedConflict(regimeResult);
  const conflicts: ParameterConflict[] = conflict ? [conflict] : [];

  const criticalCount = conflicts.filter(c => c.severity === 'CRITICAL').length;
  const hasBlockingConflict = criticalCount > 0;

  const summary = conflicts.length === 0
    ? `✅ 매수 차단 가드 통과 — 신규 진입 허용 (${regimeResult.classification})`
    : `🚨 매수 차단 신호 활성 — ${regimeResult.classification} 레짐, ENTRY 단계 차단 확인 필요`;

  return {
    conflicts,
    totalConflicts: conflicts.length,
    criticalCount,
    highCount:   0,
    mediumCount: 0,
    hasBlockingConflict,
    summary,
    checkedAt,
  };
}
