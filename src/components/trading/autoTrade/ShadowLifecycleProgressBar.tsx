/**
 * @responsibility Shadow Lifecycle Progress Bar — 6단계 흐름 health (UI_WIRING_MATRIX §10 #2B Phase F)
 *
 * 사용자 디자인 스펙(Genius#2):
 *   BUY_SIGNAL → PAPER_FILLED → POSITION_OPENED → SELL_SIGNAL → CLOSED → OUTCOME_RECORDED
 *   각 단계가 최근 24시간 기준 정상인지 표시.
 *
 * 핵심 의도:
 *   - Shadow 가 LIVE 와 같은 생애주기를 실행해야 LIVE 전환 안전성이 확보된다(불변식 #2).
 *   - 특정 단계가 0 건이면 stall 일 가능성 — 사용자가 "Shadow 가 살아 있다" 를 한눈에 확인.
 *
 * 데이터:
 *   - `serverShadowTrades` (이미 useAutoTradeEngine 가 받아오는 값). 새 서버 호출 0건.
 *   - 단계별 카운트는 trade 의 timestamp/status/fills 에서 derived. 매매로직·서버 무관.
 */
import React from 'react';
import { Activity, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { ServerShadowTrade } from '../../../api';

export interface ShadowLifecycleProgressBarProps {
  shadowTrades: ServerShadowTrade[] | null | undefined;
  /** 집계 윈도우(시간) — default 24h. */
  windowHours?: number;
}

interface StageCount {
  code: 'BUY_SIGNAL' | 'PAPER_FILLED' | 'POSITION_OPENED' | 'SELL_SIGNAL' | 'CLOSED' | 'OUTCOME_RECORDED';
  label: string;
  count: number;
}

const TERMINAL_STATES = new Set(['HIT_TARGET', 'HIT_STOP']);

function tsToMillis(ts: string | number | undefined | null): number | null {
  if (ts == null) return null;
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
}

function inWindow(ts: string | number | undefined | null, cutoff: number): boolean {
  const t = tsToMillis(ts);
  return t != null && t >= cutoff;
}

export function aggregateLifecycleStages(
  trades: ServerShadowTrade[] | null | undefined,
  windowMs: number,
): StageCount[] {
  const cutoff = Date.now() - windowMs;
  const safe = trades ?? [];

  let buySignal = 0;
  let paperFilled = 0;
  let positionOpened = 0;
  let sellSignal = 0;
  let closed = 0;
  let outcome = 0;

  for (const t of safe) {
    if (inWindow(t.signalTime, cutoff)) buySignal += 1;

    const buyFill = (t.fills ?? []).find((f) => f.type === 'BUY' && inWindow(f.timestamp, cutoff));
    if (buyFill) {
      paperFilled += 1;
      // 신호 윈도우 안에서 BUY 체결까지 도달했다면 position-open 카운트
      positionOpened += 1;
    }

    const sellFill = (t.fills ?? []).find((f) => f.type === 'SELL' && inWindow(f.timestamp, cutoff));
    if (sellFill) sellSignal += 1;

    if (TERMINAL_STATES.has(t.status) && inWindow(t.exitTime, cutoff)) {
      closed += 1;
    }
    if (inWindow(t.resolvedAt, cutoff) || (TERMINAL_STATES.has(t.status) && typeof t.returnPct === 'number' && inWindow(t.exitTime, cutoff))) {
      outcome += 1;
    }
  }

  return [
    { code: 'BUY_SIGNAL', label: '매수 신호', count: buySignal },
    { code: 'PAPER_FILLED', label: '가상 체결', count: paperFilled },
    { code: 'POSITION_OPENED', label: '포지션 오픈', count: positionOpened },
    { code: 'SELL_SIGNAL', label: '매도 신호', count: sellSignal },
    { code: 'CLOSED', label: '청산 완료', count: closed },
    { code: 'OUTCOME_RECORDED', label: '결과 기록', count: outcome },
  ];
}

export type LifecycleHealth = 'HEALTHY' | 'ATTENTION' | 'IDLE';

export function deriveLifecycleHealth(stages: StageCount[]): { health: LifecycleHealth; reason: string } {
  const total = stages.reduce((s, x) => s + x.count, 0);
  if (total === 0) {
    return { health: 'IDLE', reason: '윈도우 내 Shadow 활동 없음 — 시장 시간 외이거나 신호 미발생.' };
  }
  const buy = stages[0].count;
  const filled = stages[1].count;
  const sell = stages[3].count;
  const closedCount = stages[4].count;
  const outcome = stages[5].count;

  // Stall 시그널: 상위 단계가 있는데 다음 단계로 흐르지 않은 경우
  if (buy > 0 && filled === 0) {
    return { health: 'ATTENTION', reason: `신호 ${buy}건 발생했으나 가상 체결 0건 — paper fill 경로 점검 권장.` };
  }
  if (closedCount > 0 && outcome === 0) {
    return { health: 'ATTENTION', reason: `청산 ${closedCount}건 완료됐으나 결과 기록 0건 — outcome 영속 경로 점검 권장.` };
  }
  if (sell > 0 && closedCount === 0) {
    return { health: 'ATTENTION', reason: `매도 신호 ${sell}건 있으나 청산 완료 0건 — 체결 경로 지연/누락 가능.` };
  }
  return { health: 'HEALTHY', reason: '6단계 흐름이 윈도우 내 진행 중.' };
}

function StageCell({ stage, max, health }: { stage: StageCount; max: number; health: LifecycleHealth }) {
  const ratio = max > 0 ? Math.min(1, stage.count / max) : 0;
  const barClass =
    health === 'ATTENTION' ? 'bg-amber-500'
      : stage.count > 0 ? 'bg-emerald-500'
      : 'bg-white/15';
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-theme-text-secondary truncate">
          {stage.label}
        </span>
        <span className="text-xs font-black font-mono tabular-nums text-theme-text shrink-0">
          {stage.count}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barClass)}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

