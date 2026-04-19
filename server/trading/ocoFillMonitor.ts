/**
 * ocoFillMonitor.ts — Phase 3.1 스켈레톤: LIVE 전환 시 활성화될 OCO 자동 등록 루프.
 *
 * 현재 상태: **드라이런 전용**. feature flag `OCO_AUTO_REGISTER=true` 이전엔 절대
 * 실제 주문 API 를 호출하지 않는다. 구조만 만들어두고 나중에 flag 한 줄로 전환.
 *
 * 역할 구분 (기존 코드와):
 *   - ocoCloseLoop.ts:    이미 등록된 OCO 쌍의 "생존" 상태 15분 폴링.
 *   - ocoConfirmLoop.ts:  CCLD 기반 체결 확정 30초 폴링, 반대 주문 취소.
 *   - ocoFillMonitor.ts(신규): 매수 체결 직후 **자동으로** stop-loss/take-profit
 *                              지정가 쌍을 등록. Shadow 기간엔 플래그 off.
 *
 * Shadow 기간 동안 이 파일은:
 *   1. planOcoRegistration() — 매수 체결 row 로부터 등록 plan 을 산출 (순수함수).
 *   2. dryRunRegister()      — 플랜을 로그에만 기록. 실주문 없음.
 *   3. liveRegister()        — flag 가 true 일 때만 실행. 현재는 no-op + 명시적 거부.
 *
 * LIVE 전환 체크리스트 (flag=true 로 전환하기 전):
 *   [ ] KIS_IS_REAL=true 확인 (실계좌 모드에서만 작동)
 *   [ ] cancelKisOrder + placeKisSellOrder 의 에러 핸들링 E2E 테스트
 *   [ ] 체결 직후 짧은 네이키드 창에 대한 killSwitch 연동
 *   [ ] OCO 쌍 등록 실패 시 롤백 시나리오 (한쪽만 등록된 상태 방지)
 */

import { CCLD_TR_ID, KIS_IS_REAL } from '../clients/kisClient.js';

// ── Feature Flag ──────────────────────────────────────────────────────────────

/**
 * OCO 자동 등록 활성화 플래그.
 * Shadow 기간엔 반드시 false. LIVE 전환 후 충분한 검증 완료 시에만 true.
 */
export const OCO_AUTO_REGISTER_ENABLED =
  process.env.OCO_AUTO_REGISTER === 'true';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface OcoRegistrationPlan {
  stockCode:   string;
  quantity:    number;
  stopPrice:   number;    // 손절 지정가
  targetPrice: number;    // 익절 지정가
  tradeId:     string;    // shadow-trade 식별자 (추적용)
  /** CCLD 조회 시 원본 주문번호 — 체결 이벤트와 연결. */
  parentOrderNo?: string;
}

export interface OcoRegistrationResult {
  status: 'DRY_RUN' | 'REGISTERED' | 'SKIPPED' | 'REJECTED';
  reason: string;
  /** 등록된 주문번호 쌍 (REGISTERED 상태일 때만). */
  stopOrderNo?:   string;
  targetOrderNo?: string;
}

// ── 순수 로직: 계획 수립 ──────────────────────────────────────────────────────

/**
 * 체결된 매수 포지션 정보로부터 OCO 등록 계획을 생성한다.
 * 순수함수 — I/O 없음, 테스트 용이.
 *
 * 유효성 검증:
 *   - 수량 > 0
 *   - stopPrice < targetPrice (호가 정렬)
 *   - 둘 다 양수
 */
export function planOcoRegistration(input: {
  stockCode: string;
  filledQty: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  tradeId: string;
  parentOrderNo?: string;
}): OcoRegistrationPlan | null {
  const { stockCode, filledQty, stopLossPrice, takeProfitPrice, tradeId, parentOrderNo } = input;
  if (!stockCode || filledQty <= 0) return null;
  if (!(stopLossPrice > 0 && takeProfitPrice > 0)) return null;
  if (!(stopLossPrice < takeProfitPrice)) return null;
  return {
    stockCode,
    quantity:   filledQty,
    stopPrice:   Math.round(stopLossPrice),
    targetPrice: Math.round(takeProfitPrice),
    tradeId,
    parentOrderNo,
  };
}

// ── 드라이런 / 거부 경로 ───────────────────────────────────────────────────────

function logPlan(plan: OcoRegistrationPlan, prefix: string): void {
  console.log(
    `${prefix} ${plan.stockCode} ×${plan.quantity} ` +
    `손절 ${plan.stopPrice.toLocaleString()} / 익절 ${plan.targetPrice.toLocaleString()} ` +
    `(tradeId=${plan.tradeId}${plan.parentOrderNo ? ` parent=${plan.parentOrderNo}` : ''})`,
  );
}

/**
 * 드라이런 등록 — flag off 또는 Shadow 모드에서 사용.
 * 실제 KIS 주문 API 를 호출하지 않고 로그만 남긴다.
 */
export async function dryRunRegisterOco(plan: OcoRegistrationPlan): Promise<OcoRegistrationResult> {
  logPlan(plan, '[OcoFillMonitor DRY-RUN]');
  return { status: 'DRY_RUN', reason: 'OCO_AUTO_REGISTER flag off (Shadow/staging)' };
}

/**
 * LIVE 등록 진입점 — flag 가 true 일 때만 실제 경로로 분기.
 *
 * **현재 상태**: 스켈레톤. flag on + KIS_IS_REAL on 경로도 아직 미구현
 * (명시적 REJECTED 반환). LIVE 전환 구간에서 구현을 채우기 전엔 안전.
 */
export async function registerOcoForFill(plan: OcoRegistrationPlan): Promise<OcoRegistrationResult> {
  if (!OCO_AUTO_REGISTER_ENABLED) {
    return dryRunRegisterOco(plan);
  }
  if (!KIS_IS_REAL) {
    return {
      status: 'SKIPPED',
      reason: 'KIS_IS_REAL=false — LIVE 실계좌 모드에서만 OCO 자동 등록',
    };
  }
  // LIVE 전환 시 구현 채움 (flag + real 계좌 동시에 true 일 때만 도달).
  // 현 시점엔 명시적 거부 — 의도치 않은 실주문 실행 원천 차단.
  logPlan(plan, '[OcoFillMonitor REJECTED-unimplemented]');
  return {
    status: 'REJECTED',
    reason: '구현 미완성 — LIVE 전환 체크리스트 통과 후 placeKisSellOrder 쌍 등록 경로를 채울 것',
  };
}

// ── 진단용: TR id 상수 노출 ───────────────────────────────────────────────────

/** 현재 환경(KIS_IS_REAL)에 바인딩된 체결 조회 TR id — OCO 등록 후 확정 루프에 연결. */
export function getConfirmTrId(): string { return CCLD_TR_ID; }
