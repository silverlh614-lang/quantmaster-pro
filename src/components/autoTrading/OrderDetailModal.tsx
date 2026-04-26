// @responsibility autoTrading 영역 OrderDetailModal 컴포넌트
import React from 'react';
import { X } from 'lucide-react';
import type { ExecutionOrder } from '../../services/autoTrading/autoTradingTypes';
import { Button } from '../../ui/button';
import { InfoTile } from '../../ui/info-tile';

interface OrderDetailModalProps {
  order: ExecutionOrder | null;
  open: boolean;
  onClose: () => void;
}

export function OrderDetailModal({ order, open, onClose }: OrderDetailModalProps) {
  if (!open || !order) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div id="order-modal-title" className="text-lg font-semibold text-white">
              주문 상세
            </div>
            <div className="text-sm text-white/50">
              {order.name} ({order.symbol})
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/60 transition hover:bg-white/5 hover:text-white"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <InfoTile label="주문 ID" value={<span className="break-all text-white">{order.id}</span>} />
            <InfoTile label="구분" value={order.side} />
            <InfoTile label="상태" value={order.status} />
            <InfoTile label="수량" value={String(order.quantity)} />
            <InfoTile
              label="주문가"
              value={order.orderPrice ? `${order.orderPrice.toLocaleString()}원` : '-'}
            />
            <InfoTile
              label="체결가"
              value={order.filledPrice ? `${order.filledPrice.toLocaleString()}원` : '-'}
            />
            <InfoTile label="주문 시각" value={order.createdAt} />
            <InfoTile label="갱신 시각" value={order.updatedAt ?? '-'} />
            <InfoTile
              label="브로커 응답속도"
              value={order.brokerLatencyMs ? `${order.brokerLatencyMs}ms` : '-'}
            />
          </div>

          <InfoTile
            label="실패 사유"
            value={order.failureReason ?? '없음'}
            tone={order.failureReason ? 'danger' : 'neutral'}
          />

          <InfoTile
            label="주문 해석 메모"
            value="추후 이 영역에 Gate 통과 근거, RRR, 촉매제, 리스크 차단 여부, 브로커 원문 응답을 연결하면 됩니다."
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}
