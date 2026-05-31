// @responsibility analysis 영역 RiskAlertSection 컴포넌트
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EvaluationResult } from '../../../types/quant';

interface Props {
  result: EvaluationResult;
}

export function RiskAlertSection({ result }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* Euphoria Detector */}
      <div className="p-6 border border-theme-text bg-white">
        <div className="flex items-center gap-2 mb-6">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h2 className="col-header">과열 탐지기</h2>
        </div>
        <div className="flex gap-2 mb-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className={`h-8 flex-1 border border-theme-text ${i <= result.euphoriaLevel ? 'bg-orange-500' : 'bg-gray-100'}`}
            />
          ))}
        </div>
        <p className="text-xs font-mono tracking-tight">
          {result.euphoriaLevel >= 3
            ? '경고: 과열 감지됨 - 차익 실현 권장'
            : '안정: 과열 신호 없음'}
        </p>
      </div>

      {/* Emergency Stop */}
      <div className={`p-6 border border-theme-text ${result.emergencyStop ? 'bg-red-600 text-white' : 'bg-white'}`}>
        <div className="flex items-center gap-2 mb-6">
          <AlertTriangle className={`w-5 h-5 ${result.emergencyStop ? 'text-white' : 'text-red-600'}`} />
          <h2 className={`col-header ${result.emergencyStop ? 'text-white' : ''}`}>비상 정지</h2>
        </div>
        <p className="text-2xl font-black italic uppercase mb-2">
          {result.emergencyStop ? '시스템 중단됨' : '시스템 정상 작동'}
        </p>
        <p className="text-xs opacity-70 font-mono">
          {result.emergencyStop
            ? '블랙스완 이벤트 감지됨. 모든 포지션 보호됨.'
            : '중대한 시장 이상 징후 없음.'}
        </p>
      </div>
    </div>
  );
}
