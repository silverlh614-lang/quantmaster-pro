/**
 * @responsibility AutoTrade 페이지 상단 1초 인식 상태 배너 (UI_WIRING_MATRIX §10 #2B Phase A)
 *
 * "지금 실제 돈이 나가는가?" — 사용자가 페이지 진입 1초 안에 답을 알아야 한다.
 *
 * 설계 원칙(사용자 디자인 스펙):
 *  - 설명이 아니라 상태 인식 우선. 단일 헤로 문장이 페이지 가장 위.
 *  - 톤: 차분·명확·짧음·상태 중심. 경고 과잉 금지("위험!"/"치명적!" 사용 안 함).
 *  - QuantMaster 불변식 #1/#2 정합 — 엔진 정지/Shadow 정지는 시스템 결함 신호로 노출(SOS),
 *    그 외(SHADOW_ONLY/SELL_ONLY)는 안전 운전 상태로 차분히 표시.
 *
 * 본 컴포넌트는 표시 전용 — 새 서버 호출·로직·상태 변경 0건. 모든 derived state 는
 * AutoTradePage 가 이미 useAutoTradingDashboard / useKillSwitchStatus 에서 받은 값.
 *
 * Phase A 스코프(이 PR): 헤로 한 줄 + 상태 배지 5종. inline help/tour/explain drawer/
 * pre-flight modal/Shadow lifecycle 시각화/LIVE Readiness Score 는 후속 PR(B~G).
 */
import React, { useState } from 'react';
import {
  ShieldCheck, ShieldAlert, ShieldOff, Activity, AlertOctagon, Clock,
  ChevronDown, ChevronUp, HelpCircle,
} from 'lucide-react';
import { cn } from '../../../ui/cn';

export interface AutoTradeStatusCommandBarProps {
  /** 엔진 cron 가 살아 있는지 (engineStatus.running). */
  isRunning: boolean;
  /** 운용 모드 — 'LIVE' | 'PAPER' | 'SHADOW' | 'MANUAL' (engineStatus.mode). */
  mode: string;
  /** 운영자 비상정지 토글 (engineStatus.emergencyStop). */
  emergencyStop: boolean;
  /** Kill Switch 자동 강등(VKOSPI / 일일손실 등) (killSwitch.current.shouldDowngrade). */
  killSwitchActive: boolean;
  /** 마지막 스캔 시각 — ISO string 또는 null (engineStatus.lastScanAt). */
  lastScanAt: string | null;
}

type LiveBuyVerdict = 'ALLOWED' | 'BLOCKED_SAFE' | 'BLOCKED_ALERT';

interface HeroCopy {
  verdict: LiveBuyVerdict;
  headline: string;
  body: string;
  Icon: typeof ShieldCheck;
  toneClass: string;     // 카드 배경/테두리 톤
  iconWrapClass: string;
  iconClass: string;
  headlineClass: string;
}

