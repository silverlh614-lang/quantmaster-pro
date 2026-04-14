import React from 'react';
import { Shield, Layers, Zap } from 'lucide-react';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
}

export function GatePyramid({ result }: Props) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
      {/* Gate 1 */}
      <div className={`p-8 border border-theme-text relative ${result.gate1Passed ? 'bg-white' : 'bg-red-50'}`}>
        <div className="absolute -top-3 left-4 bg-theme-bg px-2 text-[10px] font-black uppercase tracking-widest">Gate 1: Survival</div>
        <div className="flex justify-between items-center mb-6">
          <Shield className={`w-8 h-8 ${result.gate1Passed ? 'text-green-600' : 'text-red-600'}`} />
          <span className="data-value text-2xl font-bold">{result.gate1Passed ? 'PASSED' : 'FAILED'}</span>
        </div>
        <div className="space-y-4">
          <p className="text-xs italic opacity-70">"살아있는 종목의 최소 조건"</p>
          <div className="h-2 w-full bg-gray-200 border border-theme-text">
            <div className="h-full bg-theme-text" style={{ width: result.gate1Passed ? '100%' : '40%' }}></div>
          </div>
          <p className="text-[10px] font-mono">SCORE: {result.gate1Score.toFixed(1)}</p>
        </div>
      </div>

      {/* Gate 2 */}
      <div className={`p-8 border border-theme-text relative ${result.gate2Passed ? 'bg-white' : 'bg-gray-100 opacity-50'}`}>
        <div className="absolute -top-3 left-4 bg-theme-bg px-2 text-[10px] font-black uppercase tracking-widest">Gate 2: Growth</div>
        <div className="flex justify-between items-center mb-6">
          <Layers className="w-8 h-8 text-blue-600" />
          <span className="data-value text-2xl font-bold">{result.gate2Passed ? 'VERIFIED' : 'PENDING'}</span>
        </div>
        <div className="space-y-4">
          <p className="text-xs italic opacity-70">"성장성 및 펀더멘털 검증"</p>
          <div className="h-2 w-full bg-gray-200 border border-theme-text">
            <div className="h-full bg-theme-text" style={{ width: `${Math.min(100, (result.gate2Score / 100) * 100)}%` }}></div>
          </div>
          <p className="text-[10px] font-mono">SCORE: {result.gate2Score.toFixed(1)}</p>
        </div>
      </div>

      {/* Gate 3 */}
      <div className={`p-8 border border-theme-text relative ${result.gate3Passed ? 'bg-white' : 'bg-gray-100 opacity-50'}`}>
        <div className="absolute -top-3 left-4 bg-theme-bg px-2 text-[10px] font-black uppercase tracking-widest">Gate 3: Timing</div>
        <div className="flex justify-between items-center mb-6">
          <Zap className={`w-8 h-8 ${result.lastTrigger ? 'text-orange-500 animate-pulse' : 'text-gray-400'}`} />
          <span className="data-value text-2xl font-bold">{result.lastTrigger ? 'TRIGGERED' : 'WAITING'}</span>
        </div>
        <div className="space-y-4">
          <p className="text-xs italic opacity-70">"정밀 진입 타이밍 및 배팅 사이즈"</p>
          <div className="h-2 w-full bg-gray-200 border border-theme-text">
            <div className="h-full bg-theme-text" style={{ width: `${Math.min(100, (result.gate3Score / 100) * 100)}%` }}></div>
          </div>
          <p className="text-[10px] font-mono">SCORE: {result.gate3Score.toFixed(1)}</p>
        </div>
      </div>
    </div>
  );
}
