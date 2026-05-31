// @responsibility 분할매수 진입 레벨 브레이크다운 — 가격 전략 공용 컴팩트 표시(regime 가중).
import React from 'react';
import type { TranchePlanResult } from '../../utils/priceStrategy';

/** 1·2·3차 진입가 + 비중(regime 가중) 컴팩트 표시. 단일 진입(되돌림 여력 없음)이면 null. */
export function TrancheBreakdown({ plan }: { plan: TranchePlanResult | null }) {
  if (!plan || !plan.multiTranche) return null;
  return (
    <div className="mt-2 rounded-lg border border-violet-400/15 bg-violet-400/[0.05] px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[9px] font-semibold tracking-tight text-violet-300/70">
          분할매수 ({plan.regimeLabel})
        </span>
        <span className="text-[9px] font-bold text-white/35">
          구간 ₩{plan.zoneLow.toLocaleString()}~{plan.zoneHigh.toLocaleString()}
        </span>
      </div>
      <div className="space-y-1">
        {plan.levels.map((l, i) => (
          <div key={i} className="flex items-center gap-2 text-[10px]">
            <span className="w-5 shrink-0 font-black text-white/45">{i + 1}차</span>
            <span className="w-16 shrink-0 font-num font-black text-white/85">₩{l.price.toLocaleString()}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full bg-violet-400/60" style={{ width: `${l.weight}%` }} />
            </div>
            <span className="w-8 shrink-0 text-right font-num font-bold text-violet-300/80">{l.weight}%</span>
            <span className="hidden w-20 shrink-0 truncate text-white/35 sm:inline">{l.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
