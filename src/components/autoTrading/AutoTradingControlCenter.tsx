/**
 * AutoTradingControlCenter — 자동매매 상단 컨트롤 섹션.
 *
 * Phase 2: 실매매(LIVE) 모드에서 "시동" 버튼을 누르면 `onArmLive` 를 호출한다.
 *          (부모가 `EngineToggleGate` 를 열어 3단계 확인을 요구.)
 *          SHADOW/PAPER 모드에서는 1-클릭 즉시 토글.
 *          "일시정지"·"비상정지" 는 1-클릭 유지 (정지는 빠를수록 안전).
 *
 * Step 4 (디자인 일관성): 반복되는 정보 타일을 `InfoTile` 헬퍼로 추출하고,
 *                        LIVE 경고 배너를 `Card tone="danger"` 로 통일.
 */

import React from 'react';
import {
  OctagonAlert, Pause, Play, RefreshCw, ShieldAlert, Wifi, WifiOff,
} from 'lucide-react';
import { Button } from '../../ui/button';
import { Card } from '../../ui/card';
import { InfoTile } from '../../ui/info-tile';
import { Section } from '../../ui/section';
import type { ControlCenterState } from '../../services/autoTrading/autoTradingTypes';
import { TradingModeBadge } from './TradingModeBadge';

interface AutoTradingControlCenterProps {
  state: ControlCenterState;
  engineToggling?: boolean;
  onPause: () => void;
  /** LIVE 모드에서만 호출됨 (Gate 열기). 부모가 SHADOW/PAPER 분기 처리. */
  onArmLive?: () => void;
  onResume: () => void;
  onRefresh: () => void;
  onEmergencyStop: () => void;
}

export function AutoTradingControlCenter({
  state,
  engineToggling = false,
  onPause,
  onArmLive,
  onResume,
  onRefresh,
  onEmergencyStop,
}: AutoTradingControlCenterProps) {
  const isRunning = state.engineStatus === 'RUNNING';
  const isLive = state.mode === 'LIVE';

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
              loading={engineToggling}
              loadingText="정지 중…"
            >
              일시정지
            </Button>
          ) : isLive && onArmLive ? (
            <Button
              variant="primary"
              size="sm"
              icon={<ShieldAlert className="h-4 w-4" />}
              onClick={onArmLive}
              disabled={engineToggling}
              loading={engineToggling}
              loadingText="전환 중…"
            >
              실매매 시동 (ARM)
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              icon={<Play className="h-4 w-4" />}
              onClick={onResume}
              loading={engineToggling}
              loadingText="가동 중…"
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
        {isLive && (
          <Card variant="ghost" tone="danger" padding="sm">
            <div className="flex items-center gap-2 font-semibold text-red-200">
              <ShieldAlert className="h-4 w-4" />
              실거래 모드 (LIVE)
            </div>
            <div className="mt-1 text-xs text-red-300/80">
              시동 시 3단계 안전 게이트(ARMED → 날짜 입력 → 실행)가 강제됩니다.
              주문 전 리스크 상태를 재확인하세요.
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
          <InfoTile label="모드" value={<TradingModeBadge mode={state.mode} />} />
          <InfoTile label="엔진 상태" value={<span className="font-semibold text-white">{state.engineStatus}</span>} />
          <InfoTile
            label="브로커 연결"
            value={<BrokerStatus connected={state.brokerConnected} />}
          />
          <InfoTile label="마지막 스캔" value={<span className="font-semibold text-white">{state.lastScanAt ?? '-'}</span>} />
          <InfoTile label="마지막 주문" value={<span className="font-semibold text-white">{state.lastOrderAt ?? '-'}</span>} />
          <InfoTile
            label="오늘 실현손익"
            value={
              <span className={state.todayPnL >= 0 ? 'font-semibold text-emerald-300' : 'font-semibold text-red-300'}>
                {state.todayPnL.toLocaleString()}원 ({state.todayOrderCount}건)
              </span>
            }
          />
        </div>
      </div>
    </Section>
  );
}

/* ---------- Local helpers ---------- */

function BrokerStatus({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-2 font-semibold text-white">
      {connected ? (
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
    </span>
  );
}
