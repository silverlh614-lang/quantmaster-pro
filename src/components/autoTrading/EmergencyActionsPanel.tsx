import React from 'react';
import { Lock, OctagonAlert, PauseCircle, ShieldBan } from 'lucide-react';
import type { EmergencyActionState } from '../../services/autoTrading/autoTradingTypes';
import { Section } from '../../ui/section';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { InfoTile } from '../../ui/info-tile';
import { Badge } from '../../ui/badge';
import { useEngineGuards } from '../../hooks/autoTrade/useEngineGuards';

interface EmergencyActionsPanelProps {
  /** 파생 상태(VIX/FOMC 기반) — 서버 가드 상태와 병합하여 "현재 활성" 여부를 판단. */
  state: EmergencyActionState;
  onEmergencyLiquidation: () => void;
}

export function EmergencyActionsPanel({
  state,
  onEmergencyLiquidation,
}: EmergencyActionsPanelProps) {
  const {
    guards,
    toggleBlockNewBuy,
    togglePauseAutoTrading,
    toggleManageOnly,
  } = useEngineGuards();

  // 활성 판단: UI 수동 가드(server guards) OR 시장 상태 기반 자동 차단(state).
  const newBuyBlocked = guards.blockNewBuy || state.newBuyBlocked;
  const autoTradingPaused = guards.autoTradingPaused || state.autoTradingPaused;
  const manageOnly = guards.manageOnly || state.positionManageOnly;

  return (
    <Section title="비상 대응 프로토콜" subtitle="Emergency Response Protocol">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <StatusPill label="신규 매수 차단" active={newBuyBlocked} />
          <StatusPill label="자동매매 일시정지" active={autoTradingPaused} />
          <StatusPill label="보유 포지션만 관리" active={manageOnly} />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Button
            variant={guards.blockNewBuy ? 'danger' : 'secondary'}
            size="md"
            icon={<ShieldBan className="h-4 w-4" />}
            onClick={toggleBlockNewBuy}
          >
            {guards.blockNewBuy ? '신규 매수 차단 해제' : '신규 매수 차단'}
          </Button>

          <Button
            variant={guards.autoTradingPaused ? 'danger' : 'secondary'}
            size="md"
            icon={<PauseCircle className="h-4 w-4" />}
            onClick={togglePauseAutoTrading}
          >
            {guards.autoTradingPaused ? '자동매매 재개' : '자동매매 일시정지'}
          </Button>

          <Button
            variant={guards.manageOnly ? 'danger' : 'secondary'}
            size="md"
            icon={<Lock className="h-4 w-4" />}
            onClick={toggleManageOnly}
          >
            {guards.manageOnly ? '보유만 관리 해제' : '보유만 관리'}
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

        <Card variant="ghost" tone="danger" padding="sm" className="text-sm text-red-200">
          비상 액션은 반드시 확인 모달과 2단계 검증을 거친 뒤 실행되도록 연결하는 것이 좋습니다.
        </Card>
      </div>
    </Section>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <InfoTile
      label={label}
      tone={active ? 'danger' : 'success'}
      value={
        <Badge variant={active ? 'danger' : 'success'} size="md">
          {active ? '활성' : '비활성'}
        </Badge>
      }
    />
  );
}
