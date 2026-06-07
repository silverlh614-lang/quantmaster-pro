// @responsibility analysis 영역 RiskChecklistSection 컴포넌트
import React from 'react';
import { AlertTriangle, AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../../ui/cn';
import { MASTER_CHECKLIST_STEPS, SELL_CHECKLIST_STEPS } from '../../../constants/checklist';
import { buildStockAnalysisCanon, conditionView } from '../../../services/stock/stockAnalysisCanon';
import type { StockRecommendation } from '../../../services/stockService';

interface Props {
  stock: StockRecommendation;
}

export function RiskChecklistSection({ stock }: Props) {
  // 분석 표시 정본(SSOT) — 과거 truthy 카운트(filter(Boolean)=27/27 전부 PASS)가 레이더·
  // 점수카드(검증 5)와 어긋나던 문제 제거. 검증/AI추정/미달 3-상태로 통일.
  const canon = buildStockAnalysisCanon(stock);
  // ADR-0582: 3-구분 — 검증 / AI(검증가능 미수집) / 정성-AI(분모 제외).
  const aiFallbackMet = Math.max(0, canon.metCount - canon.verifiedPassCount - canon.intrinsicAiMetCount);
  const evalFail = Math.max(0, canon.evaluableCount - canon.verifiedPassCount - aiFallbackMet);
  return (
    <div className="lg:col-span-12 grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-red-500/5 rounded-2xl p-6 border border-red-500/10">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <h3 className="text-lg font-black text-white uppercase tracking-tight">리스크 요인</h3>
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

      <div className="bg-green-500/5 rounded-2xl p-6 border border-green-500/10 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-black text-white tracking-tight">27단계 마스터 체크리스트</h3>
        </div>
        <div className="flex items-center gap-4 mb-2">
          <div className="text-4xl font-black text-green-400">
            {canon.verifiedPassCount}
            <span className="text-xl text-white/30">/{canon.evaluableCount}</span>
          </div>
          {/* 검증 가능 분모 기준 누적: 검증(green) + AI 검증가능 미수집(amber). 나머지(회색)=미달. */}
          <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden border border-white/5 flex" title={`검증 ${canon.verifiedPassCount} · AI(검증가능 미수집) ${aiFallbackMet} · 미달 ${evalFail} · 정성-AI ${canon.intrinsicAiCount}(분모 제외)`}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${canon.evaluableCount ? (canon.verifiedPassCount / canon.evaluableCount) * 100 : 0}%` }}
              className="h-full bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)]"
            />
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${canon.evaluableCount ? (aiFallbackMet / canon.evaluableCount) * 100 : 0}%` }}
              className="h-full bg-amber-500/70"
            />
          </div>
        </div>
        <p className="text-[10px] font-bold text-white/40 mb-6">
          검증 {canon.verifiedPassCount}/{canon.evaluableCount}
          <span className="text-amber-400/70"> · AI 검증가능 {aiFallbackMet}</span>
          <span className="text-violet-300/70"> · 정성-AI {canon.intrinsicAiMetCount}/{canon.intrinsicAiCount}(점수 제외)</span>
        </p>

        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar max-h-[320px] space-y-6">
          {[1, 2, 3].map(gateNum => (
            <div key={gateNum} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-orange-500/50 tracking-tight">Gate {gateNum}</span>
                <div className="h-px flex-1 bg-white/5" />
              </div>
              <div className="grid grid-cols-1 gap-2">
                {MASTER_CHECKLIST_STEPS.filter(s => s.gate === gateNum).map((step) => {
                  const view = conditionView(stock, step.key);
                  const status = view.status;
                  const intrinsic = view.verifiability === 'AI_INTRINSIC';
                  return (
                    <div
                      key={step.key}
                      className="group/item relative flex flex-col gap-1.5 p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-all cursor-help"
                      title={status === 'VERIFIED_PASS' ? '검증 통과 — 실데이터(DART/KRX/계산)' : intrinsic ? '정성-AI — 시장 데이터로 검증 불가 (점수 분모 제외)' : status === 'AI_PASS' ? 'AI 추정 통과 — 검증 가능하나 데이터 미수집(L4)' : '미달'}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-white/70">
                            {step.title}
                          </span>
                          <Info className="w-3 h-3 text-white/20 group-hover/item:text-orange-500 transition-colors" />
                        </div>
                        {status === 'VERIFIED_PASS' ? (
                          <div className="flex items-center gap-1.5 text-green-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black">검증</span>
                          </div>
                        ) : intrinsic ? (
                          <div className="flex items-center gap-1.5 text-violet-300">
                            <Info className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black">{status === 'AI_PASS' ? '정성-AI' : '정성-AI(미달)'}</span>
                          </div>
                        ) : status === 'AI_PASS' ? (
                          <div className="flex items-center gap-1.5 text-amber-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black">AI 추정</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-white/20">
                            <X className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-black">미달</span>
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
              <span className="text-[10px] font-black text-red-500/50 tracking-tight">매도 체크리스트</span>
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

        <p className="text-[10px] text-white/40 font-bold leading-relaxed mt-6 pt-4 border-t border-white/[0.07]">
          <span className="text-green-400">🟢 검증</span>=실데이터(DART·KRX·계산) 확인 · <span className="text-amber-400">🟡 AI 추정</span>=검증 가능하나 데이터 미수집(L4) · <span className="text-violet-300">🟣 정성-AI</span>=촉매·심리·엘리엇 등 본질적 정성 영역(데이터 검증 불가 → 최종 점수 분모에서 제외). 최종 점수는 '검증 가능 항목 중 검증된 비율'입니다.
        </p>
      </div>
    </div>
  );
}
