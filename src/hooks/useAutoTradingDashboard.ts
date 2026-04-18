/**
 * useAutoTradingDashboard — 자동매매 관제실 (AutoTradePage) 를 위한
 *                          화면 친화 집계 훅.
 *
 * **Phase 1 리팩토링 (2026-04):** 이 훅은 이전에 mock 상수를 반환했다.
 * 이제는 `useAutoTradeEngine` (TanStack Query 기반) 으로부터 실데이터를
 * 수신하여 `autoTradingMapper` 로 UI 스키마(`AutoTradingDashboardState`) 로
 * 변환한다. 서버에 아직 존재하지 않는 섹션(signals, logs, broker, emergency)
 * 은 `deriveFallbackSections` 로 현 데이터에서 최선의 추정값을 구성한다.
 *
 * (Phase 2 이후 broker 연결/신호 큐 전용 엔드포인트가 추가되면, fallback
 *  섹션을 점진적으로 실데이터로 교체한다.)
 */

import { useMemo } from 'react';
import { useAutoTradeEngine } from './autoTrade';
import {
  toControlCenterState,
  toExecutionOrders,
  toPositions,
  toRiskRules,
  deriveSignalsFromShadowTrades,
  deriveLogsFromShadowTrades,
  deriveBrokerState,
  deriveEmergencyState,
} from '../services/autoTrading/autoTradingMapper';
import type { AutoTradingDashboardState } from '../services/autoTrading/autoTradingTypes';

interface UseAutoTradingDashboardResult {
  data: AutoTradingDashboardState | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  /** 엔진 토글 (컨트롤 센터의 play/pause 버튼용). */
  toggleEngine: () => Promise<void>;
  /** 토글 요청 진행 중 여부 — 버튼 로딩 스피너용. */
  engineToggling: boolean;
  /** 현재 엔진이 실행 중인지. */
  isRunning: boolean;
  /** 현재 운용 모드 ('LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL'). */
  mode: string;
  /** Phase 2 로 이관 예정: 비상정지 전용 액션. 현재는 토글과 동일. */
  emergencyStop: () => Promise<void>;
}

export function useAutoTradingDashboard(): UseAutoTradingDashboardResult {
  const engine = useAutoTradeEngine();

  const data = useMemo<AutoTradingDashboardState | null>(() => {
    // 초기 로드 중 + 데이터 없음 → null 반환하여 페이지가 로딩 UI 표시.
    if (engine.isInitialLoading && !engine.engineStatus && engine.holdings.length === 0) {
      return null;
    }

    return {
      control: toControlCenterState(engine.engineStatus, engine.accountSummary),
      orders: toExecutionOrders(engine.serverShadowTrades),
      positions: toPositions(engine.holdings),
      riskRules: toRiskRules(engine.engineStatus, engine.buyAudit),
      signals: deriveSignalsFromShadowTrades(engine.serverShadowTrades),
      logs: deriveLogsFromShadowTrades(engine.serverShadowTrades),
      broker: deriveBrokerState(engine.engineStatus, engine.accountSummary),
      emergency: deriveEmergencyState(engine.engineStatus, engine.buyAudit),
    };
  }, [
    engine.isInitialLoading,
    engine.engineStatus,
    engine.accountSummary,
    engine.serverShadowTrades,
    engine.holdings,
    engine.buyAudit,
  ]);

  return {
    data,
    loading: engine.isLoading,
    error: engine.error ? '자동매매 대시보드를 불러오지 못했습니다.' : null,
    refresh: engine.refetchAll,
    toggleEngine: engine.toggleEngine,
    engineToggling: engine.engineToggling,
    isRunning: Boolean(engine.engineStatus?.running),
    mode: data?.control.mode ?? 'MANUAL',
    // 비상정지는 이제 단방향 엔드포인트로 분리됨 — toggle 반전 리스크 제거.
    emergencyStop: engine.emergencyStop,
  };
}
