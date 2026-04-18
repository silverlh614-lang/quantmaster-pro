/**
 * Auto-Trade Mutations — 엔진 토글, reconcile, shadow trade 동기화.
 *
 * mutation 성공 시 관련 쿼리를 invalidate 하여 SSoT 원칙을 유지한다.
 * (Phase 2 에서 optimistic UI + toast.promise 가 추가 예정 — 훅 반환 형태는
 *  TanStack `UseMutationResult` 를 그대로 사용해 확장 친화적으로 설계.)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  autoTradeApi,
  type EngineStatus,
  type EngineToggleResponse,
  type ReconcileSummary,
  type ServerShadowTrade,
  type ShadowForceInputPatch,
  type ShadowForceInputResponse,
} from '../../api';
import { AUTO_TRADE_KEYS } from './queryKeys';

// ── 엔진 ON/OFF 토글 ────────────────────────────────────────────
export function useToggleEngineMutation() {
  const qc = useQueryClient();
  return useMutation<EngineToggleResponse, Error, void>({
    mutationFn: () => autoTradeApi.toggleEngine(),
    onSuccess: (data) => {
      qc.setQueryData<EngineStatus | undefined>(
        AUTO_TRADE_KEYS.engineStatus,
        (prev) => (prev ? { ...prev, running: data.running, emergencyStop: data.emergencyStop } : prev),
      );
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
    },
  });
}

// ── 수동 Reconciliation ─────────────────────────────────────────
export function useRunReconcileMutation() {
  const qc = useQueryClient();
  return useMutation<ReconcileSummary & { dataIntegrityBlocked: boolean }, Error, void>({
    mutationFn: () => autoTradeApi.runReconcile(),
    onSuccess: (data) => {
      qc.setQueryData(AUTO_TRADE_KEYS.reconcile, {
        last: data,
        dataIntegrityBlocked: data.dataIntegrityBlocked,
      });
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.reconcile });
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
    },
  });
}

// ── Shadow Trade 동기화 ─────────────────────────────────────────
export function useSyncShadowTradeMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, ServerShadowTrade>({
    mutationFn: (trade) => autoTradeApi.syncShadowTrade(trade),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.shadowTrades });
    },
  });
}

// ── Shadow Trade 강제 입력 (수량 불일치 복구) ───────────────────
export function useForceUpdateShadowTradeMutation() {
  const qc = useQueryClient();
  return useMutation<
    ShadowForceInputResponse,
    Error,
    { id: string; patch: ShadowForceInputPatch }
  >({
    mutationFn: ({ id, patch }) => autoTradeApi.forceUpdateShadowTrade(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.shadowTrades });
    },
  });
}
