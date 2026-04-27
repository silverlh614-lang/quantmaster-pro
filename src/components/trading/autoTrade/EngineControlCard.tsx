// @responsibility trading 영역 EngineControlCard 컴포넌트
import React from 'react';
import { Activity, Power, TrendingUp, Zap } from 'lucide-react';
import { cn } from '../../../ui/cn';
import { Card } from '../../../ui/card';
import { Badge } from '../../../ui/badge';
import type { EngineStatus } from '../../../api';

interface Props {
  engineStatus: EngineStatus | null;
  toggling: boolean;
  onToggle: () => void;
}

export function EngineControlCard({ engineStatus, toggling, onToggle }: Props) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center',
            engineStatus?.running ? 'bg-green-500/20' : 'bg-red-500/20'
          )}>
            <Power className={cn('w-5 h-5', engineStatus?.running ? 'text-green-400' : 'text-red-400')} />
          </div>
          <div>
            <span className="text-sm font-black text-theme-text">자동매매 엔진</span>
            <div className="flex items-center gap-3 text-[10px] text-theme-text-muted mt-0.5">
              {engineStatus?.lastScanAt && (
                <span>마지막 스캔: {new Date(engineStatus.lastScanAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              )}
              {engineStatus?.currentState && (
                <span className="px-1.5 py-0.5 rounded bg-white/5 font-bold">{engineStatus.currentState}</span>
              )}
              {engineStatus?.mode && (
                <Badge variant={engineStatus.mode === 'LIVE' ? 'danger' : engineStatus.mode === 'VTS' ? 'warning' : 'info'} size="sm">
                  {engineStatus.mode}
                </Badge>
              )}
            </div>
          </div>
        </div>
        {/* 대형 ON/OFF 토글 */}
        <button
          onClick={onToggle}
          disabled={toggling}
          className={cn(
            'relative w-16 h-8 rounded-full transition-all duration-300 border-2 shrink-0',
            engineStatus?.running
              ? 'bg-green-500/30 border-green-500/50'
              : 'bg-red-500/20 border-red-500/30',
            toggling && 'opacity-50 cursor-not-allowed'
          )}
        >
          <div className={cn(
            'absolute top-0.5 w-6 h-6 rounded-full transition-all duration-300 shadow-lg',
            engineStatus?.running
              ? 'left-[calc(100%-1.625rem)] bg-green-400'
              : 'left-0.5 bg-red-400'
          )} />
          <span className="sr-only">{engineStatus?.running ? 'ON' : 'OFF'}</span>
        </button>
      </div>
      {/* 오늘 KPI 카드 3개 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-white/5 border border-theme-border/20 p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Zap className="w-3 h-3 text-blue-400" />
            <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">오늘 실행</p>
          </div>
          <p className="text-xl font-black text-theme-text font-num">{engineStatus?.todayStats.scans ?? 0}<span className="text-xs font-bold text-theme-text-muted ml-0.5">회</span></p>
        </div>
        <div className="rounded-xl bg-white/5 border border-theme-border/20 p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-green-400" />
            <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">오늘 매수</p>
          </div>
          <p className="text-xl font-black text-green-400 font-num">{engineStatus?.todayStats.buys ?? 0}<span className="text-xs font-bold text-theme-text-muted ml-0.5">건</span></p>
        </div>
        <div className="rounded-xl bg-white/5 border border-theme-border/20 p-3 text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <Activity className="w-3 h-3 text-amber-400" />
            <p className="text-[9px] text-theme-text-muted uppercase tracking-wider font-bold">오늘 청산</p>
          </div>
          <p className="text-xl font-black text-amber-400 font-num">{engineStatus?.todayStats.exits ?? 0}<span className="text-xs font-bold text-theme-text-muted ml-0.5">건</span></p>
        </div>
      </div>
    </Card>
  );
}