export function ShadowLifecycleProgressBar(props: ShadowLifecycleProgressBarProps) {
  const windowMs = (props.windowHours ?? 24) * 60 * 60 * 1000;
  const stages = React.useMemo(
    () => aggregateLifecycleStages(props.shadowTrades, windowMs),
    [props.shadowTrades, windowMs],
  );
  const { health, reason } = deriveLifecycleHealth(stages);
  const max = Math.max(1, ...stages.map((s) => s.count));

  const toneRing = health === 'ATTENTION' ? 'border-amber-500/30 bg-amber-500/[0.05]'
    : health === 'HEALTHY' ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
    : 'border-white/15 bg-white/[0.03]';
  const toneText = health === 'ATTENTION' ? 'text-amber-300'
    : health === 'HEALTHY' ? 'text-emerald-300'
    : 'text-theme-text-secondary';
  const Icon = health === 'ATTENTION' ? AlertTriangle
    : health === 'HEALTHY' ? CheckCircle2
    : Activity;

  return (
    <section
      aria-label="Shadow 생애주기 6단계 흐름"
      className={cn('rounded-2xl border p-4 sm:p-5 flex flex-col gap-4', toneRing)}
    >
      <div className="flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-xl border flex items-center justify-center shrink-0',
          health === 'ATTENTION' ? 'border-amber-500/30 bg-amber-500/15'
            : health === 'HEALTHY' ? 'border-emerald-500/30 bg-emerald-500/15'
            : 'border-white/15 bg-white/[0.04]')}
        >
          <Icon className={cn('w-4 h-4', toneText)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs sm:text-sm font-black uppercase tracking-widest', toneText)}>
            Shadow 생애주기 흐름 (최근 {props.windowHours ?? 24}시간)
          </p>
          <p className="text-[11px] sm:text-xs font-bold text-theme-text-secondary mt-0.5">
            {reason}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 sm:gap-3">
        {stages.map((s) => (
          <StageCell key={s.code} stage={s} max={max} health={health} />
        ))}
      </div>

      <p className="text-[10px] font-bold text-theme-text-muted leading-relaxed">
        Shadow 생애주기 6단계가 모두 흘러야 LIVE 전환 안전성이 확보됩니다 (불변식 #2 — Shadow Learning 항상 가동). 단계별 카운트는 `serverShadowTrades` 의 signalTime / fills.timestamp / status / exitTime / resolvedAt 에서 derived.
      </p>
    </section>
  );
}
