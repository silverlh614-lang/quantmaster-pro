/**
 * @responsibility LIVE Readiness Score — 5 component weighted score (UI_WIRING_MATRIX §10 #2B Phase G)
 *
 * 사용자 디자인 스펙 Genius#3:
 *   LIVE Readiness: 72/100
 *     - Shadow lifecycle 안정성 30
 *     - 중복 알림/중복 주문 방지 20
 *     - KPI 양호성 20
 *     - Gate/Regime 일관성 15
 *     - Provider health 15
 *
 *   "이 점수는 자동 전환 권한이 아니라 참고 지표로만 써야 한다."
 *
 * 안전 원칙:
 *  - 점수는 LIVE ARM 권한을 자동으로 부여/박탈하지 않는다. EngineToggleGate 의 4단계 안전
 *    체인이 유일한 시동 게이트.
 *  - 일부 component(중복 방지, Gate/Regime 일관성)는 현재 데이터로 정밀 산출 불가 →
 *    heuristic 으로 보수적 점수 + reasoning 명시. 점수 옆에 "v1" 표기.
 *  - 데이터 부족 시(샘플 < 10건) KPI component 는 INSUFFICIENT 으로 표시 → 점수 0 이 아닌
 *    "측정 불가" 로 honestly 노출.
 */
import React from 'react';
import { Gauge, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { ServerShadowTrade } from '../../../api';
import { aggregateLifecycleStages, deriveLifecycleHealth } from './ShadowLifecycleProgressBar';

export interface LiveReadinessScoreProps {
  shadowTrades: ServerShadowTrade[] | null | undefined;
  isRunning: boolean;
  mode: string;
  emergencyStop: boolean;
  killSwitchActive: boolean;
  kisStreamConnected?: boolean;
}

interface ComponentScore {
  code: 'LIFECYCLE' | 'DUP_PREVENTION' | 'KPI' | 'GATE_CONSISTENCY' | 'PROVIDER_HEALTH';
  label: string;
  max: number;
  score: number | null; // null = INSUFFICIENT (제외)
  reason: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const TERMINAL_STATES = new Set(['HIT_TARGET', 'HIT_STOP']);

function scoreLifecycle(trades: ServerShadowTrade[] | null | undefined): ComponentScore {
  const stages = aggregateLifecycleStages(trades, DAY);
  const { health } = deriveLifecycleHealth(stages);
  const total = stages.reduce((s, x) => s + x.count, 0);
  let score: number;
  let reason: string;
  if (health === 'HEALTHY') { score = 30; reason = '24h 내 6단계 흐름 정상.'; }
  else if (health === 'ATTENTION') { score = 15; reason = '일부 단계 stall — Shadow lifecycle 점검 권장.'; }
  else { score = total === 0 ? 10 : 5; reason = total === 0 ? '24h 내 활동 없음(장 외/신호 미발생). 정밀 측정 불가.' : '단계 흐름 미약.'; }
  return { code: 'LIFECYCLE', label: 'Shadow lifecycle 안정성', max: 30, score, reason };
}

function scoreDupPrevention(trades: ServerShadowTrade[] | null | undefined): ComponentScore {
  // Heuristic: 같은 stockCode 가 1시간 내 BUY 신호 2회 이상이면 dup 후보. shadowTrades 가
  // 실제 dedup 결과를 통과한 상태이므로 dup 가 거의 0 일 것 — 발견 시만 감점.
  const safe = trades ?? [];
  const cutoff = Date.now() - DAY;
  const byCode = new Map<string, number[]>();
  for (const t of safe) {
    const ts = new Date(t.signalTime).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) continue;
    const arr = byCode.get(t.stockCode) ?? [];
    arr.push(ts);
    byCode.set(t.stockCode, arr);
  }
  let dupCount = 0;
  for (const arr of byCode.values()) {
    arr.sort((a, b) => a - b);
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] - arr[i - 1] < HOUR) dupCount += 1;
    }
  }
  let score: number;
  let reason: string;
  if (dupCount === 0) { score = 20; reason = '24h 내 의심 중복 신호 0건 (heuristic v1: 동일 코드 1h 내 재신호 검사).'; }
  else if (dupCount <= 2) { score = 12; reason = `의심 중복 ${dupCount}건 — 검토 권장.`; }
  else { score = 5; reason = `의심 중복 ${dupCount}건 — dedup 경로 점검 필요.`; }
  return { code: 'DUP_PREVENTION', label: '중복 신호 방지', max: 20, score, reason };
}

