import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { EvaluationResult } from '../../types/quant';

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
          <h2 className="col-header">EUPHORIA DETECTOR</h2>
        </div>
        <div className="flex gap-2 mb-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className={`h-8 flex-1 border border-theme-text ${i <= result.euphoriaLevel ? 'bg-orange-500' : 'bg-gray-100'}`}
            />
          ))}
        </div>
        <p className="text-xs font-mono uppercase tracking-widest">
          {result.euphoriaLevel >= 3
            ? 'WARNING: OVERHEAT DETECTED - PROFIT TAKING RECOMMENDED'
            : 'STABLE: NO EUPHORIA DETECTED'}
        </p>
      </div>

      {/* Emergency Stop */}
      <div className={`p-6 border border-theme-text ${result.emergencyStop ? 'bg-red-600 text-white' : 'bg-white'}`}>
        <div className="flex items-center gap-2 mb-6">
          <AlertTriangle className={`w-5 h-5 ${result.emergencyStop ? 'text-white' : 'text-red-600'}`} />
          <h2 className={`col-header ${result.emergencyStop ? 'text-white' : ''}`}>EMERGENCY STOP</h2>
        </div>
        <p className="text-2xl font-black italic uppercase mb-2">
          {result.emergencyStop ? 'SYSTEM HALTED' : 'SYSTEM OPERATIONAL'}
        </p>
        <p className="text-xs opacity-70 font-mono">
          {result.emergencyStop
            ? 'BLACK SWAN EVENT DETECTED. ALL POSITIONS PROTECTED.'
            : 'NO CRITICAL MARKET ANOMALIES DETECTED.'}
        </p>
      </div>
    </div>
  );
}
