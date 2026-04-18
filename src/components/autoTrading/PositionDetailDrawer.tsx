import React from 'react';
import { X } from 'lucide-react';
import type { PositionItem } from '../../services/autoTrading/autoTradingTypes';

interface PositionDetailDrawerProps {
  position: PositionItem | null;
  open: boolean;
  onClose: () => void;
}

export function PositionDetailDrawer({ position, open, onClose }: PositionDetailDrawerProps) {
  if (!open || !position) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60">
      <div className="absolute inset-y-0 right-0 h-full w-full max-w-xl border-l border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-lg font-semibold text-white">포지션 상세</div>
            <div className="text-sm text-white/50">
              {position.name} ({position.symbol})
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-2 text-white/60 transition hover:bg-white/5 hover:text-white"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="h-[calc(100%-72px)] space-y-4 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <InfoCard label="진입 시각" value={position.enteredAt} />
            <InfoCard label="상태" value={position.status} />
            <InfoCard label="평균단가" value={`${position.avgPrice.toLocaleString()}원`} />
            <InfoCard label="현재가" value={`${position.currentPrice.toLocaleString()}원`} />
            <InfoCard label="수량" value={String(position.quantity)} />
            <InfoCard label="수익률" value={`${position.pnlPct.toFixed(2)}%`} />
            <InfoCard
              label="손절가"
              value={position.stopLossPrice ? `${position.stopLossPrice.toLocaleString()}원` : '-'}
            />
            <InfoCard
              label="1차 목표가"
              value={position.targetPrice1 ? `${position.targetPrice1.toLocaleString()}원` : '-'}
            />
            <InfoCard
              label="2차 목표가"
              value={position.targetPrice2 ? `${position.targetPrice2.toLocaleString()}원` : '-'}
            />
            <InfoCard
              label="트레일링 스탑"
              value={position.trailingStopEnabled ? '활성' : '비활성'}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">진입 근거</div>
            <div className="mt-2 text-sm text-white/80">{position.entryReason}</div>
          </div>

          {position.warningMessage && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="text-xs text-amber-200/70">경고</div>
              <div className="mt-2 text-sm text-amber-200">{position.warningMessage}</div>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">추후 연결 권장 영역</div>
            <div className="mt-2 text-sm text-white/70">
              여기에는 수급 변화, Gate 재평가 결과, 적의 체크리스트, 자동매도 예정 사유, 최근 포지션 변경 로그를 연결하는 것이 좋습니다.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="text-xs text-white/50">{label}</div>
      <div className="mt-1 break-all text-sm text-white">{value}</div>
    </div>
  );
}
