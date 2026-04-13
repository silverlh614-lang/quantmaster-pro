import React, { useState } from 'react';
import { cn } from '../ui/cn';

type AnalysisView = 'STANDARD' | 'QUANT';

interface AnalysisViewToggleProps {
  children: (analysisView: AnalysisView, setAnalysisView: (v: AnalysisView) => void) => React.ReactNode;
}

export const AnalysisViewToggle: React.FC<AnalysisViewToggleProps> = ({ children }) => {
  const [analysisView, setAnalysisView] = useState<AnalysisView>('STANDARD');
  return <>{children(analysisView, setAnalysisView)}</>;
};

export const AnalysisViewButtons: React.FC<{
  analysisView: AnalysisView;
  setAnalysisView: (v: AnalysisView) => void;
}> = ({ analysisView, setAnalysisView }) => (
  <div className="flex bg-white/5 p-1 rounded-full border border-white/10 backdrop-blur-md shadow-2xl mr-2">
    <button
      onClick={() => setAnalysisView('STANDARD')}
      className={cn(
        "px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all",
        analysisView === 'STANDARD' ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
      )}
    >
      Standard
    </button>
    <button
      onClick={() => setAnalysisView('QUANT')}
      className={cn(
        "px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all",
        analysisView === 'QUANT' ? "bg-white text-black shadow-lg" : "text-white/40 hover:text-white"
      )}
    >
      Quant View
    </button>
  </div>
);
