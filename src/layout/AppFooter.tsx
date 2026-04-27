// @responsibility AppFooter 레이아웃 컴포넌트
import React from 'react';
import { Info } from 'lucide-react';

export function AppFooter() {
  return (
    <footer className="mt-16 sm:mt-20 pt-8 sm:pt-12 pb-16 sm:pb-20 border-t border-white/[0.04] text-center relative">
      {/* Gradient glow above footer */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[200px] h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

      <div className="flex items-center justify-center gap-3 text-theme-text-muted text-xs mb-4 sm:mb-6 px-4">
        <Info className="w-4 h-4 shrink-0 text-blue-400/40" />
        <span className="font-medium leading-relaxed">본 정보는 AI 분석 결과이며 투자 권유가 아닙니다. 모든 투자의 책임은 본인에게 있습니다.</span>
      </div>
      <p className="text-[9px] text-theme-text-muted/25 mt-4 font-medium">
        &copy; 2026 K-Stock AI Analysis System. All rights reserved.
      </p>
    </footer>
  );
}
