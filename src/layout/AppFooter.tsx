import React from 'react';
import { Info } from 'lucide-react';

export function AppFooter() {
  return (
    <footer className="mt-16 sm:mt-20 pt-8 sm:pt-12 pb-16 sm:pb-20 border-t border-theme-border/50 text-center">
      <div className="flex items-center justify-center gap-3 text-theme-text-muted text-xs mb-4 sm:mb-6 px-4">
        <Info className="w-4 h-4 shrink-0" />
        <span className="font-medium leading-relaxed">본 정보는 AI 분석 결과이며 투자 권유가 아닙니다. 모든 투자의 책임은 본인에게 있습니다.</span>
      </div>
      <p className="text-theme-text-muted/50 text-[10px] uppercase tracking-[0.3em] font-bold">
        Powered by Google Gemini & Master Framework Engine
      </p>
      <p className="text-[9px] text-theme-text-muted/25 mt-4 font-medium">
        &copy; 2026 K-Stock AI Analysis System. All rights reserved.
      </p>
    </footer>
  );
}
