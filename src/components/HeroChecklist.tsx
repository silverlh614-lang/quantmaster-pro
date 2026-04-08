import React, { useState } from 'react';
import { ShieldCheck, ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';


interface ChecklistStep {
  key: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  gate: number;
}

interface HeroChecklistProps {
  steps: ChecklistStep[];
  onShowChecklist: () => void;
}

export const HeroChecklist: React.FC<HeroChecklistProps> = ({ steps, onShowChecklist }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-12">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 px-6 py-3 bg-white/5 hover:bg-white/10 rounded-2xl border border-white/10 transition-all group/toggle mb-6"
      >
        <ShieldCheck className={cn("w-5 h-5 text-orange-500 transition-transform", expanded ? "rotate-180" : "")} />
        <span className="text-sm font-black text-white/60 uppercase tracking-widest">27단계 마스터 체크리스트 보기</span>
        <ChevronDown className={cn("w-4 h-4 text-white/20 group-hover/toggle:text-orange-500 transition-transform", expanded ? "rotate-180" : "")} />
      </button>

      <>
        {expanded && (
          <div
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-4 pb-6">
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 bg-white/5 px-5 py-3 rounded-2xl border border-white/10 shadow-lg hover:bg-white/10 hover:border-orange-500/30 transition-all cursor-help group/step active:scale-95"
                  onClick={onShowChecklist}
                >
                  <div className="w-8 h-8 rounded-xl bg-orange-500/10 flex items-center justify-center group-hover/step:bg-orange-500/20 transition-colors">
                    <step.icon className="w-4 h-4 text-orange-500 group-hover/step:scale-110 transition-transform" />
                  </div>
                  <span className="text-xs font-black uppercase tracking-tight text-white/40 group-hover/step:text-white/80 transition-colors">
                    {step.title.split(' (')[0]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </>
    </div>
  );
};
