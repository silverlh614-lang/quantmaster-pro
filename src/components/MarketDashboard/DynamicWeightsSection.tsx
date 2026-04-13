import React from 'react';
import { Zap, Info } from 'lucide-react';
import { cn } from '../../ui/cn';
import { debugWarn } from '../../utils/debug';

const CONDITION_NAMES: Record<number, string> = {
  1: '주도주 사이클', 2: '모멘텀', 3: 'ROE 유형 3', 4: '수급 질', 5: '시장 환경',
  6: '일목균형표', 7: '손절 설정', 8: '경제적 해자', 9: '신규 주도주', 10: '기술적 정배열',
  11: '거래량', 12: '기관/외인 수급', 13: '목표가 여력', 14: '실적 서프라이즈', 15: '실체적 펀더멘털',
  16: '정책/매크로', 17: '심리적 객관성', 18: '터틀 돌파', 19: '피보나치', 20: '엘리엇 파동',
  21: '이익의 질', 22: '마진 가속도', 23: '재무 방어력', 24: '상대강도 RS', 25: 'VCP',
  26: '다이버전스', 27: '촉매제',
};

interface DynamicWeightsSectionProps {
  weights?: Record<number, number>;
}

export const DynamicWeightsSection: React.FC<DynamicWeightsSectionProps> = React.memo(({ weights }) => {
  if (!weights || Object.keys(weights).length === 0) {
    debugWarn('DynamicWeightsSection: weights 데이터 없음');
    return null;
  }

  return (
    <div className="glass-3d p-10 rounded-[3rem] border border-white/10 shadow-2xl">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h3 className="text-xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
            <Zap className="w-6 h-6 text-yellow-400" />
            AI 동적 가중치 전략 (Dynamic Weighting)
          </h3>
          <p className="text-xs font-bold text-white/30 uppercase tracking-widest mt-2">AI-Driven Adaptive Scoring Strategy</p>
        </div>
        <div className="px-4 py-2 bg-yellow-400/10 border border-yellow-400/20 rounded-2xl">
          <span className="text-[10px] font-black text-yellow-400 uppercase tracking-widest">실시간 최적화 적용 중</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
        {Object.entries(weights).map(([id, multiplier]) => (
          <div key={id} className="bg-white/5 p-6 rounded-3xl border border-white/5 flex flex-col gap-3 group hover:bg-white/10 transition-all">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">ID {id}</span>
              <div className={cn(
                "w-2 h-2 rounded-full",
                multiplier > 1.0 ? "bg-red-500 animate-pulse" : multiplier < 1.0 ? "bg-blue-500" : "bg-gray-500"
              )} />
            </div>
            <span className="text-sm font-black text-white/80 truncate">{CONDITION_NAMES[Number(id)] || `조건 ${id}`}</span>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-black text-white tracking-tighter">x{multiplier.toFixed(1)}</span>
              <span className={cn(
                "text-[10px] font-black mb-1",
                multiplier > 1.0 ? "text-red-400" : multiplier < 1.0 ? "text-blue-400" : "text-white/20"
              )}>
                {multiplier > 1.0 ? '↑ 상향' : multiplier < 1.0 ? '↓ 하향' : '유지'}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 p-6 bg-indigo-500/10 border border-indigo-500/20 rounded-[2rem] flex items-start gap-4">
        <Info className="w-5 h-5 text-indigo-400 mt-1 shrink-0" />
        <p className="text-sm font-medium text-indigo-200/70 leading-relaxed">
          AI가 현재 시장의 변동성, 금리, 환율 및 섹터 순환 데이터를 분석하여 퀀트 엔진의 가중치를 실시간으로 조정합니다.
          상승장 초기에는 모멘텀 가중치를 높이고, 변동성 확대 시에는 리스크 관리 지표의 비중을 자동으로 강화하여 수익률을 극대화합니다.
        </p>
      </div>
    </div>
  );
});
