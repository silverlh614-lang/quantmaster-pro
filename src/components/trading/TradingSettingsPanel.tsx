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
  buyCondition: { gatePassRequired: boolean; minScoreThreshold: number };
  autoStopLoss: { enabled: boolean; level1: number; level2: number; level3: number };
  positionLimit: { enabled: boolean; maxSingleStockPercent: number };
  tradingHours: { enabled: boolean; startTime: string; endTime: string };
  ocoAutoRegister: { enabled: boolean };
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

// ─── Sub-components ────────────────────────────────────────────────────────

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
        enabled ? 'bg-green-500' : 'bg-white/15'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow',
          enabled ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}

function Slider({ value, min, max, step = 1, onChange, suffix = '', label, description }: {
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
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-violet-500"
      />
      {description && <p className="text-[9px] text-theme-text-muted">{description}</p>}
    </div>
  );
}

// ─── Setting Section Card ──────────────────────────────────────────────────

function SettingSection({ icon, title, enabled, onToggle, children }: {
  icon: React.ReactNode; title: string; enabled?: boolean; onToggle?: () => void; children: React.ReactNode;
}) {
  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-sm font-bold text-theme-text">{title}</span>
        </div>
        {onToggle != null && enabled != null && <Toggle enabled={enabled} onToggle={onToggle} />}
      </div>
      {children}
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function TradingSettingsPanel() {
  const [settings, setSettings] = useState<TradingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    fetch('/api/auto-trade/trading-settings')
      .then(r => r.json())
      .then((data) => { setSettings({ ...DEFAULT_SETTINGS, ...data }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const update = useCallback(<K extends keyof TradingSettings>(key: K, value: TradingSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
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

  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    setDirty(true);
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Header with Save/Reset */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-black text-theme-text">트레이딩 설정</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-lg bg-white/5 text-theme-text-muted hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> 초기화
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all',
              dirty ? 'bg-violet-500 text-white hover:bg-violet-600' : 'bg-white/5 text-theme-text-muted cursor-not-allowed'
            )}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            저장
          </button>
        </div>
      </div>

      {/* 매수 조건 */}
      <SettingSection icon={<ShieldCheck className="w-4 h-4 text-green-400" />} title="매수 조건">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-theme-text-muted">Gate 통과 필수</span>
            <Toggle
              enabled={settings.buyCondition.gatePassRequired}
              onToggle={() => update('buyCondition', { ...settings.buyCondition, gatePassRequired: !settings.buyCondition.gatePassRequired })}
            />
          </div>
          <Slider
            label="최소 스코어 임계값"
            description="이 점수 이상인 종목만 매수 후보에 포함됩니다. 높을수록 보수적 (권장: 55~70)"
            value={settings.buyCondition.minScoreThreshold}
            min={30} max={90} step={5} suffix="점"
            onChange={v => update('buyCondition', { ...settings.buyCondition, minScoreThreshold: v })}
          />
        </div>
      </SettingSection>

      {/* 자동 손절 */}
      <SettingSection
        icon={<TrendingDown className="w-4 h-4 text-red-400" />}
        title="자동 손절"
        enabled={settings.autoStopLoss.enabled}
        onToggle={() => update('autoStopLoss', { ...settings.autoStopLoss, enabled: !settings.autoStopLoss.enabled })}
      >
        {settings.autoStopLoss.enabled && (
          <div className="space-y-3 mt-3">
            {([['level1', '1단계 손절', '-3% ~ -10%'], ['level2', '2단계 손절', '-10% ~ -20%'], ['level3', '3단계 강제', '-15% ~ -30%']] as const).map(([key, label, desc]) => (
              <Slider
                key={key}
                label={label}
                description={desc}
                value={settings.autoStopLoss[key]}
                min={-30} max={-3} step={1} suffix="%"
                onChange={v => update('autoStopLoss', { ...settings.autoStopLoss, [key]: v })}
              />
            ))}
          </div>
        )}
      </SettingSection>

      {/* 포지션 한도 */}
      <SettingSection
        icon={<PieChart className="w-4 h-4 text-amber-400" />}
        title="포지션 한도"
        enabled={settings.positionLimit.enabled}
        onToggle={() => update('positionLimit', { ...settings.positionLimit, enabled: !settings.positionLimit.enabled })}
      >
        {settings.positionLimit.enabled && (
          <div className="mt-3">
            <Slider
              label="단일 종목 최대 비중"
              description="한 종목이 전체 포트폴리오에서 차지할 수 있는 최대 비중입니다. 15% 이하를 권장합니다."
              value={settings.positionLimit.maxSingleStockPercent}
              min={5} max={30} step={1} suffix="%"
              onChange={v => update('positionLimit', { ...settings.positionLimit, maxSingleStockPercent: v })}
            />
          </div>
        )}
      </SettingSection>

      {/* 운용 시간 */}
      <SettingSection
        icon={<Clock className="w-4 h-4 text-blue-400" />}
        title="운용 시간"
        enabled={settings.tradingHours.enabled}
        onToggle={() => update('tradingHours', { ...settings.tradingHours, enabled: !settings.tradingHours.enabled })}
      >
        {settings.tradingHours.enabled && (
          <div className="flex items-center gap-3 mt-3 text-sm text-theme-text font-num">
            <span>{settings.tradingHours.startTime}</span>
            <span className="text-theme-text-muted">~</span>
            <span>{settings.tradingHours.endTime}</span>
          </div>
        )}
      </SettingSection>

      {/* OCO 자동 등록 */}
      <SettingSection
        icon={<ArrowRightLeft className="w-4 h-4 text-violet-400" />}
        title="OCO 자동 등록"
        enabled={settings.ocoAutoRegister.enabled}
        onToggle={() => update('ocoAutoRegister', { enabled: !settings.ocoAutoRegister.enabled })}
      >
        {settings.ocoAutoRegister.enabled && (
          <div className="mt-3 rounded-lg bg-violet-500/5 border border-violet-500/10 p-3">
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
      </SettingSection>
    </motion.div>
  );
}