function deriveHeroCopy(props: AutoTradeStatusCommandBarProps): HeroCopy {
  const { isRunning, mode, emergencyStop, killSwitchActive } = props;
  const isLiveMode = mode === 'LIVE';

  // 엔진 정지 — 불변식 #1/#2(엔진 항상 살아있어야 + Shadow 항상 실행) 위반 가능 상태이므로
  // 안전 상태가 아니라 ALERT 톤. SOS 가 아닌 안내 톤 유지(과잉 경고 금지).
  if (!isRunning) {
    return {
      verdict: 'BLOCKED_ALERT',
      headline: '엔진 중지 상태입니다.',
      body: '자동 실행과 Shadow 학습이 모두 멈춰 있습니다. 우측 컨트롤에서 재시동을 확인하세요.',
      Icon: ShieldOff,
      toneClass: 'border-rose-500/30 bg-rose-500/[0.06]',
      iconWrapClass: 'bg-rose-500/15 border-rose-500/30',
      iconClass: 'text-rose-400',
      headlineClass: 'text-rose-300',
    };
  }

  if (emergencyStop) {
    return {
      verdict: 'BLOCKED_ALERT',
      headline: 'Emergency Stop ON — 실거래 신규매수는 차단되어 있습니다.',
      body: '관찰·기록·Shadow 학습은 유지됩니다. 해제 시 LIVE 권한이 복귀할 수 있으니 사유를 확인하세요.',
      Icon: AlertOctagon,
      toneClass: 'border-rose-500/30 bg-rose-500/[0.06]',
      iconWrapClass: 'bg-rose-500/15 border-rose-500/30',
      iconClass: 'text-rose-400',
      headlineClass: 'text-rose-300',
    };
  }

  if (killSwitchActive) {
    return {
      verdict: 'BLOCKED_ALERT',
      headline: 'Kill Switch 강등 — 실거래 신규매수는 차단되어 있습니다.',
      body: '자동 안전장치가 실행을 막은 상태입니다. Shadow 기록·학습은 유지됩니다. 차단 사유는 SafetyLayer 카드에서 확인하세요.',
      Icon: AlertOctagon,
      toneClass: 'border-amber-500/30 bg-amber-500/[0.06]',
      iconWrapClass: 'bg-amber-500/15 border-amber-500/30',
      iconClass: 'text-amber-400',
      headlineClass: 'text-amber-300',
    };
  }

  if (isLiveMode) {
    return {
      verdict: 'ALLOWED',
      headline: 'LIVE 모드 — 실거래 신규매수가 허용될 수 있습니다.',
      body: '주문 전 Safety Gate, Kill Switch, 최근 KPI 를 먼저 확인하세요.',
      Icon: ShieldAlert,
      toneClass: 'border-emerald-500/30 bg-emerald-500/[0.06]',
      iconWrapClass: 'bg-emerald-500/15 border-emerald-500/30',
      iconClass: 'text-emerald-400',
      headlineClass: 'text-emerald-300',
    };
  }

  // SHADOW / PAPER / MANUAL — 안전 운전 (사용자 디자인 스펙의 "SHADOW_ONLY 모드입니다" 카피)
  const modeLabel = mode === 'SHADOW' ? 'SHADOW_ONLY' : mode === 'PAPER' ? 'PAPER' : 'MANUAL';
  return {
    verdict: 'BLOCKED_SAFE',
    headline: `${modeLabel} 모드 — 실거래 신규매수는 차단되어 있습니다.`,
    body: 'Shadow 매수·매도·학습 사이클은 정상 실행 중입니다. LIVE 와 동일한 판단 생애주기를 검증합니다.',
    Icon: ShieldCheck,
    toneClass: 'border-sky-500/30 bg-sky-500/[0.06]',
    iconWrapClass: 'bg-sky-500/15 border-sky-500/30',
    iconClass: 'text-sky-300',
    headlineClass: 'text-sky-200',
  };
}

function formatRelative(iso: string | null): string {
  if (!iso) return '아직 없음';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const diffMs = Date.now() - t;
  if (diffMs < 0) return new Date(iso).toLocaleTimeString('ko-KR');
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return new Date(iso).toLocaleString('ko-KR');
}

interface BadgeProps { label: string; value: string; tone: 'ok' | 'warn' | 'alert' | 'neutral'; title?: string; }

function StatusBadge({ label, value, tone, title }: BadgeProps) {
  const toneClass =
    tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-300'
      : tone === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.06] text-amber-300'
      : tone === 'alert' ? 'border-rose-500/30 bg-rose-500/[0.06] text-rose-300'
      : 'border-white/15 bg-white/[0.04] text-theme-text-secondary';
  return (
    <div
      className={cn('rounded-xl border px-3 py-2 flex flex-col gap-0.5 min-w-0', toneClass)}
      title={title}
    >
      <span className="text-[9px] font-black uppercase tracking-[0.18em] opacity-70">{label}</span>
      <span className="text-xs font-black truncate">{value}</span>
    </div>
  );
}

interface BlockReason { code: string; detail: string; tone: 'alert' | 'warn' | 'info' }

function deriveBlockReasons(props: AutoTradeStatusCommandBarProps): BlockReason[] {
  const { isRunning, mode, emergencyStop, killSwitchActive } = props;
  const reasons: BlockReason[] = [];
  if (!isRunning) {
    reasons.push({
      code: 'ENGINE_STOPPED',
      detail: '엔진 cron 가 멈춰 자동 실행과 Shadow 학습이 모두 정지된 상태. 불변식 #1/#2 위반 가능 — 즉시 재시동 확인 권장.',
      tone: 'alert',
    });
  }
  if (emergencyStop) {
    reasons.push({
      code: 'EMERGENCY_STOP_ON',
      detail: '운영자 비상정지 토글이 ON. 신규 실행은 차단, 관찰·기록·Shadow 학습은 유지.',
      tone: 'alert',
    });
  }
  if (killSwitchActive) {
    reasons.push({
      code: 'KILL_SWITCH_ACTIVE',
      detail: '자동 안전 강등 — VKOSPI·일일손실·매크로 위험 등 조건 충족. LIVE 차단·Shadow 유지.',
      tone: 'warn',
    });
  }
  if (mode !== 'LIVE') {
    reasons.push({
      code: `MODE_${mode || 'UNKNOWN'}`,
      detail: `현재 모드 ${mode || 'UNKNOWN'} — LIVE 전환 전까지 실거래 신규매수는 자동 차단. Shadow 사이클은 정상.`,
      tone: 'info',
    });
  }
  return reasons;
}

