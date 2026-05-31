// @responsibility Compressed candidate decision card for Discover/Watchlist.

import React from 'react';
import { Activity, Ban, Eye, ShieldCheck, Timer, TrendingUp } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { cn } from '../../ui/cn';
import { DataConfidenceBadge } from '../common/DataConfidenceBadge';
import { ConfluenceMeter } from '../common/ConfluenceMeter';
import {
  PUBLIC_DECISION_TEXT,
} from '../../candidate-decision/candidateDecisionModel';
import type { GateSummary, StockDecisionCard } from '../../public-report/reportTypes';

type CandidateDecisionCardMode = 'simple' | 'pro' | 'report';

interface CandidateDecisionCardProps {
  model: StockDecisionCard;
  mode?: CandidateDecisionCardMode;
  className?: string;
}

const DECISION_TONE: Record<StockDecisionCard['finalDecision'], string> = {
  CONFIRMED_CANDIDATE: 'border-emerald-400/35 bg-emerald-400/12 text-emerald-100',
  BUY_CANDIDATE: 'border-green-400/30 bg-green-400/10 text-green-100',
  WATCH: 'border-blue-400/30 bg-blue-400/10 text-blue-100',
  WAIT_PULLBACK: 'border-amber-400/35 bg-amber-400/12 text-amber-100',
  HOLD: 'border-slate-400/30 bg-slate-400/10 text-slate-100',
  SELL_ONLY: 'border-orange-400/35 bg-orange-400/12 text-orange-100',
  SHADOW_ONLY: 'border-violet-400/35 bg-violet-400/12 text-violet-100',
  BLOCKED: 'border-red-400/35 bg-red-400/12 text-red-100',
  DATA_INSUFFICIENT: 'border-slate-400/30 bg-slate-400/10 text-slate-100',
};

const GATE_TONE: Record<GateSummary['status'], string> = {
  PASS: 'border-emerald-400/20 bg-emerald-400/[0.07] text-emerald-100',
  WATCH: 'border-blue-400/20 bg-blue-400/[0.07] text-blue-100',
  WAIT: 'border-amber-400/25 bg-amber-400/[0.08] text-amber-100',
  BLOCKED: 'border-red-400/25 bg-red-400/[0.08] text-red-100',
  DATA_INSUFFICIENT: 'border-slate-400/20 bg-slate-400/[0.07] text-slate-100',
  NOT_EVALUATED: 'border-slate-400/20 bg-slate-400/[0.05] text-slate-300',
};

// 통과지만 검증 0(전부 AI 추정) — emerald(검증 통과) 대신 amber 로 톤다운해 "미검증 통과" 구분.
const GATE_TONE_AI = 'border-amber-400/30 bg-amber-400/[0.09] text-amber-100';

function GatePill({ gate }: { gate: GateSummary }) {
  const verified = gate.verifiedPassed ?? 0;
  const aiPassed = Math.max(0, gate.passed - verified);
  // 통과(PASS)인데 검증 0 → 전부 AI 추정으로 통과. 게이트가 "전부 PASS" 로만 보여 부풀려
  // 보이던 문제를, 배지·색·바로 "검증 통과 vs AI 통과" 를 한눈에 구분한다.
  const aiOnly = gate.status === 'PASS' && verified === 0 && gate.passed > 0;
  return (
    <div className={cn('rounded-lg border px-2.5 py-2', aiOnly ? GATE_TONE_AI : GATE_TONE[gate.status])}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-semibold tracking-tight text-white/45">{gate.name.replace(/^Gate\s*/i, 'G')}</span>
        <span className="text-[9px] font-black">{aiOnly ? 'AI 통과' : gate.status}</span>
      </div>
      <div className="mt-1 text-sm font-black font-num">{gate.passed}/{gate.total}</div>
      {gate.total > 0 && (
        <div
          className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-white/10"
          title={`검증 ${verified} · AI 추정 ${aiPassed} · 미달 ${gate.total - gate.passed}`}
        >
          <div className="bg-emerald-400" style={{ width: `${(verified / gate.total) * 100}%` }} />
          <div className="bg-amber-400/70" style={{ width: `${(aiPassed / gate.total) * 100}%` }} />
        </div>
      )}
      <div className="mt-1 text-[10px] font-black tracking-tight">
        <span className="text-emerald-300/90">검증 {verified}</span>
        <span className="text-white/25"> · </span>
        <span className="text-amber-300/90">AI {aiPassed}</span>
        <span className="text-white/30 font-bold"> / {gate.total}</span>
      </div>
    </div>
  );
}

