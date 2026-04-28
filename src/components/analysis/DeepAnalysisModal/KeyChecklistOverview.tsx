// @responsibility DeepAnalysisModal 핵심 체크리스트 4그룹 현황 sub-component (cc 분해)
import { CheckSquare, CheckCircle2 } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { MASTER_CHECKLIST_STEPS } from '../../../constants/checklist';
import type { StockRecommendation } from '../../../services/stockService';

const KEY_CHECKLIST_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: '성장성 (Growth)', keys: ['roeType3', 'earningsSurprise', 'performanceReality', 'ocfQuality', 'marginAcceleration'] },
  { label: '기술적 분석 (Technical)', keys: ['momentumRanking', 'ichimokuBreakout', 'technicalGoldenCross', 'volumeSurgeVerified', 'turtleBreakout'] },
  { label: '수급 (Supply)', keys: ['supplyInflow', 'institutionalBuying', 'consensusTarget'] },
  { label: '시장 주도력 (Market)', keys: ['cycleVerified', 'riskOnEnvironment', 'notPreviousLeader', 'policyAlignment'] },
];

interface KeyChecklistOverviewProps {
  stock: StockRecommendation;
}

export function KeyChecklistOverview({ stock }: KeyChecklistOverviewProps) {
  return (
    <div className="glass-3d rounded-2xl p-5 sm:p-6 border border-white/10">
      <div className="flex items-center gap-2.5 mb-4">
        <CheckSquare className="w-5 h-5 text-green-400" />
        <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.25em]">
          핵심 체크리스트 현황
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
        {KEY_CHECKLIST_GROUPS.map((group, gIdx) => (
          <ChecklistGroup key={gIdx} group={group} stock={stock} />
        ))}
      </div>
    </div>
  );
}

interface ChecklistGroupProps {
  group: { label: string; keys: string[] };
  stock: StockRecommendation;
}

function ChecklistGroup({ group, stock }: ChecklistGroupProps) {
  return (
    <div className="space-y-1.5">
      <h5 className="text-[10px] font-black text-white/25 uppercase tracking-widest mb-2 border-b border-white/5 pb-1.5">
        {group.label}
      </h5>
      {group.keys.map((key) => (
        <ChecklistRow key={key} keyId={key} stock={stock} />
      ))}
    </div>
  );
}

interface ChecklistRowProps {
  keyId: string;
  stock: StockRecommendation;
}

function ChecklistRow({ keyId, stock }: ChecklistRowProps) {
  const step = MASTER_CHECKLIST_STEPS.find((s) => s.key === keyId);
  const isPassed = stock.checklist?.[keyId as keyof StockRecommendation['checklist']];
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn(
          'w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0',
          isPassed ? 'bg-green-500/20 border-green-500/30' : 'bg-white/5 border-white/10 opacity-30'
        )}
      >
        {isPassed && <CheckCircle2 className="w-2.5 h-2.5 text-green-400" />}
      </div>
      <span
        className={cn(
          'text-[11px] font-bold transition-colors truncate',
          isPassed ? 'text-white/80' : 'text-white/20'
        )}
      >
        {step?.title.split(' (')[0]}
      </span>
    </div>
  );
}
