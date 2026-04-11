import React, { useMemo } from 'react';
import { Gate0Result, ContrarianSignal } from '../../types/quant';
import { computeContrarianSignals } from '../../services/quantEngine';

interface Props {
  gate0Result?: Gate0Result;
}

export function ContrarianSection({ gate0Result }: Props) {
  const signals: ContrarianSignal[] = useMemo(() => {
    if (!gate0Result) return [];
    return computeContrarianSignals(
      undefined,
      gate0Result.fxRegime,
      0,
      0,
      '',
    );
  }, [gate0Result]);

  return (
    <div className="p-4 sm:p-8 border border-theme-text bg-theme-card shadow-[4px_4px_0px_0px_rgba(128,128,128,0.3)]">
      <div className="mb-6">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
          Contrarian Counter-Cycle Engine — 역발상 카운터사이클
        </h3>
        <p className="text-[9px] font-mono text-theme-text-muted mt-1">
          거시 악재가 특정 섹터의 매수 신호가 되는 역설을 기계적으로 시스템화
        </p>
      </div>

      <div className="space-y-3">
        {[
          {
            id: 'RECESSION_DEFENSE',
            name: '침체기 방산 역발상',
            description: '경기 RECESSION 레짐 → 정부 방산 예산 확대 기대 → 방산주 Gate 3 +5pt',
            condition: '경기 레짐: RECESSION + 대상 섹터: 방산·방위산업',
            bonus: 5,
            triggerColor: 'border-green-500 bg-green-50 text-green-700',
            idleColor: 'border-theme-border bg-theme-bg text-theme-text-muted',
          },
          {
            id: 'DOLLAR_STRONG_HEALTHCARE',
            name: '달러강세 헬스케어 역발상',
            description: '달러 강세 + 수출 둔화 → 내수 헬스케어 상대적 수혜 → Gate 3 +3pt',
            condition: 'FX 레짐: DOLLAR_STRONG + 수출증가율 < 0 + 대상 섹터: 헬스케어·바이오',
            bonus: 3,
            triggerColor: 'border-blue-500 bg-blue-50 text-blue-700',
            idleColor: 'border-theme-border bg-theme-bg text-theme-text-muted',
          },
          {
            id: 'VIX_FEAR_PEAK',
            name: 'VIX 공포 극점 역발상',
            description: 'VIX ≥ 35 공포 극점 → 통계적 과매도 → 전 섹터 Gate 3 +3pt',
            condition: 'VIX ≥ 35 (공황 수준 공포 지수)',
            bonus: 3,
            triggerColor: 'border-purple-500 bg-purple-50 text-purple-700',
            idleColor: 'border-theme-border bg-theme-bg text-theme-text-muted',
          },
        ].map(signal => {
          const matched = signals.find(s => s.id === signal.id);
          const isActive = matched?.active ?? false;
          return (
            <div
              key={signal.id}
              className={`p-5 border-2 ${isActive ? signal.triggerColor : signal.idleColor}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[9px] font-black px-2 py-0.5 border ${
                      isActive ? 'border-current bg-theme-card bg-opacity-50' : 'border-theme-border bg-theme-card'
                    }`}>
                      {isActive ? '▶ 발동' : '— 미발동'}
                    </span>
                    <span className="text-xs font-black">{signal.name}</span>
                  </div>
                  <p className="text-[10px] leading-relaxed opacity-80">{signal.description}</p>
                  <p className="text-[9px] font-mono mt-1 opacity-60">조건: {signal.condition}</p>
                </div>
                <div className="text-center flex-shrink-0">
                  <p className="text-[9px] font-black opacity-60 uppercase tracking-widest">보너스</p>
                  <p className={`text-2xl font-black font-mono ${isActive ? '' : 'opacity-30'}`}>
                    +{signal.bonus}
                  </p>
                  <p className="text-[8px] opacity-60">pt</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 p-3 bg-theme-bg border border-theme-border">
        <p className="text-[9px] text-theme-text-muted font-mono">
          ※ 역발상 신호는 종목 평가 시 섹터·VIX·FX 레짐 정보가 입력된 경우 자동 발동됩니다.
          Macro Intelligence 탭은 현재 게이트 환경만 표시합니다.
        </p>
      </div>
    </div>
  );
}