function ReasonList({ title, items, tone, limit }: { title: string; items: string[]; tone: 'green' | 'red' | 'amber'; limit: number }) {
  const visible = items.filter(Boolean).slice(0, limit);
  const titleClass = tone === 'green' ? 'text-emerald-200/80' : tone === 'red' ? 'text-red-200/80' : 'text-amber-200/80';
  const borderClass = tone === 'green' ? 'border-emerald-400/15' : tone === 'red' ? 'border-red-400/15' : 'border-amber-400/15';
  return (
    <div>
      <div className={cn('mb-1.5 text-[10px] font-semibold tracking-tight', titleClass)}>{title}</div>
      {visible.length > 0 ? (
        <ul className="space-y-1.5">
          {visible.map((item) => (
            <li key={item} className={cn('rounded-md border bg-white/[0.025] px-2.5 py-1.5 text-[11px] leading-snug text-white/66', borderClass)}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-white/[0.05] bg-white/[0.015] px-2.5 py-1.5 text-[11px] text-white/35">
          주요 항목 없음
        </div>
      )}
    </div>
  );
}

function executionText(model: StockDecisionCard): string {
  return model.liveExecutionAllowed ? '허용' : '차단';
}

function sectorEffectText(model: StockDecisionCard): string {
  if (model.sectorAlignment.sectorBonusApplied) return 'Gate 2 컨텍스트 보너스';
  if (model.sectorAlignment.sectorPenaltyApplied) return '포지션 크기 제한';
  return '섹터 페널티 없음';
}

export function CandidateDecisionCard({ model, mode = 'pro', className }: CandidateDecisionCardProps) {
  const isSimple = mode === 'simple';
  const isReport = mode === 'report';
  const showDetails = !isSimple;
  const decisionText = PUBLIC_DECISION_TEXT[model.finalDecision] ?? model.displayDecision;
  const hasAiWarning = model.dataConfidence.aiEstimatedIndicatorCount > 0;
  const hasMissingWarning = model.dataConfidence.missingIndicatorCount > 0 || model.dataConfidence.overall === 'STALE';

  return (
    <section
      className={cn('rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 sm:p-5', isReport && 'bg-white/[0.025]', className)}
      data-candidate-decision={model.finalDecision}
      data-shadow-tracking={model.shadowTrackingStatus}
      data-execution-impact={model.executionImpact}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-black text-white sm:text-lg">{model.stockName}</span>
            <span className="rounded-md border border-white/[0.07] bg-white/[0.04] px-2 py-0.5 text-[10px] font-black tracking-widest text-white/55">
              {model.stockCode}
            </span>
            <span className="text-[11px] font-bold text-white/45">{model.sector}</span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-tight', DECISION_TONE[model.finalDecision])}>
              {decisionText}
            </span>
            <DataConfidenceBadge confidence={model.dataConfidence.overall} compact source="candidate card" />
            <Badge variant={model.shadowTrackingStatus === 'OFF' ? 'default' : 'info'} size="sm">
              Shadow {model.shadowTrackingStatus}
            </Badge>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold tracking-tight text-white/40">최종 점수</div>
          <div className="font-num text-2xl font-black text-white">{model.finalScore}</div>
          <div className="mt-1 max-w-[12rem] truncate text-[9px] font-mono text-white/30" title={model.sourceSnapshotId}>
            {model.sourceSnapshotId}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 xl:grid-cols-4">
        {[model.gate0, model.gate1, model.gate2, model.gate3].map((gate) => <GatePill key={gate.name} gate={gate} />)}
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.05] bg-white/[0.018] px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold tracking-tight text-white/40">섹터 정렬</div>
            <div className="mt-1 text-xs font-black text-white">
              {model.sectorAlignment.sectorName} / 점수 {model.sectorAlignment.sectorScore} / 순위 {model.sectorAlignment.sectorRank || 'N/A'}
            </div>
          </div>
          <Badge
            variant={model.sectorAlignment.sectorPenaltyApplied ? 'warning' : model.sectorAlignment.sectorBonusApplied ? 'success' : 'default'}
            size="sm"
          >
            {model.sectorAlignment.sectorAlignment}
          </Badge>
        </div>
        {showDetails && (
          <div className="mt-1 text-[11px] font-bold text-white/45">
            효과: {sectorEffectText(model)}
          </div>
        )}
      </div>

      {showDetails && (
        <div className="mt-4 rounded-lg border border-white/[0.07] bg-black/12 p-3">
          <ConfluenceMeter axes={model.confluenceAxes} compact forceShow />
        </div>
      )}

      <div className={cn('mt-5 grid gap-3', showDetails ? 'md:grid-cols-3' : 'grid-cols-1')}>
        <ReasonList title="긍정 요인" items={model.positiveDrivers} tone="green" limit={isSimple ? 1 : 3} />
        {showDetails && <ReasonList title="리스크 요인" items={model.riskDrivers} tone="red" limit={3} />}
        <ReasonList title="차단 사유" items={model.blockedReasons} tone="amber" limit={isSimple ? 2 : 5} />
      </div>

      {hasAiWarning && (
        <div className="mt-3 rounded-lg border border-violet-400/20 bg-violet-400/[0.06] px-3 py-2 text-[11px] font-bold text-violet-100/80">
          이 판단에는 AI 추정 근거가 포함됩니다. 실매매 전 계산 데이터를 확인하세요.
        </div>
      )}
      {hasMissingWarning && (
        <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-[11px] font-bold text-amber-100/80">
          데이터 신뢰도가 완전히 검증되지 않았습니다. 공급자 이슈는 marketSignal과 분리됩니다.
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.018] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-tight text-white/40"><Ban className="h-3 w-3" />실매매 집행</div>
          <div className={cn('mt-1 text-xs font-black', model.liveExecutionAllowed ? 'text-emerald-200' : 'text-amber-200')}>{executionText(model)}</div>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.018] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-tight text-white/40"><ShieldCheck className="h-3 w-3" />Shadow</div>
          <div className="mt-1 text-xs font-black text-violet-200">{model.shadowTrackingStatus}</div>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.018] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-tight text-white/40"><Activity className="h-3 w-3" />영향</div>
          <div className="mt-1 truncate text-xs font-black text-white/75" title={model.executionImpact}>{model.executionImpact}</div>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.018] px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-tight text-white/40"><Timer className="h-3 w-3" />다음 조치</div>
          <div className="mt-1 truncate text-xs font-black text-white/75" title={model.nextAction.join(' / ')}>{model.nextAction[0] ?? 'WATCH'}</div>
        </div>
      </div>

      {showDetails && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold tracking-tight text-white/40">
          <span>데이터 신뢰</span>
          <DataConfidenceBadge confidence="VERIFIED" label={`VERIFIED ${model.dataConfidence.calculatedIndicatorCount}`} compact showTooltip={false} />
          <DataConfidenceBadge confidence="AI_ESTIMATED" label={`AI ${model.dataConfidence.aiEstimatedIndicatorCount}`} compact />
          <DataConfidenceBadge confidence="MISSING" label={`MISSING ${model.dataConfidence.missingIndicatorCount}`} compact />
          <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />marketSignal=false</span>
          <span className="inline-flex items-center gap-1"><TrendingUp className="h-3 w-3" />engine={model.engineMode}</span>
        </div>
      )}
    </section>
  );
}
