import React from 'react';
import { X } from 'lucide-react';
import type { PositionItem } from '../../services/autoTrading/autoTradingTypes';
import { InfoTile } from '../../ui/info-tile';

interface PositionDetailDrawerProps {
  position: PositionItem | null;
  open: boolean;
  onClose: () => void;
}

export function PositionDetailDrawer({ position, open, onClose }: PositionDetailDrawerProps) {
  if (!open || !position) return null;

  const pnlTone =
    position.pnlPct > 0 ? 'success' : position.pnlPct < 0 ? 'danger' : 'neutral';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="position-drawer-title"
      className="fixed inset-0 z-50 bg-black/60"
    >
      <div className="absolute inset-y-0 right-0 h-full w-full max-w-xl border-l border-white/10 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div id="position-drawer-title" className="text-lg font-semibold text-white">
              포지션 상세
            </div>
            <div className="text-sm text-white/50">
              {position.name} ({position.symbol})
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

        <div className="h-[calc(100%-72px)] space-y-4 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-2 gap-3">
            <InfoTile label="진입 시각" value={position.enteredAt} />
            <InfoTile label="상태" value={position.status} />
            <InfoTile label="평균단가" value={`${position.avgPrice.toLocaleString()}원`} />
            <InfoTile label="현재가" value={`${position.currentPrice.toLocaleString()}원`} />
            <InfoTile label="수량" value={String(position.quantity)} />
            <InfoTile
              label="수익률"
              tone={pnlTone}
              value={`${position.pnlPct.toFixed(2)}%`}
            />
            <InfoTile
              label="손절가"
              value={position.stopLossPrice ? `${position.stopLossPrice.toLocaleString()}원` : '-'}
            />
            <InfoTile
              label="1차 목표가"
              value={position.targetPrice1 ? `${position.targetPrice1.toLocaleString()}원` : '-'}
            />
            <InfoTile
              label="2차 목표가"
              value={position.targetPrice2 ? `${position.targetPrice2.toLocaleString()}원` : '-'}
            />
            <InfoTile
              label="트레일링 스탑"
              value={position.trailingStopEnabled ? '활성' : '비활성'}
              tone={position.trailingStopEnabled ? 'success' : 'neutral'}
            />
          </div>

          <InfoTile label="진입 근거" value={position.entryReason} />

          {position.warningMessage && (
            <InfoTile
              label="경고"
              value={position.warningMessage}
              tone="warning"
            />
          )}

          <InfoTile
            label="추후 연결 권장 영역"
            value="여기에는 수급 변화, Gate 재평가 결과, 적의 체크리스트, 자동매도 예정 사유, 최근 포지션 변경 로그를 연결하는 것이 좋습니다."
          />
        </div>
      </div>
    </div>
  );
}
