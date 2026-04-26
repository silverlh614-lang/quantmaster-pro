// @responsibility autoTrading 영역 CompositeVerdictCard 컴포넌트
/**
 * CompositeVerdictCard — 5개 하위 시스템(S1~S5) 계기판.
 *
 * 페이지 상단에 고정하여, 스트레스 상황에서 "7개 지표 동시 점검" 대신
 * "5개 도트 일별(一瞥)" 로 뇌 부하를 감소시킨다 (24번 보고서 Neuro-Wellness).
 *
 * 각 도트:
 *   🟢 NOMINAL  — 정상
 *   🟡 CAUTION  — 주의 (한 임계값 근접)
 *   🔴 ANOMALY  — 이상 (즉시 개입 필요)
 *
 * 5개 하위 시스템 매핑:
 *   S1 ENGINE      — 엔진 heartbeat + running flag
 *   S2 BROKER      — KIS 계정 연결 + 주문 가능 여부
 *   S3 RISK_GATES  — VIX / FOMC / emergencyStop
 *   S4 OCO         — OCO 취소 실패 누적
 *   S5 DATA_INTEG  — Reconciliation / 강등 상태
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Database, LinkIcon, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { Section } from '../../ui/section';
import type { EngineStatus, BuyAuditData } from '../../api';
import type { EngineHeartbeatInfo } from '../../hooks/autoTrade/useEngineHeartbeat';
import type { UseKillSwitchStatusReturn } from '../../hooks/autoTrade/useKillSwitchStatus';

export type VerdictLevel = 'NOMINAL' | 'CAUTION' | 'ANOMALY';

export interface SubsystemVerdict {
  id: 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
  name: string;
  subtitle: string;
  icon: React.ReactNode;
  level: VerdictLevel;
  detail: string;
}

interface CompositeVerdictCardProps {
  engine: EngineStatus | null;
  heartbeat: EngineHeartbeatInfo;
  killSwitch: UseKillSwitchStatusReturn;
  buyAudit: BuyAuditData | null;
  brokerConnected: boolean;
  dataIntegrityOk?: boolean;
  /**
   * 전체 하위 시스템 상태를 재조회한다. 브로커 링크가 끊긴 것처럼
   * 보이지만 실제로는 일시적 네트워크/토큰 갱신 지연일 수 있으므로,
   * 사용자가 즉시 회복을 시도할 수 있게 헤더에 새로고침 버튼을 노출한다.
   */
  onRefresh?: () => void;
}

const LEVEL_TONE: Record<VerdictLevel, { dot: string; ring: string; badge: string }> = {
  NOMINAL: {
    dot: 'bg-emerald-400 shadow-[0_0_12px_2px_rgba(52,211,153,0.6)]',
    ring: 'ring-emerald-400/30',
    badge: 'bg-emerald-500/15 text-emerald-200',
  },
  CAUTION: {
    dot: 'bg-amber-400 shadow-[0_0_12px_2px_rgba(251,191,36,0.6)]',
    ring: 'ring-amber-400/30',
    badge: 'bg-amber-500/15 text-amber-200',
  },
  ANOMALY: {
    dot: 'bg-red-500 shadow-[0_0_14px_3px_rgba(239,68,68,0.6)] animate-pulse',
    ring: 'ring-red-500/40',
    badge: 'bg-red-500/15 text-red-200',
  },
};

const LEVEL_LABEL: Record<VerdictLevel, string> = {
  NOMINAL: '정상',
  CAUTION: '주의',
  ANOMALY: '이상',
};

