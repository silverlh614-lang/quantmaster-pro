// @responsibility useEngineGuards React hook
/**
 * useEngineGuards — EmergencyActionsPanel 3-버튼(블록/일시정지/보유만) 상태 + 액션.
 *
 * 서버 상태(`/api/auto-trade/engine/guards`) 를 단일 진실 소스로 두고,
 * 토글 시 Optimistic UI 로 즉시 반영 후 서버 응답으로 확정한다.
 */

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { autoTradeApi, type EngineGuardsState } from '../../api';
import { AUTO_TRADE_KEYS, AUTO_TRADE_POLICY } from './queryKeys';

const FALLBACK: EngineGuardsState = {
  blockNewBuy: false,
  autoTradingPaused: false,
  manageOnly: false,
  emergencyStop: false,
};

export interface UseEngineGuardsReturn {
  guards: EngineGuardsState;
  isLoading: boolean;
  toggleBlockNewBuy: () => void;
  togglePauseAutoTrading: () => void;
  toggleManageOnly: () => void;
}

export function useEngineGuards(): UseEngineGuardsReturn {
  const qc = useQueryClient();

  const query = useQuery<EngineGuardsState>({
    queryKey: AUTO_TRADE_KEYS.engineGuards,
    queryFn: () => autoTradeApi.getEngineGuards(),
    ...AUTO_TRADE_POLICY.engineGuards,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const guards = query.data ?? FALLBACK;

  const optimisticApply = (patch: Partial<EngineGuardsState>) => {
    qc.setQueryData<EngineGuardsState>(AUTO_TRADE_KEYS.engineGuards, (prev) => ({
      ...(prev ?? FALLBACK),
      ...patch,
    }));
  };

  const blockMut = useMutation({
    mutationFn: (enabled: boolean) => autoTradeApi.setBlockNewBuy(enabled),
    onMutate: (enabled) => {
      optimisticApply({ blockNewBuy: enabled });
    },
    onSuccess: (data) => {
      optimisticApply({ blockNewBuy: data.blockNewBuy });
      toast.success(data.blockNewBuy ? '신규 매수 차단 활성' : '신규 매수 차단 해제');
    },
    onError: (err: Error) => {
      toast.error('신규 매수 차단 토글 실패', { description: err.message });
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineGuards });
    },
  });

  const pauseMut = useMutation({
    mutationFn: (enabled: boolean) => autoTradeApi.setPauseAutoTrading(enabled),
    onMutate: (enabled) => {
      optimisticApply({ autoTradingPaused: enabled });
    },
    onSuccess: (data) => {
      optimisticApply({ autoTradingPaused: data.autoTradingPaused });
      toast.success(data.autoTradingPaused ? '자동매매 일시정지' : '자동매매 재개');
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
    },
    onError: (err: Error) => {
      toast.error('자동매매 일시정지 토글 실패', { description: err.message });
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineGuards });
    },
  });

  const manageMut = useMutation({
    mutationFn: (enabled: boolean) => autoTradeApi.setManageOnly(enabled),
    onMutate: (enabled) => {
      // 보유만 관리 ON 이면 신규매수 차단도 ON 으로 함께 낙관 반영.
      optimisticApply({
        manageOnly: enabled,
        blockNewBuy: enabled ? true : guards.blockNewBuy,
      });
    },
    onSuccess: (data) => {
      optimisticApply({ manageOnly: data.manageOnly, blockNewBuy: data.blockNewBuy });
      toast.success(data.manageOnly ? '보유만 관리 모드 진입' : '보유만 관리 모드 해제');
    },
    onError: (err: Error) => {
      toast.error('보유만 관리 토글 실패', { description: err.message });
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineGuards });
    },
  });

  const toggleBlockNewBuy = useCallback(() => {
    blockMut.mutate(!guards.blockNewBuy);
  }, [blockMut, guards.blockNewBuy]);

  const togglePauseAutoTrading = useCallback(() => {
    pauseMut.mutate(!guards.autoTradingPaused);
  }, [pauseMut, guards.autoTradingPaused]);

  const toggleManageOnly = useCallback(() => {
    manageMut.mutate(!guards.manageOnly);
  }, [manageMut, guards.manageOnly]);

  return {
    guards,
    isLoading: query.isLoading,
    toggleBlockNewBuy,
    togglePauseAutoTrading,
    toggleManageOnly,
  };
}
