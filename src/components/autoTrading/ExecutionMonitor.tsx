import React, { useMemo, useState } from 'react';
import { Section } from '../../ui/section';
import type { ExecutionOrder } from '../../services/autoTrading/autoTradingTypes';

interface ExecutionMonitorProps {
  orders: ExecutionOrder[];
}

export function ExecutionMonitor({ orders }: ExecutionMonitorProps) {
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);

  const filteredOrders = useMemo(() => {
    if (!showOnlyFailed) return orders;
    return orders.filter((order) => order.status === 'REJECTED' || order.status === 'BLOCKED');
  }, [orders, showOnlyFailed]);

  return (
    <Section
      title="주문 실행 모니터"
      subtitle="Execution Monitor"
      actions={
        <label className="flex items-center gap-2 text-xs text-white/70">
          <input
            type="checkbox"
            checked={showOnlyFailed}
            onChange={(e) => setShowOnlyFailed(e.target.checked)}
          />
          실패 주문만 보기
        </label>
      }
    >
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="min-w-full text-sm">
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th className="px-4 py-3 text-left">시각</th>
              <th className="px-4 py-3 text-left">종목</th>
              <th className="px-4 py-3 text-left">구분</th>
              <th className="px-4 py-3 text-right">수량</th>
              <th className="px-4 py-3 text-right">주문가</th>
              <th className="px-4 py-3 text-right">체결가</th>
              <th className="px-4 py-3 text-left">상태</th>
              <th className="px-4 py-3 text-left">메시지</th>
            </tr>
          </thead>
          <tbody>
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-white/50">
                  표시할 주문이 없습니다.
                </td>
              </tr>
            ) : (
              filteredOrders.map((order) => (
                <tr key={order.id} className="border-t border-white/10">
                  <td className="px-4 py-3 text-white/80">{order.createdAt}</td>
                  <td className="px-4 py-3 text-white">
                    {order.name} ({order.symbol})
                  </td>
                  <td className="px-4 py-3 text-white/80">{order.side}</td>
                  <td className="px-4 py-3 text-right text-white/80">{order.quantity}</td>
                  <td className="px-4 py-3 text-right text-white/80">
                    {order.orderPrice?.toLocaleString() ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-right text-white/80">
                    {order.filledPrice?.toLocaleString() ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-white/80">{order.status}</td>
                  <td className="px-4 py-3 text-red-300">{order.failureReason ?? '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
