import React from 'react';
import { Lock, OctagonAlert, PauseCircle, ShieldBan } from 'lucide-react';
import type { EmergencyActionState } from '../../services/autoTrading/autoTradingTypes';
import { Section } from '../../ui/section';
import { Button } from '../../ui/button';

interface EmergencyActionsPanelProps {
  state: EmergencyActionState;
  onBlockNewBuy: () => void;
  onPauseAutoTrading: () => void;
  onManageOnly: () => void;
  onEmergencyLiquidation: () => void;
}

export function EmergencyActionsPanel({
  state,
  onBlockNewBuy,
  onPauseAutoTrading,
  onManageOnly,
  onEmergencyLiquidation,
}: EmergencyActionsPanelProps) {
  return (
    <Section title="비상 액션 패널" subtitle="Emergency Actions Panel">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatusPill label="신규 매수 차단" active={state.newBuyBlocked} />
          <StatusPill label="자동매매 일시정지" active={state.autoTradingPaused} />
          <StatusPill label="보유 포지션만 관리" active={state.positionManageOnly} />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Button
            variant="secondary"
            size="md"
            icon={<ShieldBan className="h-4 w-4" />}
            onClick={onBlockNewBuy}
          >
            신규 매수 차단
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<PauseCircle className="h-4 w-4" />}
            onClick={onPauseAutoTrading}
          >
            자동매매 일시정지
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<Lock className="h-4 w-4" />}
            onClick={onManageOnly}
          >
            보유만 관리
          </Button>

          <Button
            variant="danger"
            size="md"
            icon={<OctagonAlert className="h-4 w-4" />}
            onClick={onEmergencyLiquidation}
          >
            비상 청산
          </Button>
        </div>

        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          비상 액션은 반드시 확인 모달과 2단계 검증을 거친 뒤 실행되도록 연결하는 것이 좋습니다.
        </div>
      </div>
    </Section>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-white/50">{label}</div>
      <div
        className={`mt-2 inline-flex rounded-full border px-3 py-1 text-xs font-medium ${
          active
            ? 'border-red-500/30 bg-red-500/15 text-red-300'
            : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
        }`}
      >
        {active ? '활성' : '비활성'}
      </div>
    </div>
  );
}
