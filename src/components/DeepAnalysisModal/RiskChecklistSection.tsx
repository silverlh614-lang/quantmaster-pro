import React from 'react';
import { AlertTriangle, AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { MASTER_CHECKLIST_STEPS, SELL_CHECKLIST_STEPS } from '../../constants/checklist';
import type { StockRecommendation } from '../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function RiskChecklistSection({ stock }: Props) {
  return (
    <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-red-500/5 rounded-[2.5rem] p-6 border border-red-500/10">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <h3 className="text-lg font-black text-white uppercase tracking-tight">Risk Factors</h3>
        </div>
        <ul className="space-y-4">
          {(stock.riskFactors || []).map((risk, idx) => (
            <li key={idx} className="flex items-start gap-4 p-4 rounded-2xl bg-white/5 border border-white/5 group/risk hover:bg-red-500/5 transition-all">
              <div className="w-8 h-8 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0 border border-red-500/20 group-hover/risk:scale-110 transition-transform">
                <AlertCircle className="w-4 h-4 text-red-400" />
              </div>
              <span className="text-sm text-white/70 font-bold leading-relaxed pt-1">
                {risk}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-green-500/5 rounded-[2.5rem] p-6 border border-green-500/10 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-black text-white uppercase tracking-tight">27-Step Master Checklist</h3>
        </div>
        <div className="flex items-center gap-4 mb-6">
          <div className="text-4xl font-black text-green-400">
            {Object.values(stock?.checklist || {}).filter(Boolean).length}
            <span className="text-xl text-green-400/30">/27</span>
          </div>
          <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden border border-white/5">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(Object.values(stock?.checklist || {}).filter(Boolean).length / 27) * 100}%` }}
              className="h-full bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar max-h-[320px] space-y-6">
          {[1, 2, 3].map(gateNum => (
            <div key={gateNum} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-orange-500/50 uppercase tracking-widest">Gate {gateNum}</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid grid-cols-1 gap-2">
                {MASTER_CHECKLIST_STEPS.filter(s => s.gate === gateNum).map((step) => {
                  const value = stock.checklist ? stock.checklist[step.key as keyof typeof stock.checklist] : 0;
                  return (
                    <div key={step.key} className="group/item relative flex flex-col gap-1.5 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all cursor-help">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-white/70">
                            {step.title}
                          </span>
                          <Info className="w-3 h-3 text-white/20 group-hover/item:text-orange-500 transition-colors" />
                        </div>
                        {value ? (
                          <div className="flex items-center gap-1.5 text-green-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black uppercase">Pass</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-white/20">
                            <X className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black uppercase">Fail</span>
                          </div>
                        )}
                      </div>
                      <p className="text-[9px] text-white/40 font-medium leading-relaxed max-h-0 overflow-hidden group-hover/item:max-h-20 transition-all duration-300">
                        {step.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sell Checklist in Deep Analysis */}
          <div className="space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-red-500/50 uppercase tracking-widest">Sell Checklist</span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
            <div className="grid grid-cols-1 gap-2">
              {SELL_CHECKLIST_STEPS.map((step, i) => (
                <div key={i} className="flex flex-col gap-1.5 p-3 rounded-xl bg-red-500/[0.02] border border-red-500/10 hover:bg-red-500/[0.05] transition-all">
                  <div className="flex items-center gap-2">
                    <step.icon className="w-3 h-3 text-red-400/50" />
                    <span className="text-[11px] font-bold text-white/70">{step.title}</span>
                  </div>
                  <p className="text-[9px] text-white/40 font-medium leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-[10px] text-white/40 font-bold leading-relaxed mt-6 pt-4 border-t border-white/10">
          마스터 체크리스트는 시장 사이클, 수급, 펀더멘털, 기술적 지표 및 심리적 요인을 종합적으로 검증합니다. 15개 이상 통과 시 '강력 매수' 신호로 간주됩니다.
        </p>
      </div>
    </div>
  );
}