function deriveVerdicts(props: CompositeVerdictCardProps): SubsystemVerdict[] {
  const { engine, heartbeat, killSwitch, buyAudit, brokerConnected, dataIntegrityOk } = props;

  // S1: Engine heartbeat + running
  let s1: VerdictLevel = 'NOMINAL';
  let s1Detail = '엔진 정상 가동';
  if (heartbeat.isStale) { s1 = 'ANOMALY'; s1Detail = 'Heartbeat 중단 감지'; }
  else if (!engine?.running) { s1 = 'CAUTION'; s1Detail = '엔진 정지 상태'; }

  // S2: Broker connection
  let s2: VerdictLevel = 'NOMINAL';
  let s2Detail = '브로커 연결 정상';
  if (!brokerConnected) { s2 = 'ANOMALY'; s2Detail = '브로커 연결 끊김'; }
  else if (engine && !engine.autoTradeEnabled) { s2 = 'CAUTION'; s2Detail = 'AUTO_TRADE_ENABLED=false'; }

  // S3: Risk gates
  let s3: VerdictLevel = 'NOMINAL';
  let s3Detail = '모든 리스크 게이트 통과';
  if (engine?.emergencyStop || buyAudit?.emergencyStop) { s3 = 'ANOMALY'; s3Detail = '비상정지 발동'; }
  else if (buyAudit?.vixGating.noNewEntry) { s3 = 'CAUTION'; s3Detail = `VIX 게이트: ${buyAudit.vixGating.reason}`; }
  else if (buyAudit?.fomcGating.noNewEntry) { s3 = 'CAUTION'; s3Detail = `FOMC 게이트: ${buyAudit.fomcGating.description}`; }

  // S4: OCO subsystem
  let s4: VerdictLevel = 'NOMINAL';
  let s4Detail = 'OCO 루프 정상';
  const ocoFails = killSwitch.current?.details.ocoCancelFails ?? 0;
  if (ocoFails >= 3) { s4 = 'ANOMALY'; s4Detail = `OCO 반대 주문 취소 ${ocoFails}회 연속 실패`; }
  else if (ocoFails >= 1) { s4 = 'CAUTION'; s4Detail = `OCO 취소 실패 누적 ${ocoFails}회`; }

  // S5: Data Integrity / Kill Switch
  let s5: VerdictLevel = 'NOMINAL';
  let s5Detail = '정합성 검증 통과';
  if (killSwitch.isDowngraded) { s5 = 'ANOMALY'; s5Detail = 'Kill Switch 강등 (LIVE→SHADOW)'; }
  else if (killSwitch.current?.shouldDowngrade) { s5 = 'CAUTION'; s5Detail = `강등 임계값 근접: ${killSwitch.current.triggers.join(', ')}`; }
  else if (dataIntegrityOk === false) { s5 = 'CAUTION'; s5Detail = 'Reconciliation 불일치 감지'; }

  return [
    { id: 'S1', name: '엔진 코어', subtitle: 'Engine Core',
      icon: <Activity className="h-4 w-4" />, level: s1, detail: s1Detail },
    { id: 'S2', name: '브로커 링크', subtitle: 'Broker Link',
      icon: <LinkIcon className="h-4 w-4" />, level: s2, detail: s2Detail },
    { id: 'S3', name: '리스크 게이트', subtitle: 'Risk Gates',
      icon: <ShieldAlert className="h-4 w-4" />, level: s3, detail: s3Detail },
    { id: 'S4', name: 'OCO 루프', subtitle: 'OCO Loop',
      icon: <Sparkles className="h-4 w-4" />, level: s4, detail: s4Detail },
    { id: 'S5', name: '데이터 정합성', subtitle: 'Data Integrity',
      icon: <Database className="h-4 w-4" />, level: s5, detail: s5Detail },
  ];
}

function overallLevel(verdicts: SubsystemVerdict[]): VerdictLevel {
  if (verdicts.some(v => v.level === 'ANOMALY')) return 'ANOMALY';
  if (verdicts.some(v => v.level === 'CAUTION')) return 'CAUTION';
  return 'NOMINAL';
}

export function CompositeVerdictCard(props: CompositeVerdictCardProps) {
  const { onRefresh } = props;
  const verdicts = deriveVerdicts(props);
  const overall = overallLevel(verdicts);
  const overallTone = LEVEL_TONE[overall];

  // 버튼 클릭 직후 700ms 동안 회전 애니메이션 — 캐시 히트로 refetch가
  // 즉시 끝나더라도 사용자에게 "갱신 요청이 반영되었다" 는 피드백을 준다.
  const [spinning, setSpinning] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (spinTimer.current) clearTimeout(spinTimer.current);
  }, []);

  const handleRefresh = useCallback(() => {
    if (!onRefresh) return;
    setSpinning(true);
    onRefresh();
    if (spinTimer.current) clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpinning(false), 700);
  }, [onRefresh]);

  return (
    <Section
      title="종합 판독"
      subtitle="Composite Verdict — 5 Subsystems"
      actions={
        <>
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={spinning}
              title="하위 시스템 상태 새로고침"
              aria-label="하위 시스템 상태 새로고침"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${spinning ? 'animate-spin' : ''}`} />
            </button>
          )}
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${overallTone.badge}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${overallTone.dot}`} />
            {LEVEL_LABEL[overall]}
          </div>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        {verdicts.map((v) => {
          const tone = LEVEL_TONE[v.level];
          return (
            <button
              key={v.id}
              type="button"
              title={v.detail}
              className={`group flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-all hover:bg-white/[0.06] hover:ring-2 ${tone.ring}`}
            >
              <div className="relative flex flex-col items-center">
                <span className={`h-3 w-3 rounded-full ${tone.dot}`} />
                <span className="mt-1 text-[9px] font-black uppercase tracking-[0.1em] text-white/40">
                  {v.id}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                  {v.icon}
                  <span className="truncate">{v.name}</span>
                </div>
                <div className="mt-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-white/30">
                  {v.subtitle}
                </div>
                <div className="mt-1 line-clamp-2 text-[11px] text-white/70">
                  {v.detail}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
