import React, { useCallback, useMemo } from 'react';
import { Check, Inbox, ShieldBan } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Section } from '../../ui/section';
import { EmptyState } from '../../ui/empty-state';
import { DataTable, type DataTableColumn } from '../../ui/data-table';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { autoTradeApi, type PendingApprovalsResponse } from '../../api';
import type { SignalItem } from '../../services/autoTrading/autoTradingTypes';

interface SignalQueuePanelProps {
  signals: SignalItem[];
}

function gradeToBadgeVariant(grade: SignalItem['grade']) {
  switch (grade) {
    case 'STRONG_BUY':
      return 'success' as const;
    case 'BUY':
      return 'info' as const;
    default:
      return 'default' as const;
  }
}

const PENDING_QUERY_KEY = ['auto-trade', 'pending-approvals'] as const;

export function SignalQueuePanel({ signals }: SignalQueuePanelProps) {
  const qc = useQueryClient();

  // 서버측 대기 승인 목록 — 15초 주기로 폴링. UI 버튼 활성 여부 계산에 사용.
  const pendingQuery = useQuery<PendingApprovalsResponse>({
    queryKey: PENDING_QUERY_KEY,
    queryFn: () => autoTradeApi.getPendingApprovals(),
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
    retry: 1,
  });

  const pendingIds = useMemo(
    () => new Set((pendingQuery.data?.entries ?? []).map((e) => e.tradeId)),
    [pendingQuery.data],
  );

  const approveMut = useMutation({
    mutationFn: (tradeId: string) => autoTradeApi.approveSignal(tradeId),
    onSuccess: () => {
      toast.success('승인 처리됨');
      void qc.invalidateQueries({ queryKey: PENDING_QUERY_KEY });
    },
    onError: (err: Error) => {
      toast.error('승인 실패', { description: err.message });
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ tradeId, reason }: { tradeId: string; reason: string }) =>
      autoTradeApi.rejectSignal(tradeId, reason),
    onSuccess: () => {
      toast.success('차단 처리됨 (실패 패턴 기록)');
      void qc.invalidateQueries({ queryKey: PENDING_QUERY_KEY });
    },
    onError: (err: Error) => {
      toast.error('차단 실패', { description: err.message });
    },
  });

  const handleApprove = useCallback((tradeId: string) => {
    approveMut.mutate(tradeId);
  }, [approveMut]);

  const handleReject = useCallback((tradeId: string) => {
    // window.prompt 는 간소한 UX 로 충분 — 사유 미입력 시 요청 중단.
    const reason = typeof window !== 'undefined' ? window.prompt('차단 사유를 입력하세요 (실패 패턴 DB에 기록됩니다)') : null;
    if (!reason || !reason.trim()) return;
    rejectMut.mutate({ tradeId, reason: reason.trim() });
  }, [rejectMut]);

  const columns = useMemo<DataTableColumn<SignalItem>[]>(
    () => [
      {
        key: 'createdAt',
        header: '시각',
        sortKey: (s) => s.createdAt,
        accessor: (s) => <span className="text-theme-text-secondary">{s.createdAt}</span>,
      },
      {
        key: 'symbol',
        header: '종목',
        sortKey: (s) => s.symbol,
        accessor: (s) => (
          <span className="text-theme-text">
            {s.name} <span className="text-theme-text-muted">({s.symbol})</span>
          </span>
        ),
      },
      {
        key: 'grade',
        header: '등급',
        sortKey: (s) => s.grade,
        accessor: (s) => (
          <Badge variant={gradeToBadgeVariant(s.grade)} size="sm">
            {s.grade}
          </Badge>
        ),
      },
      {
        key: 'gate1',
        header: 'Gate1',
        align: 'center',
        sortKey: (s) => s.gate1Passed,
        accessor: (s) => s.gate1Passed,
      },
      {
        key: 'gate2',
        header: 'Gate2',
        align: 'center',
        sortKey: (s) => s.gate2Passed,
        accessor: (s) => s.gate2Passed,
      },
      {
        key: 'gate3',
        header: 'Gate3',
        align: 'center',
        sortKey: (s) => s.gate3Passed,
        accessor: (s) => s.gate3Passed,
      },
      {
        key: 'rrr',
        header: 'RRR',
        align: 'right',
        sortKey: (s) => s.rrr ?? -1,
        accessor: (s) => s.rrr?.toFixed(2) ?? '-',
      },
      {
        key: 'status',
        header: '상태',
        sortKey: (s) => s.status,
        accessor: (s) => s.status,
      },
      {
        key: 'blockedReason',
        header: '차단 사유',
        accessor: (s) => (
          <span className="text-amber-300">{s.blockedReason ?? '-'}</span>
        ),
      },
      {
        key: 'actions',
        header: '액션',
        align: 'center',
        accessor: (s) => {
          const isPending = pendingIds.has(s.id);
          if (!isPending) {
            return <span className="text-theme-text-muted text-xs">–</span>;
          }
          const approveBusy = approveMut.isPending && approveMut.variables === s.id;
          const rejectBusy = rejectMut.isPending && rejectMut.variables?.tradeId === s.id;
          return (
            <div className="flex items-center justify-center gap-1.5">
              <Button
                size="sm"
                variant="accent"
                icon={<Check className="h-3.5 w-3.5" />}
                loading={approveBusy}
                onClick={() => handleApprove(s.id)}
                aria-label="승인"
              >
                승인
              </Button>
              <Button
                size="sm"
                variant="danger"
                icon={<ShieldBan className="h-3.5 w-3.5" />}
                loading={rejectBusy}
                onClick={() => handleReject(s.id)}
                aria-label="차단"
              >
                차단
              </Button>
            </div>
          );
        },
      },
    ],
    [pendingIds, approveMut, rejectMut, handleApprove, handleReject],
  );

  const pendingCount = pendingQuery.data?.entries.length ?? 0;

  return (
    <Section
      title="진입 신호 집행 대기열"
      subtitle={
        pendingCount > 0
          ? `대기 승인 ${pendingCount}건 — UI 또는 텔레그램에서 처리`
          : 'Entry Signal Execution Queue'
      }
    >
      {signals.length === 0 ? (
        <EmptyState
          variant="minimal"
          icon={<Inbox className="h-6 w-6" />}
          title="현재 신호가 없습니다"
          description="Gate 통과 신호가 포착되면 이곳에 등급·RRR·상태와 함께 대기열로 표시됩니다."
        />
      ) : (
        <DataTable
          columns={columns}
          data={signals}
          rowKey={(s) => s.id}
          caption="진입 신호 대기열"
        />
      )}
    </Section>
  );
}