function scoreKpi(trades: ServerShadowTrade[] | null | undefined): ComponentScore {
  const safe = trades ?? [];
  const cutoff = Date.now() - 30 * DAY;
  const closed = safe.filter((t) =>
    TERMINAL_STATES.has(t.status)
    && typeof t.returnPct === 'number'
    && Number.isFinite(new Date(t.exitTime ?? '').getTime())
    && new Date(t.exitTime ?? '').getTime() >= cutoff,
  );
  if (closed.length < 10) {
    return {
      code: 'KPI',
      label: 'KPI 양호성',
      max: 20,
      score: null,
      reason: `최근 30일 청산 ${closed.length}건 — 측정 표본 부족(< 10). LIVE 전환 판단 보류.`,
    };
  }
  const wins = closed.filter((t) => (t.returnPct ?? 0) > 0).length;
  const winRate = wins / closed.length;
  const expectancy = closed.reduce((s, t) => s + (t.returnPct ?? 0), 0) / closed.length;
  let score: number;
  let reason: string;
  if (winRate >= 0.5 && expectancy > 0) { score = 20; reason = `승률 ${(winRate * 100).toFixed(0)}% · expectancyR ${expectancy.toFixed(2)}% — 양호.`; }
  else if (winRate >= 0.4 || expectancy > 0) { score = 12; reason = `승률 ${(winRate * 100).toFixed(0)}% · expectancyR ${expectancy.toFixed(2)}% — 경계.`; }
  else { score = 5; reason = `승률 ${(winRate * 100).toFixed(0)}% · expectancyR ${expectancy.toFixed(2)}% — 약함.`; }
  return { code: 'KPI', label: 'KPI 양호성 (30d)', max: 20, score, reason };
}

function scoreGateConsistency(props: LiveReadinessScoreProps): ComponentScore {
  const { isRunning, mode, emergencyStop, killSwitchActive } = props;
  // 일관성 정의: 엔진 가동 + (mode==='LIVE' && safe) 이거나 (mode!=='LIVE' && SHADOW 학습 가능)
  if (!isRunning) {
    return { code: 'GATE_CONSISTENCY', label: 'Gate/Regime 일관성', max: 15, score: 3, reason: '엔진 정지 — 불변식 #1 위반 가능.' };
  }
  if (mode === 'LIVE' && (emergencyStop || killSwitchActive)) {
    return { code: 'GATE_CONSISTENCY', label: 'Gate/Regime 일관성', max: 15, score: 8, reason: 'LIVE 모드이나 안전 가드 활성 — 일관성 일부 disconnect.' };
  }
  return { code: 'GATE_CONSISTENCY', label: 'Gate/Regime 일관성', max: 15, score: 15, reason: 'Mode 와 안전 가드 상태가 정합 (heuristic v1).' };
}

function scoreProviderHealth(props: LiveReadinessScoreProps): ComponentScore {
  // KIS 실시간 호가 WebSocket 연결 여부가 provider health 의 가장 강력한 단일 지표.
  if (props.kisStreamConnected === true) {
    return { code: 'PROVIDER_HEALTH', label: 'Provider health (KIS stream)', max: 15, score: 15, reason: 'KIS 실시간 호가 WebSocket 연결됨.' };
  }
  if (props.kisStreamConnected === false) {
    return { code: 'PROVIDER_HEALTH', label: 'Provider health (KIS stream)', max: 15, score: 5, reason: 'KIS WebSocket 미연결 — REST 폴백 운영 중일 수 있음.' };
  }
  return { code: 'PROVIDER_HEALTH', label: 'Provider health (KIS stream)', max: 15, score: null, reason: 'kisStreamConnected 노출 안 됨(서버 버전 차이) — 측정 불가.' };
}

export function computeLiveReadiness(props: LiveReadinessScoreProps): {
  total: number;
  effectiveMax: number;
  components: ComponentScore[];
} {
  const components: ComponentScore[] = [
    scoreLifecycle(props.shadowTrades),
    scoreDupPrevention(props.shadowTrades),
    scoreKpi(props.shadowTrades),
    scoreGateConsistency(props),
    scoreProviderHealth(props),
  ];
  const measured = components.filter((c) => c.score != null);
  const total = measured.reduce((s, c) => s + (c.score ?? 0), 0);
  const effectiveMax = measured.reduce((s, c) => s + c.max, 0);
  return { total, effectiveMax, components };
}

