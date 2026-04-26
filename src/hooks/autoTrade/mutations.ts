// @responsibility mutations React hook
/**
 * Auto-Trade Mutations — 엔진 토글, reconcile, shadow trade 동기화.
 *
 * **Phase 2 강화**:
 *   - 엔진 토글에 Optimistic UI 적용: 클릭 즉시 UI 가 "실행중/정지" 로 반영되고,
 *     서버 응답 실패 시 `onError` 에서 이전 상태로 롤백 + toast 에러.
 *   - `sonner` 의 `toast.promise()` 로 로딩 → 성공/실패 상태 인라인 알림.
 *   - 24번 보고서: 0.1초 지연이 시스템 1→2 전환 유발 → 낙관적 업데이트로 마찰 제거.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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

// ── 엔진 ON/OFF 토글 (Optimistic UI + 롤백) ─────────────────────
export function useToggleEngineMutation() {
  const qc = useQueryClient();
  return useMutation<
    EngineToggleResponse,
    Error,
    void,
    { previous: EngineStatus | undefined }
  >({
    mutationFn: () => autoTradeApi.toggleEngine(),

    // ── Optimistic: 클릭 즉시 cache 에 running 반전 반영 ─────────
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
      const previous = qc.getQueryData<EngineStatus>(AUTO_TRADE_KEYS.engineStatus);
      if (previous) {
        qc.setQueryData<EngineStatus>(AUTO_TRADE_KEYS.engineStatus, {
          ...previous,
          running: !previous.running,
        });
      }
      return { previous };
    },

    // ── 성공: 서버 응답을 최종 진실로 반영 ─────────────────────
    onSuccess: (data) => {
      qc.setQueryData<EngineStatus | undefined>(
        AUTO_TRADE_KEYS.engineStatus,
        (prev) => (prev ? { ...prev, running: data.running, emergencyStop: data.emergencyStop } : prev),
      );
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
    },

    // ── 실패: 낙관적 변경 롤백 + 에러 토스트 ──────────────────
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(AUTO_TRADE_KEYS.engineStatus, ctx.previous);
      }
      toast.error('엔진 토글 실패', { description: err.message });
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
    },
  });
}

/**
 * 사용자 이벤트 핸들러에서 호출할 수 있는 편의 함수 —
 * `toggleMut.mutateAsync()` 를 `toast.promise()` 로 감싸 라이프사이클 표시.
 *
 * 사용 예:
 *   const toggle = useToggleEngineMutation();
 *   const handle = () => toggleEngineWithToast(toggle.mutateAsync, { nextRunning: true });
 */
export function toggleEngineWithToast(
  fire: () => Promise<EngineToggleResponse>,
  meta: { nextRunning: boolean },
): Promise<EngineToggleResponse> {
  const actionLabel = meta.nextRunning ? '엔진 가동' : '엔진 정지';
  return toast.promise(fire(), {
    loading: `${actionLabel} 요청 전송 중…`,
    success: (data) =>
      data.running ? '엔진 가동 완료 — 실매매 모니터링 시작' : '엔진 정지 완료',
    error: (err: Error) => `${actionLabel} 실패: ${err.message}`,
  }).unwrap();
}

// ── 비상 정지 (강제 단방향) ─────────────────────────────────────
export function useEmergencyStopMutation() {
  const qc = useQueryClient();
  return useMutation<EngineToggleResponse, Error, void>({
    mutationFn: () => autoTradeApi.emergencyStop(),
    onSuccess: (data) => {
      qc.setQueryData<EngineStatus | undefined>(
        AUTO_TRADE_KEYS.engineStatus,
        (prev) => prev ? { ...prev, running: data.running, emergencyStop: true } : prev,
      );
      void qc.invalidateQueries({ queryKey: AUTO_TRADE_KEYS.engineStatus });
      toast.success('비상정지 발동', { description: '엔진이 즉시 정지되었습니다.' });
    },
    onError: (err) => {
      toast.error('비상정지 실패', { description: err.message });
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
      toast.success('Reconciliation 완료', {
        description: data.integrityOk
          ? '데이터 정합성 확인됨'
          : `불일치 ${data.mismatchCount}건 감지`,
      });
    },
    onError: (err) => {
      toast.error('Reconciliation 실패', { description: err.message });
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
