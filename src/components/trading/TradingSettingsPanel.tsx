/**
 * TradingSettingsPanel — Quantus 스타일 트레이딩 설정 패널
 * 매수 조건, 자동 손절, 포지션 한도, 운용 시간, OCO 등록 — 대형 카드 형태
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, TrendingDown, PieChart, Clock, ArrowRightLeft,
  Save, RotateCcw, Loader2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../ui/cn';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TradingSettings {

  updatedAt: string;
}

const DEFAULT_SETTINGS: TradingSettings = {
  buyCondition: { gatePassRequired: true, minScoreThreshold: 60 },
  autoStopLoss: { enabled: true, level1: -7, level2: -15, level3: -25 },
  positionLimit: { enabled: true, maxSingleStockPercent: 15 },
  tradingHours: { enabled: true, startTime: '09:00', endTime: '15:30' },
  ocoAutoRegister: { enabled: true },
  updatedAt: '',
};


  return (
    <button
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
        enabled ? 'bg-green-500' : 'bg-white/15'
      )}
    >

    </button>
  );
}


  value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; suffix?: string; label: string; description?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-theme-text-muted">{label}</span>
        <span className="text-sm font-black text-theme-text font-num">{value}{suffix}</span>
      </div>

    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TradingSettingsPanel() {
  const [settings, setSettings] = useState<TradingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);


      .catch(() => setLoading(false));
  }, []);

  const update = useCallback(<K extends keyof TradingSettings>(

    setDirty(true);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/auto-trade/trading-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setDirty(false);
    } catch (e) {
      console.error('[TradingSettings] 저장 실패:', e);
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return (
      <Card padding="md">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
          <span className="ml-2 text-sm text-theme-text-muted">설정 불러오는 중...</span>
        </div>
      </Card>
    );
  }


          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all',

          </button>
        </div>
      </div>


        <div className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-theme-text-muted">Gate 통과 필수</span>
            <Badge variant={settings.buyCondition.gatePassRequired ? 'success' : 'default'} size="sm">
              {settings.buyCondition.gatePassRequired ? 'ON' : 'OFF'}
            </Badge>
          </div>
          <Slider
            label="최소 스코어 임계값"
            description="이 점수 이상인 종목만 매수 후보에 포함됩니다. 높을수록 보수적 (권장: 55~70)"
            value={settings.buyCondition.minScoreThreshold}

                  <p className="text-[9px] text-theme-text-muted mt-1">{desc}</p>
                </div>
              ))}
            </div>

        {settings.positionLimit.enabled && (
          <div className="mt-4">
            <Slider
              label="단일 종목 최대 비중"
              description="한 종목이 전체 포트폴리오에서 차지할 수 있는 최대 비중입니다. 15% 이하를 권장합니다."
              value={settings.positionLimit.maxSingleStockPercent}

        {settings.ocoAutoRegister.enabled && (
          <div className="mt-4 rounded-lg bg-violet-500/5 border border-violet-500/10 p-3">
            <div className="flex items-center gap-3 text-xs">
              <div className="flex-1 text-center">
                <span className="text-[9px] text-green-400 font-black uppercase block">익절</span>
                <span className="text-theme-text font-num">목표가 도달 시 자동 매도</span>
              </div>
              <ArrowRightLeft className="w-4 h-4 text-violet-400 shrink-0" />
              <div className="flex-1 text-center">
                <span className="text-[9px] text-red-400 font-black uppercase block">손절</span>
                <span className="text-theme-text font-num">손절가 도달 시 자동 매도</span>
              </div>
            </div>
          </div>
        )}

    </motion.div>
  );
}