function tonOf(total: number, effectiveMax: number): { tone: 'READY' | 'CAUTION' | 'LOW'; toneClass: string; textClass: string; Icon: typeof Gauge; headline: string } {
  const ratio = effectiveMax > 0 ? total / effectiveMax : 0;
  if (ratio >= 0.8) {
    return { tone: 'READY', toneClass: 'border-emerald-500/30 bg-emerald-500/[0.05]', textClass: 'text-emerald-300', Icon: CheckCircle2, headline: 'LIVE 전환 참고 — 양호' };
  }
  if (ratio >= 0.6) {
    return { tone: 'CAUTION', toneClass: 'border-amber-500/30 bg-amber-500/[0.05]', textClass: 'text-amber-300', Icon: AlertTriangle, headline: 'LIVE 전환 참고 — 경계' };
  }
  return { tone: 'LOW', toneClass: 'border-rose-500/30 bg-rose-500/[0.05]', textClass: 'text-rose-300', Icon: XCircle, headline: 'LIVE 전환 참고 — 약함' };
}

function ComponentRow({ c }: { c: ComponentScore }) {
  const isMeasured = c.score != null;
  const ratio = isMeasured ? (c.score! / c.max) : 0;
  const barClass = !isMeasured ? 'bg-white/15'
    : ratio >= 0.7 ? 'bg-emerald-500'
    : ratio >= 0.4 ? 'bg-amber-500'
    : 'bg-rose-500';
  return (
    <li className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-theme-text truncate">{c.label}</span>
        <span className="text-[11px] font-black font-mono tabular-nums shrink-0 text-theme-text-secondary">
          {isMeasured ? `${c.score} / ${c.max}` : `— / ${c.max}`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-500', barClass)} style={{ width: `${ratio * 100}%` }} />
      </div>
      <span className="text-[10px] font-bold text-theme-text-muted leading-relaxed">
        {isMeasured ? c.reason : (<><HelpCircle className="inline w-2.5 h-2.5 mr-1" />{c.reason}</>)}
      </span>
    </li>
  );
}

export function LiveReadinessScore(props: LiveReadinessScoreProps) {
  const { total, effectiveMax, components } = React.useMemo(() => computeLiveReadiness(props), [
    props.shadowTrades, props.isRunning, props.mode, props.emergencyStop, props.killSwitchActive, props.kisStreamConnected,
  ]);
  const t = tonOf(total, effectiveMax);
  const insufficientCount = components.filter((c) => c.score == null).length;

  return (
    <section
      aria-label="LIVE Readiness Score (v1, 참고 지표)"
      className={cn('rounded-2xl border p-4 sm:p-5 flex flex-col gap-4', t.toneClass)}
    >
      <div className="flex items-center gap-4">
        <div className={cn('w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0',
          t.tone === 'READY' ? 'border-emerald-500/30 bg-emerald-500/15'
            : t.tone === 'CAUTION' ? 'border-amber-500/30 bg-amber-500/15'
            : 'border-rose-500/30 bg-rose-500/15')}
        >
          <t.Icon className={cn('w-5 h-5', t.textClass)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs sm:text-sm font-black uppercase tracking-widest', t.textClass)}>
            {t.headline}
          </p>
          <div className="flex items-baseline gap-2 mt-0.5">
            <span className={cn('text-2xl sm:text-3xl font-black font-mono tabular-nums', t.textClass)}>
              {total}
            </span>
            <span className="text-xs font-black text-theme-text-secondary">/ {effectiveMax}</span>
            {insufficientCount > 0 && (
              <span className="text-[10px] font-bold text-theme-text-muted ml-2">
                · {insufficientCount}개 측정 불가
              </span>
            )}
          </div>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {components.map((c) => <ComponentRow key={c.code} c={c} />)}
      </ul>

      <p className="text-[10px] font-bold text-theme-text-muted leading-relaxed">
        본 점수는 <span className="font-black">자동 전환 권한이 아니라 참고 지표</span> 입니다 (사용자 디자인 스펙 Genius#3 명시). LIVE 시동은 기존 EngineToggleGate 의 4단계 안전 체인을 거쳐야 합니다. v1 heuristic — 일부 component 는 보수적 추정. 점수 공식·가중치는 운영자 정책 합의 후 별도 ADR 로 정밀화 예정.
      </p>
    </section>
  );
}
