// @responsibility autoTrading 영역 ProDiagnosticsStrip 컴포넌트
/**
 * ProDiagnosticsStrip — 프로 모드 전용 고밀도 진단 스트립.
 *
 * 전문가가 관제실에 앉았을 때 "한 줄로 현장 상황"을 읽어낼 수 있게
 * 주요 지표를 터미널 스타일 mono-font 로 나열한다.
 *
 *   MODE · ENGINE · BROKER · SIGNALS · RISK · ORDERS
 *
 * 간단 모드와의 시각적 구분을 명확히 해 프로 모드가 단순히 "탭 2개 더"
 * 가 아니라 전용 관제 화면이라는 정체성을 전달한다.
 */
import React from 'react';
import { cn } from '../../ui/cn';
import type { AutoTradingDashboardState } from '../../services/autoTrading/autoTradingTypes';

interface ProDiagnosticsStripProps {
  data: AutoTradingDashboardState;
  isRunning: boolean;
  killSwitchActive: boolean;
}

interface Segment {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'fail' | 'neutral';
}

const TONE_STYLES: Record<Segment['tone'], string> = {
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  fail: 'text-rose-300',
  neutral: 'text-theme-text-secondary',
};

export function ProDiagnosticsStrip({
  data,
  isRunning,
  killSwitchActive,
}: ProDiagnosticsStripProps) {
  const segments = buildSegments(data, isRunning, killSwitchActive);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-amber-500/[0.15] bg-gradient-to-r from-amber-500/[0.04] via-orange-500/[0.03] to-transparent px-4 py-2.5"
      aria-label="프로 모드 진단 스트립"
    >
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400/70 via-orange-500/60 to-rose-500/50" />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 pl-2 font-mono text-[11px] tracking-tight">
        <span className="text-[9px] font-black uppercase tracking-[0.25em] text-amber-300/90">
          PRO · LIVE CONSOLE
        </span>
        <span className="hidden sm:inline h-3 w-px bg-white/10" />
        {segments.map((seg, i) => (
          <React.Fragment key={seg.label}>
            {i > 0 && <span className="hidden sm:inline text-white/10">·</span>}
            <span className="inline-flex items-center gap-1">
              <span className="text-[9px] uppercase tracking-wider text-theme-text-muted">
                {seg.label}
              </span>
              <span className={cn('font-bold', TONE_STYLES[seg.tone])}>
                {seg.value}
              </span>
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function buildSegments(
  data: AutoTradingDashboardState,
  isRunning: boolean,
  killSwitchActive: boolean,
): Segment[] {
  const engineTone: Segment['tone'] = killSwitchActive
    ? 'fail'
    : isRunning
      ? 'ok'
      : 'warn';
  const engineValue = killSwitchActive
    ? 'KILL'
    : isRunning
      ? 'RUN'
      : 'IDLE';

  const brokerTone: Segment['tone'] = data.broker.connected
    ? data.broker.orderAvailable
      ? 'ok'
      : 'warn'
    : 'fail';
  const brokerValue = data.broker.connected
    ? data.broker.orderAvailable
      ? 'LINK·ORDER'
      : 'LINK·RO'
    : 'OFFLINE';

  const pendingSignals = data.signals.filter(
    (s) => s.status === 'DETECTED' || s.status === 'QUEUED',
  ).length;
  const signalsTone: Segment['tone'] =
    pendingSignals === 0 ? 'neutral' : pendingSignals <= 2 ? 'ok' : 'warn';

  const triggeredRisk = data.riskRules.filter((r) => r.triggered).length;
  const riskTone: Segment['tone'] =
    triggeredRisk === 0 ? 'ok' : triggeredRisk <= 1 ? 'warn' : 'fail';

  const orders = data.orders.length;
  const filled = data.orders.filter(
    (o) => o.status === 'FILLED' || o.status === 'PARTIAL_FILLED',
  ).length;
  const fillRate = orders > 0 ? Math.round((filled / orders) * 100) : 0;
  const fillTone: Segment['tone'] =
    orders === 0 ? 'neutral' : fillRate >= 80 ? 'ok' : fillRate >= 50 ? 'warn' : 'fail';

  return [
    { label: 'MODE', value: data.control.mode, tone: 'neutral' },
    { label: 'ENGINE', value: engineValue, tone: engineTone },
    { label: 'BROKER', value: brokerValue, tone: brokerTone },
    {
      label: 'SIGNALS',
      value: `${pendingSignals}/${data.signals.length}`,
      tone: signalsTone,
    },
    {
      label: 'RISK',
      value: `${triggeredRisk}/${data.riskRules.length}`,
      tone: riskTone,
    },
    {
      label: 'ORDERS',
      value: orders > 0 ? `${filled}/${orders} · ${fillRate}%` : '0/0',
      tone: fillTone,
    },
  ];
}
