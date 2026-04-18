import React from 'react';
import { OctagonAlert, Pause, Play, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Button } from '../../ui/button';
import { Section } from '../../ui/section';
import type { ControlCenterState } from '../../services/autoTrading/autoTradingTypes';
import { TradingModeBadge } from './TradingModeBadge';

interface AutoTradingControlCenterProps {
  state: ControlCenterState;
  onPause: () => void;
  onResume: () => void;
  onRefresh: () => void;
  onEmergencyStop: () => void;
}

export function AutoTradingControlCenter({
  state,
  onPause,
  onResume,
  onRefresh,
  onEmergencyStop,
}: AutoTradingControlCenterProps) {
  const isRunning = state.engineStatus === 'RUNNING';

  return (
    <Section
      title="자동매매 컨트롤 센터"
      subtitle="Auto Trading Control Center"
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={onRefresh}
          >
            새로고침
          </Button>

          {isRunning ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Pause className="h-4 w-4" />}
              onClick={onPause}
            >
              일시정지
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={<Play className="h-4 w-4" />}
              onClick={onResume}
            >
              재시작
            </Button>
          )}

          <Button
            variant="danger"
            size="sm"
            icon={<OctagonAlert className="h-4 w-4" />}
            onClick={onEmergencyStop}
          >
            비상정지
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {state.mode === 'LIVE' && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            실거래 모드가 활성화되어 있습니다. 주문 전 리스크 상태를 다시 확인하세요.
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">모드</div>
            <div className="mt-2">
              <TradingModeBadge mode={state.mode} />
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">엔진 상태</div>
            <div className="mt-2 text-sm font-semibold text-white">{state.engineStatus}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">브로커 연결</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
              {state.brokerConnected ? (
                <>
                  <Wifi className="h-4 w-4 text-emerald-400" />
                  CONNECTED
                </>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-red-400" />
                  DISCONNECTED
                </>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">마지막 스캔</div>
            <div className="mt-2 text-sm font-semibold text-white">{state.lastScanAt ?? '-'}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">마지막 주문</div>
            <div className="mt-2 text-sm font-semibold text-white">{state.lastOrderAt ?? '-'}</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-white/50">오늘 실현손익</div>
            <div
              className={`mt-2 text-sm font-semibold ${
                state.todayPnL >= 0 ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {state.todayPnL.toLocaleString()}원 ({state.todayOrderCount}건)
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
