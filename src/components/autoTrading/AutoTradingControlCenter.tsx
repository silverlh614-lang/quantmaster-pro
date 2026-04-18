import React from 'react';
import { Pause, Play, OctagonAlert } from 'lucide-react';
import { ControlCenterState } from '../../services/autoTrading/autoTradingTypes';
import { TradingModeBadge } from './TradingModeBadge';
import { Button } from '../../ui/button';
import { Section } from '../../ui/section';

interface Props {
  state: ControlCenterState;
  onPause: () => void;
  onResume: () => void;
  onEmergencyStop: () => void;
}

export function AutoTradingControlCenter({ state, onPause, onResume, onEmergencyStop }: Props) {
  const isRunning = state.engineStatus === 'RUNNING';

  return (
    <Section
      title="자동매매 컨트롤 센터"
      subtitle="Control Center"
      actions={
        <div className="flex gap-2">
          {isRunning ? (
            <Button onClick={onPause} icon={<Pause className="w-4 h-4" />} size="sm">
              일시정지
            </Button>
          ) : (
            <Button onClick={onResume} icon={<Play className="w-4 h-4" />} size="sm">
              재시작
            </Button>
          )}

          <Button variant="danger" onClick={onEmergencyStop} icon={<OctagonAlert className="w-4 h-4" />} size="sm">
            비상정지
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
          <div className="text-xs text-white/50">모드</div>
          <div className="mt-2"><TradingModeBadge mode={state.mode} /></div>
        </div>

        <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
          <div className="text-xs text-white/50">엔진 상태</div>
          <div className="mt-2 text-white">{state.engineStatus}</div>
        </div>

        <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
          <div className="text-xs text-white/50">주문 수</div>
          <div className="mt-2 text-white">{state.todayOrderCount}</div>
        </div>

        <div className="p-3 bg-white/5 border border-white/10 rounded-xl">
          <div className="text-xs text-white/50">손익</div>
          <div className="mt-2 text-white">{state.todayPnL}</div>
        </div>
      </div>
    </Section>
  );
}
