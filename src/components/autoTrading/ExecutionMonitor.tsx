// @responsibility autoTrading 영역 ExecutionMonitor 컴포넌트
import React, { useMemo, useState } from 'react';
import { Section } from '../../ui/section';
import { DataTable, type DataTableColumn } from '../../ui/data-table';
import { Badge } from '../../ui/badge';
import type { ExecutionOrder } from '../../services/autoTrading/autoTradingTypes';

interface ExecutionMonitorProps {
  orders: ExecutionOrder[];
}

function statusToBadgeVariant(status: ExecutionOrder['status']) {
  switch (status) {
    case 'FILLED':
    case 'PARTIAL_FILLED':
      return 'success' as const;
    case 'REJECTED':
    case 'BLOCKED':
    case 'CANCELLED':
      return 'danger' as const;
    case 'SENT':
    case 'QUEUED':
      return 'info' as const;
    default:
      return 'default' as const;
  }
}

export function ExecutionMonitor({ orders }: ExecutionMonitorProps) {
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);

  const filteredOrders = useMemo(() => {
    if (!showOnlyFailed) return orders;
    return orders.filter((order) => order.status === 'REJECTED' || order.status === 'BLOCKED');
  }, [orders, showOnlyFailed]);

  const columns = useMemo<DataTableColumn<ExecutionOrder>[]>(
    () => [
      {
        key: 'createdAt',
        header: '시각',
        sortKey: (o) => o.createdAt,
        accessor: (o) => o.createdAt,
      },
      {
        key: 'symbol',
        header: '종목',
        sortKey: (o) => o.symbol,
        accessor: (o) => (
          <span className="text-theme-text">
            {o.name} <span className="text-theme-text-muted">({o.symbol})</span>
          </span>
        ),
      },
      {
        key: 'side',
        header: '구분',
        sortKey: (o) => o.side,
        accessor: (o) => o.side,
      },
      {
        key: 'quantity',
        header: '수량',
        align: 'right',
        sortKey: (o) => o.quantity,
      },
      {
        key: 'orderPrice',
        header: '주문가',
        align: 'right',
        sortKey: (o) => o.orderPrice ?? -1,
        accessor: (o) => o.orderPrice?.toLocaleString() ?? '-',
      },
      {
        key: 'filledPrice',
        header: '체결가',
        align: 'right',
        sortKey: (o) => o.filledPrice ?? -1,
        accessor: (o) => o.filledPrice?.toLocaleString() ?? '-',
      },
      {
        key: 'status',
        header: '상태',
        sortKey: (o) => o.status,
        accessor: (o) => (
          <Badge variant={statusToBadgeVariant(o.status)} size="sm">
            {o.status}
          </Badge>
        ),
      },
      {
        key: 'failureReason',
        header: '메시지',
        accessor: (o) => (
          <span className="text-red-300">{o.failureReason ?? '-'}</span>
        ),
      },
    ],
    [],
  );

  return (
    <Section
      title="주문 실행 모니터"
      subtitle="Execution Monitor"
      actions={
        <label className="flex items-center gap-2 text-xs text-theme-text-secondary">
          <input
            type="checkbox"
            checked={showOnlyFailed}
            onChange={(e) => setShowOnlyFailed(e.target.checked)}
            className="accent-orange-500"
          />
          실패 주문만 보기
        </label>
      }
    >
      <DataTable
        columns={columns}
        data={filteredOrders}
        rowKey={(o) => o.id}
        emptyMessage={
          showOnlyFailed ? '표시할 실패 주문이 없습니다.' : '표시할 주문이 없습니다.'
        }
        caption="주문 실행 이력"
      />
    </Section>
  );
}
