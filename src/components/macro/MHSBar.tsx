// @responsibility macro 영역 MHSBar 컴포넌트
export function MHSBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-green-600' : score >= 40 ? 'bg-amber-500' : 'bg-red-600';
  const label = score >= 70 ? '정상 운용' : score >= 40 ? `MAPC Kelly ${score}% 운용` : '매수 중단';
  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">Macro Health Score (MHS)</span>
        <span className="text-sm font-black font-mono">{score} / 100 — {label}</span>
      </div>
      <div className="h-4 w-full bg-theme-card border border-theme-text relative">
        <div
          className={`h-full ${color} transition-all duration-700`}
          style={{ width: `${Math.min(100, score)}%` }}
        />
        {[40, 70].map(threshold => (
          <div
            key={threshold}
            className="absolute top-0 bottom-0 w-px bg-theme-text opacity-40"
            style={{ left: `${threshold}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-red-500 font-black">0 매수중단</span>
        <span className="text-[8px] text-amber-500 font-black ml-[30%]">40 Kelly축소</span>
        <span className="text-[8px] text-green-500 font-black ml-auto">70 정상 100</span>
      </div>
    </div>
  );
}
