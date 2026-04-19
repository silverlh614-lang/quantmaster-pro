import React, { useMemo } from 'react';
import { Inbox } from 'lucide-react';
import { Section } from '../../ui/section';
import { EmptyState } from '../../ui/empty-state';
import { DataTable, type DataTableColumn } from '../../ui/data-table';
import { Badge } from '../../ui/badge';
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

export function SignalQueuePanel({ signals }: SignalQueuePanelProps) {
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
    ],
    [],
  );

  return (
    <Section title="진입 신호 집행 대기열" subtitle="Entry Signal Execution Queue">
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
