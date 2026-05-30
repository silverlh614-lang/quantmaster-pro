/**
 * @responsibility LIVE 전환 사전 점검 체크리스트 — 정보 전용 (UI_WIRING_MATRIX §10 #2B Phase E)
 *
 * 사용자 디자인 스펙: "LIVE 전환 모달" + Genius Idea 8 "LIVE 전환 전 체크리스트 자동 생성".
 *
 * 핵심 안전 원칙:
 *  - 기존 arming 4단계 체인(IDLE→ARMED→CONFIRMING→COMMITTING + 오늘 날짜 토큰 강제) 절대
 *    수정 금지. 본 컴포넌트는 그 체인 PR 전 단계의 정보 노출 뿐, ARM 버튼을 자체적으로
 *    렌더링하거나 우회하지 않는다.
 *  - 사용자는 이 체크리스트를 보고 "아직 ARM 하지 말아야 한다" 를 인식하거나, 모두 ✅ 일
 *    때 EngineToggleGate 의 기존 ARM 버튼으로 안전 체인을 시작한다.
 *  - 톤: 차분·상태 중심·짧음. 경고 과잉 금지.
 *
 * 항목 분류:
 *  - ✅ READY     — LIVE ARM 가능 조건 충족
 *  - ⚠️ ATTENTION — 권장 점검(예: 비-LIVE 모드, 최근 스캔 부재) — 차단은 아니지만 인지 필요
 *  - ❌ BLOCKED   — 충족되지 않음. 이 상태에서 ARM 하면 안전 체인 다음 단계가 거부
 */
import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck } from 'lucide-react';
import { cn } from '../../../ui/cn';

export interface LivePreflightChecklistProps {
  isRunning: boolean;
  mode: string;
  emergencyStop: boolean;
  killSwitchActive: boolean;
  lastScanAt: string | null;
}

type ItemStatus = 'READY' | 'ATTENTION' | 'BLOCKED';

interface ChecklistItem {
  code: string;
  label: string;
  status: ItemStatus;
  detail: string;
}

const FRESH_SCAN_LIMIT_MS = 5 * 60 * 1000; // 5분 — heartbeat health 기준

function isScanFresh(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < FRESH_SCAN_LIMIT_MS;
}

function deriveChecklist(props: LivePreflightChecklistProps): ChecklistItem[] {
  const { isRunning, mode, emergencyStop, killSwitchActive, lastScanAt } = props;
  return [
    {
      code: 'ENGINE_RUNNING',
      label: '엔진 cron 가동 중',
      status: isRunning ? 'READY' : 'BLOCKED',
      detail: isRunning
        ? '자동 실행과 Shadow 학습 사이클이 정상 동작 중.'
        : '엔진 cron 가 멈춰 있어 ARM 안전 체인을 시작할 수 없습니다.',
    },
    {
      code: 'EMERGENCY_STOP_OFF',
      label: 'Emergency Stop OFF',
      status: emergencyStop ? 'BLOCKED' : 'READY',
      detail: emergencyStop
        ? '운영자 비상정지가 ON. ARM 전 토글 해제와 사유 확인 필요.'
        : '운영자 비상정지가 해제된 상태.',
    },
    {
      code: 'KILL_SWITCH_SAFE',
      label: 'Kill Switch SAFE',
      status: killSwitchActive ? 'BLOCKED' : 'READY',
      detail: killSwitchActive
        ? '자동 안전 강등 활성. 강등 조건(VKOSPI / 일일손실 등) 해소 후 자동 SAFE 복귀 또는 운영자 확인 필요.'
        : 'Kill Switch 평가가 SAFE — LIVE 차단 조건 미충족.',
    },
    {
      code: 'MODE_LIVE',
      label: '모드가 LIVE',
      status: mode === 'LIVE' ? 'READY' : 'ATTENTION',
      detail: mode === 'LIVE'
        ? '엔진이 LIVE 모드. 실거래 주문 권한이 활성화될 수 있음.'
        : `현재 ${mode || 'UNKNOWN'} 모드 — LIVE 전환 행위 자체가 ARM 안전 체인의 일부. 사전 점검 후 진행.`,
    },
    {
      code: 'SCAN_FRESH',
      label: '최근 5분 내 스캔 기록',
      status: isScanFresh(lastScanAt) ? 'READY' : 'ATTENTION',
      detail: isScanFresh(lastScanAt)
        ? '최근 스캔이 신선 — SourceSnapshot 신뢰도 양호.'
        : '최근 5분 내 스캔 기록이 없거나 stale. ARM 전 새 스캔 1회 권장.',
    },
  ];
}

