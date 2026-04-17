import React from 'react';
import { ArrowUpDown } from 'lucide-react';
import { Card } from '../../../ui/card';
import { Badge } from '../../../ui/badge';
import { fmtPrice } from '../../../utils/format';
import type { OcoOrdersResponse } from '../../../api';

interface Props { orders: OcoOrdersResponse; }

export function OcoOrdersCard({ orders }: Props) {
  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <ArrowUpDown className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-bold text-theme-text">OCO 주문 현황</span>
        {orders.active.length > 0 && (
          <Badge variant="warning" size="sm">{orders.active.length}건 활성</Badge>
        )}
      </div>
      <div className="space-y-2">
        {[...orders.active, ...orders.history.slice(0, 5)].map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3 py-2 border-b border-theme-border/20 last:border-0">
            <div className="min-w-0">
              <span className="text-sm font-bold text-theme-text truncate">{o.stockName}</span>
              <span className="text-micro ml-2">{o.stockCode}</span>
            </div>
            <div className="flex items-center gap-2 text-xs shrink-0">
              <span className="text-red-400 font-num">손절 {fmtPrice(o.stopPrice)}</span>
              <span className="text-theme-text-muted">/</span>
              <span className="text-green-400 font-num">목표 {fmtPrice(o.profitPrice)}</span>
              <Badge
                variant={o.status === 'ACTIVE' ? 'warning' : o.status === 'PROFIT_FILLED' ? 'success' : o.status === 'STOP_FILLED' ? 'danger' : 'default'}
                size="sm"
              >
                {o.status === 'ACTIVE' ? '대기중' : o.status === 'PROFIT_FILLED' ? '익절' : o.status === 'STOP_FILLED' ? '손절' : o.status === 'BOTH_CANCELLED' ? '취소' : o.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
