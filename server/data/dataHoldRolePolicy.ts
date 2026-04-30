// @responsibility ADR-0128 DataHoldRole 역할별 fallback 정책 SSOT — 보유 포지션 exit 보존 의무
/**
 * dataHoldRolePolicy.ts (ADR-0128) — 역할별 DATA_HOLD 동작 SSOT.
 *
 * ADR-0117 의 `WaitReason='DATA_HOLD'` 가 호출자 단일 분기에서만 처리되어 *역할별*
 * (매수 후보 / 워치리스트 / 보유 포지션) fallback 정책이 분산. 본 모듈이 단일
 * SSOT 로 통합 — 매트릭스가 한 곳에 있어야 *어떤 역할에서도 보유 포지션 손절 경로
 * 는 절대 차단 안 됨* 안전망 보장.
 *
 * **절대 규칙** — `HELD_POSITION` 의 `blockSell` 은 영원히 false. KIS 현재가 기반
 * 손절은 검증 실패와 무관하게 작동 (절대 규칙 #4 autoTradeEngine 단일 통로 정합).
 *
 * ENV 우회 `DATA_HOLD_ROLE_POLICY_DISABLED=true` → 모든 역할에서 blockSell=false +
 * blockBuy=true (안전 default — exit 항상 보존).
 */

/** 종목의 *현재 시점* 역할. 매수 후보 / 워치리스트 멤버 / 보유 포지션. */
export type DataHoldRole = 'BUY_CANDIDATE' | 'WATCHLIST' | 'HELD_POSITION';

/** sanity 위반 종목에 부착될 fallback 정책. blockSell=false 보장이 핵심. */
export interface DataHoldAction {
  /** 매수 차단 여부 — 모든 역할에서 true (sanity 미통과 종목 신규 진입 불허). */
  blockBuy: boolean;
  /**
   * 매도 차단 여부 — HELD_POSITION 영원히 false. exit 경로 보존 절대 규칙.
   * BUY_CANDIDATE 는 보유 종목 아니라 N/A 이지만 false 로 통일 (안전 default).
   */
  blockSell: boolean;
  /** 알림 차단 여부 — 매수 알림만 보류 (exit 알림은 별도 경로). */
  blockAlert: boolean;
  /** UI 마킹 — WATCHLIST/HELD_POSITION 종목은 운영자 검토 필요 표시. */
  uiMarker: 'NONE' | 'PENDING_VERIFICATION';
  /** 운영자 진단용 사유 텍스트. */
  reason: string;
}

/** ENV 우회 — true 시 모든 역할에서 blockSell=false + blockBuy=true (안전 default). */
export function isDataHoldRolePolicyDisabled(): boolean {
  return process.env.DATA_HOLD_ROLE_POLICY_DISABLED === 'true';
}

/**
 * 역할별 DATA_HOLD 동작 SSOT.
 *
 * | Role             | blockBuy | blockSell | blockAlert | uiMarker             |
 * |------------------|----------|-----------|------------|----------------------|
 * | BUY_CANDIDATE    | true     | false (N/A) | true     | NONE                 |
 * | WATCHLIST        | true     | false     | true       | PENDING_VERIFICATION |
 * | HELD_POSITION    | true     | **false** | true       | PENDING_VERIFICATION |
 *
 * ENV `DATA_HOLD_ROLE_POLICY_DISABLED=true` 시 → 모든 역할 안전 default 적용
 * (blockBuy=true / blockSell=false / blockAlert=true / uiMarker='NONE').
 *
 * @param role 종목의 현재 시점 역할.
 * @returns 호출자가 의무 적용할 fallback 정책.
 */
export function resolveDataHoldAction(role: DataHoldRole): DataHoldAction {
  if (isDataHoldRolePolicyDisabled()) {
    return {
      blockBuy: true,
      blockSell: false,
      blockAlert: true,
      uiMarker: 'NONE',
      reason: 'DATA_HOLD policy disabled (ENV) — 안전 default: 매수 차단, exit 보존',
    };
  }

  switch (role) {
    case 'BUY_CANDIDATE':
      return {
        blockBuy: true,
        blockSell: false, // N/A — 보유 종목 아니지만 안전 default
        blockAlert: true,
        uiMarker: 'NONE',
        reason: '매수 후보 자동 탈락 (당일)',
      };
    case 'WATCHLIST':
      return {
        blockBuy: true,
        blockSell: false,
        blockAlert: true,
        uiMarker: 'PENDING_VERIFICATION',
        reason: '워치리스트 알림 보류 + UI 마킹',
      };
    case 'HELD_POSITION':
      return {
        blockBuy: true,
        // 절대 규칙 — HELD_POSITION blockSell 은 영원히 false. 어떤 ENV/분기에서도 true 전환 금지.
        blockSell: false,
        blockAlert: true,
        uiMarker: 'PENDING_VERIFICATION',
        reason: '보유 종목 — 매수/알림 차단, exit 경로 유지',
      };
    default: {
      // exhaustive check — 컴파일러가 union 변경 시 알림
      const _exhaustive: never = role;
      void _exhaustive;
      return {
        blockBuy: true,
        blockSell: false,
        blockAlert: true,
        uiMarker: 'NONE',
        reason: 'unknown role — 안전 default',
      };
    }
  }
}
