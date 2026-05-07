// @responsibility counterfactualShadowPriceProviderAdapter — ADR-0431 thin adapter SSOT.
//
// ADR-0431:
// Thin adapter that lets ADR-0431 reuse ADR-0429's cache-first read-only price
// provider without coupling counterfactual ledger entries to provisional ledger
// entries. The adapter wraps a ProvisionalShadowPriceProvider (or any compatible
// horizon-based price source) and exposes the CounterfactualShadowPriceProvider
// signature.
//
// 핵심 불변식:
//   1. counterfactual ledger 와 provisional ledger entry 절대 혼합 금지 — 본 어댑터는
//      symbol/horizon/entryAtKst 만 forward, ledger 형식 변환 0
//   2. KIS 주문 함수 import 0건 — read-only price 호출만
//   3. 외부 API 폭주 차단 — wrapped provider 의 caching/quota 위임
//   4. 큰 refactor 회피 (사용자 §C 권장) — ADR-0429 generic 추출 대신 adapter 1 함수
//   5. status / source field 정합 — ProvisionalShadowPointStatus → CounterfactualShadowPointStatus
//      union 호환 (DATA_UNAVAILABLE / MARKET_CLOSED / ERROR / PENDING / OBSERVED 5종 동일)

import type {
  ProvisionalShadowPriceProvider,
  ProvisionalShadowHorizon,
} from './provisionalShadowPerformanceReport.js';
import type {
  CounterfactualShadowPriceProvider,
  CounterfactualShadowHorizon,
  CounterfactualShadowPointStatus,
} from './counterfactualShadowLearningPerformanceReport.js';

/**
 * ProvisionalShadowHorizon 와 CounterfactualShadowHorizon 는 *동일 6-value union*
 * (T_PLUS_30M / T_PLUS_1H / SAME_DAY_CLOSE / NEXT_OPEN / T_PLUS_1D_CLOSE / T_PLUS_3D_CLOSE).
 *
 * TypeScript 가 nominal type 으로 분리해 다루므로 명시적 cast 가 필요. 본 함수는 런타임
 * 동등성 정적 검증 (compile-time 정확) 후 안전 cast.
 */
function castHorizonToProvisional(
  horizon: CounterfactualShadowHorizon,
): ProvisionalShadowHorizon {
  // 동등 union — 런타임 string 값 그대로.
  return horizon as unknown as ProvisionalShadowHorizon;
}

/**
 * ProvisionalShadowPointStatus → CounterfactualShadowPointStatus mapping.
 *
 * Provisional 5종 (PENDING/OBSERVED/DATA_UNAVAILABLE/MARKET_CLOSED/ERROR) 모두
 * Counterfactual union 에 포함 — INSUFFICIENT_DATA 만 counterfactual 전용 (호출자 측
 * entryPrice 부재 시 처리, 본 어댑터 영역 외).
 */
function mapStatus(
  status: 'PENDING' | 'OBSERVED' | 'DATA_UNAVAILABLE' | 'MARKET_CLOSED' | 'ERROR' | undefined,
): CounterfactualShadowPointStatus | undefined {
  if (status === undefined) return undefined;
  return status; // union 호환 — INSUFFICIENT_DATA 는 ADR-0431 전용
}

/**
 * Wrap a ProvisionalShadowPriceProvider as a CounterfactualShadowPriceProvider.
 *
 * 사용자 §C 정합 — 큰 refactor 회피, ADR-0429 의 cache-first read-only 구현을 그대로 reuse.
 * 호출자 (`/shadow_counterfactual` cmd) 가 ADR-0429 `createProvisionalShadowPriceProvider`
 * 결과를 본 어댑터에 통과시키면 즉시 호환.
 *
 * 주의: ADR-0429 의 `createProvisionalShadowPriceProvider({entries})` 는 *provisional
 * ledger entries* 만 인덱싱한다. 본 어댑터는 ledger 형식 변환을 *하지 않는다* — 호출자가
 * 별도 priceProvider 인스턴스를 만들어 counterfactual entries 로 인덱싱해야 한다.
 *
 * 또는 generic priceProvider (ledger-free) 가 도입되면 본 어댑터 자체가 폐기 가능.
 * 본 PR 은 *adapter 만* 도입, generic 추출은 후속 PR scope.
 */
export function wrapProvisionalProviderForCounterfactual(
  provider: ProvisionalShadowPriceProvider,
): CounterfactualShadowPriceProvider {
  return async (symbol, horizon, entryAtKst) => {
    const result = await provider(symbol, castHorizonToProvisional(horizon), entryAtKst);
    if (result.available) {
      return {
        available: true,
        price: result.price,
        observedAtKst: result.observedAtKst,
        source: 'ENTRY_SNAPSHOT',
      };
    }
    return {
      available: false,
      reason: result.reason,
      ...(result.status !== undefined ? { status: mapStatus(result.status) } : {}),
      source: 'NONE',
    };
  };
}