export function AutoTradeStatusCommandBar(props: AutoTradeStatusCommandBarProps) {
  const hero = deriveHeroCopy(props);
  const { isRunning, mode, emergencyStop, killSwitchActive, lastScanAt } = props;
  const [showReasons, setShowReasons] = useState(false);
  const blockReasons = deriveBlockReasons(props);
  const isBlocked = hero.verdict !== 'ALLOWED';

  return (
    <section
      aria-label="AutoTrade 상태 명령 바"
      className={cn('rounded-2xl border p-5 sm:p-6 flex flex-col gap-5', hero.toneClass)}
    >
      <div className="flex items-start gap-4">
        <div className={cn('w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border flex items-center justify-center shrink-0', hero.iconWrapClass)}>
          <hero.Icon className={cn('w-6 h-6 sm:w-7 sm:h-7', hero.iconClass)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-base sm:text-lg font-black leading-tight', hero.headlineClass)}>
            {hero.headline}
          </p>
          <p className="text-xs sm:text-sm text-theme-text-secondary font-bold mt-1.5 leading-relaxed">
            {hero.body}
          </p>
          {isBlocked && blockReasons.length > 0 && (
            <button
              type="button"
              onClick={() => setShowReasons((v) => !v)}
              aria-expanded={showReasons}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-[10px] sm:text-xs font-black uppercase tracking-widest text-theme-text-secondary transition-colors"
            >
              <HelpCircle className="w-3 h-3" />
              차단 사유 보기 ({blockReasons.length})
              {showReasons ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
        </div>
      </div>

      {/* UI_WIRING_MATRIX §10 #2B Phase C — 사용자 디자인 스펙 "왜 차단됐는가? Explain Drawer".
          새 데이터 hookup 0건 — 헤로와 동일한 derived state 를 구조화해 사유별로 분리 노출. */}
      {isBlocked && showReasons && blockReasons.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
          {blockReasons.map((r) => (
            <li
              key={r.code}
              className={cn(
                'rounded-lg border px-3 py-2 flex flex-col gap-0.5',
                r.tone === 'alert' ? 'border-rose-500/30 bg-rose-500/[0.06]'
                  : r.tone === 'warn' ? 'border-amber-500/30 bg-amber-500/[0.06]'
                  : 'border-sky-500/30 bg-sky-500/[0.06]',
              )}
            >
              <span className={cn(
                'text-[10px] font-black font-mono tracking-wide uppercase',
                r.tone === 'alert' ? 'text-rose-300'
                  : r.tone === 'warn' ? 'text-amber-300'
                  : 'text-sky-300',
              )}>
                {r.code}
              </span>
              <span className="text-xs font-bold text-theme-text-secondary leading-relaxed">
                {r.detail}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3">
        <StatusBadge
          label="Engine"
          value={isRunning ? 'Running' : 'Stopped'}
          tone={isRunning ? 'ok' : 'alert'}
          title="자동매매 엔진 cron 의 살아있음 여부 — Stopped 면 Shadow 학습도 멈춥니다 (불변식 #1/#2)."
        />
        <StatusBadge
          label="Mode"
          value={mode || 'UNKNOWN'}
          tone={mode === 'LIVE' ? 'warn' : mode ? 'neutral' : 'alert'}
          title="LIVE = 실거래 가능 / SHADOW · PAPER = 가상 판단·학습만 / MANUAL = 자동 실행 정지."
        />
        <StatusBadge
          label="Emergency"
          value={emergencyStop ? 'ON' : 'OFF'}
          tone={emergencyStop ? 'alert' : 'ok'}
          title="Emergency Stop ON = 신규 실행 즉시 차단. 관찰·기록·Shadow 학습은 유지됩니다 (실행 차단 ≠ 엔진 사망)."
        />
        <StatusBadge
          label="Kill Switch"
          value={killSwitchActive ? 'Active' : 'Safe'}
          tone={killSwitchActive ? 'warn' : 'ok'}
          title="자동 안전 강등 — VKOSPI/일일손실/매크로 위험 등 조건 충족 시 LIVE 차단. Shadow 는 유지."
        />
        <div className="col-span-2 sm:col-span-1 rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 flex flex-col gap-0.5">
          <span className="text-[9px] font-black uppercase tracking-[0.18em] opacity-70 text-theme-text-secondary flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" /> Last Scan
          </span>
          <span className="text-xs font-black text-theme-text" title={lastScanAt ?? '아직 스캔 기록 없음'}>
            {formatRelative(lastScanAt)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] font-bold text-theme-text-muted">
        <Activity className="w-3 h-3" />
        <span>
          상단 1초 인식 배너 — Phase A. 다음 단계: inline tooltip · explain drawer · LIVE pre-flight 체크리스트 (UI_WIRING_MATRIX §10 #2B).
        </span>
      </div>
    </section>
  );
}
