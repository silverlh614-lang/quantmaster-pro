import React from 'react';
import { Target, Globe } from 'lucide-react';
import { cn } from '../../../ui/cn';
import type { EvaluationResult } from '../../../types/quant';

type DashboardTab = 'QUANT' | 'MACRO';

interface Props {
  result: EvaluationResult;
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

export function DashboardHeader({ result, activeTab, onTabChange }: Props) {
  return (
    <>
      <header className="mb-8 border-b border-theme-border pb-4 flex justify-between items-end">
        <div>
          <h1 className="text-fluid-4xl font-serif italic tracking-tight">Living Quant System</h1>
          <p className="col-header mt-2">27-Condition Hierarchical Analysis Engine</p>
        </div>
        <div className="text-right">
          <p className="data-value text-sm">REGIME: BULLISH START</p>
          <p className="data-value text-sm">PROFILE: {result.profile.type}</p>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="flex gap-0 mb-10 border-b-2 border-theme-text">
        {([
          { id: 'QUANT', label: 'QUANT ANALYSIS', icon: <Target size={14} /> },
          { id: 'MACRO', label: 'MACRO INTELLIGENCE', icon: <Globe size={14} /> },
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'flex items-center gap-2 px-6 py-3 text-[11px] font-black uppercase tracking-widest border-2 border-b-0 transition-all',
              activeTab === tab.id
                ? 'bg-theme-text text-theme-bg border-theme-text'
                : 'bg-theme-bg text-theme-text border-theme-text hover:bg-theme-card'
            )}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>
    </>
  );
}
