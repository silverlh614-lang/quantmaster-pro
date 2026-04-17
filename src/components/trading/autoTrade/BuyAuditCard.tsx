import React from 'react';
import { Shield, ShieldAlert, Timer } from 'lucide-react';
import { Card } from '../../../ui/card';
import { Badge } from '../../../ui/badge';
import { useCountdown } from '../../../hooks/useCountdown';
import type { BuyAuditData } from '../../../api';
import { REGIME_LABELS } from './constants';

interface Props { audit: BuyAuditData; }

export function BuyAuditCard({ audit }: Props) {
  const fomcCountdown = useCountdown(audit.fomcGating.unblockAt);
  const blocked = audit.vixGating.noNewEntry || audit.fomcGating.noNewEntry || audit.emergencyStop;

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-bold text-theme-text">매수 진단 대시보드</span>
        {audit.lastScanAt && (
          <span className="text-micro ml-auto">
            마지막 스캔: {new Date(audit.lastScanAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Pipeline 카운트 */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div className="rounded-lg bg-white/5 p-2">
          <p className="text-micro">워치리스트</p>
          <p className="text-lg font-black text-theme-text">{audit.watchlistCount}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <p className="text-micro">Focus</p>
          <p className="text-lg font-black text-violet-400">{audit.focusCount}</p>
        </div>
        <div className="rounded-lg bg-white/5 p-2">
          <p className="text-micro">Buy List</p>
          <p className="text-lg font-black text-green-400">{audit.buyListCount}</p>
        </div>
      </div>

      {/* Gate 상태 표시 */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-theme-text-muted">시장 레짐</span>
          <Badge variant={
            audit.regime.startsWith('R1') || audit.regime.startsWith('R2') ? 'success' :
            audit.regime.startsWith('R3') || audit.regime.startsWith('R4') ? 'warning' :
            'danger'
          } size="sm">{REGIME_LABELS[audit.regime] ?? audit.regime}</Badge>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-theme-text-muted">VIX 공포지수 게이트</span>
          <Badge variant={audit.vixGating.noNewEntry ? 'danger' : 'success'} size="sm">
            {audit.vixGating.noNewEntry ? '차단됨' : `정상 (베팅 비율 x${(audit.vixGating.kellyMultiplier ?? 1).toFixed(2)})`}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-theme-text-muted">FOMC 금리 발표 게이트</span>
          <Badge variant={audit.fomcGating.noNewEntry ? 'danger' : 'success'} size="sm">
            {audit.fomcGating.noNewEntry ? `차단됨 (${audit.fomcGating.phase})` : audit.fomcGating.phase}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-theme-text-muted">비상정지</span>
          <Badge variant={audit.emergencyStop ? 'danger' : 'success'} size="sm">
            {audit.emergencyStop ? '정지 중' : '해제'}
          </Badge>
        </div>
      </div>

      {/* 종합 차단 여부 */}
      {blocked && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 mb-4">
          <p className="text-sm font-bold text-red-400 mb-1">신규 매수 차단 중</p>
          <ul className="text-xs text-red-300/80 space-y-0.5">
            {audit.emergencyStop && <li>- 비상 정지 활성</li>}
            {audit.vixGating.noNewEntry && <li>- {audit.vixGating.reason}</li>}
            {audit.fomcGating.noNewEntry && <li>- {audit.fomcGating.description}</li>}
          </ul>
          {audit.fomcGating.noNewEntry && fomcCountdown && (
            <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-300">FOMC 차단 해제까지</span>
              </div>
              <span className="text-2xl font-black text-amber-400 tabular-nums font-num">{fomcCountdown}</span>
            </div>
          )}
          {audit.vixGating.noNewEntry && (
            <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-amber-400" />
                <span className="text-xs font-bold text-amber-300">VIX 차단 해제 조건</span>
              </div>
              <span className="text-xs text-amber-300/80">VIX &lt; 30 또는 3일 연속 하락 시 자동 해제</span>
            </div>
          )}
        </div>
      )}

      {/* 탈락 종목 리스트 */}
      {audit.rejectedStocks.length > 0 && (
        <div>
          <p className="text-micro mb-2">최근 탈락 종목 ({audit.rejectedStocks.length}건)</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {audit.rejectedStocks.slice(0, 20).map((r) => (
              <div key={r.code} className="flex items-center justify-between text-xs py-1 border-b border-theme-border/10 last:border-0">
                <span className="text-theme-text">{r.name} <span className="text-theme-text-muted">{r.code}</span></span>
                <span className="text-red-400 shrink-0 ml-2">{r.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