interface SummaryTone { ringClass: string; bgClass: string; textClass: string; Icon: typeof ShieldCheck; headline: string; }

function summarize(items: ChecklistItem[]): SummaryTone {
  const blocked = items.filter((i) => i.status === 'BLOCKED').length;
  const attention = items.filter((i) => i.status === 'ATTENTION').length;
  const ready = items.filter((i) => i.status === 'READY').length;

  if (blocked > 0) {
    return {
      ringClass: 'border-rose-500/30',
      bgClass: 'bg-rose-500/[0.05]',
      textClass: 'text-rose-300',
      Icon: XCircle,
      headline: `LIVE ARM 준비 ${ready}/${items.length} · ${blocked}개 차단 항목`,
    };
  }
  if (attention > 0) {
    return {
      ringClass: 'border-amber-500/30',
      bgClass: 'bg-amber-500/[0.05]',
      textClass: 'text-amber-300',
      Icon: AlertTriangle,
      headline: `LIVE ARM 준비 ${ready}/${items.length} · ${attention}개 점검 권장`,
    };
  }
  return {
    ringClass: 'border-emerald-500/30',
    bgClass: 'bg-emerald-500/[0.05]',
    textClass: 'text-emerald-300',
    Icon: ShieldCheck,
    headline: `LIVE ARM 준비 ${ready}/${items.length} · 모든 항목 충족`,
  };
}

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === 'READY') return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
  if (status === 'ATTENTION') return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
  return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
}

export function LivePreflightChecklist(props: LivePreflightChecklistProps) {
  const items = deriveChecklist(props);
  const summary = summarize(items);

  return (
    <section
      aria-label="LIVE 전환 사전 점검 체크리스트"
      className={cn('rounded-2xl border p-4 sm:p-5 flex flex-col gap-3', summary.ringClass, summary.bgClass)}
    >
      <div className="flex items-center gap-3">
        <div className={cn('w-9 h-9 rounded-xl border flex items-center justify-center shrink-0', summary.ringClass)}>
          <summary.Icon className={cn('w-4 h-4', summary.textClass)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs sm:text-sm font-black uppercase tracking-widest', summary.textClass)}>
            LIVE 전환 사전 점검
          </p>
          <p className="text-[11px] sm:text-xs font-bold text-theme-text-secondary mt-0.5">
            {summary.headline}
          </p>
        </div>
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((it) => (
          <li
            key={it.code}
            className={cn(
              'rounded-lg border px-3 py-2 flex flex-col gap-1',
              it.status === 'READY' ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                : it.status === 'ATTENTION' ? 'border-amber-500/20 bg-amber-500/[0.04]'
                : 'border-rose-500/20 bg-rose-500/[0.04]',
            )}
          >
            <div className="flex items-center gap-2">
              <StatusIcon status={it.status} />
              <span className="text-xs font-black text-theme-text truncate">{it.label}</span>
            </div>
            <span className="text-[11px] font-bold text-theme-text-secondary leading-relaxed pl-6">
              {it.detail}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[10px] font-bold text-theme-text-muted leading-relaxed">
        본 체크리스트는 정보 전용입니다. 실제 LIVE 시동은 기존 EngineToggleGate 의 4단계 안전 체인
        (IDLE → ARMED → CONFIRMING → COMMITTING + 오늘 날짜 토큰 타이핑)을 거쳐야 합니다.
      </p>
    </section>
  );
}
