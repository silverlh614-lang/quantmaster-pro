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

// ─── Primitives ─────────────────────────────────────────────────────────────

function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0',
        enabled ? 'bg-green-500' : 'bg-white/15'
      )}
    >
      <span className={cn(
        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-md',
        enabled ? 'translate-x-6' : 'translate-x-1'
      )} />
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
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                   [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.3)]
                   [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-violet-400
                   [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10
                   [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5
                   [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white
                   [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-violet-400"
        style={{ background: `linear-gradient(to right, rgb(139 92 246) ${pct}%, rgba(255,255,255,0.1) ${pct}%)` }}
      />
      {description && <p className="text-[10px] text-theme-text-muted leading-relaxed">{description}</p>}
    </div>
  );
}

/** 설정 카드 공통 레이아웃: 아이콘 + 제목 + 설명 + 토글 */
function SettingsCard({ icon, iconColor, title, description, enabled, onToggle, children }: {
  icon: React.ReactNode; iconColor: string; title: string; description: string;
  enabled?: boolean; onToggle?: () => void; children?: React.ReactNode;
}) {
  return (
    <Card padding="md">
      <div className={cn('flex items-center gap-3', children && 'mb-4')}>
        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center border', iconColor)}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-black text-theme-text">{title}</h4>
          <p className="text-[10px] text-theme-text-muted mt-0.5">{description}</p>
        </div>
        {onToggle && <Toggle enabled={!!enabled} onToggle={onToggle} />}
      </div>
      {children}
    </Card>
  );
}

// ─── Stop-loss level display ────────────────────────────────────────────────

const STOP_LOSS_LEVELS = [
  { key: 'level1' as const, label: '1차 부분청산', desc: '1/3 물량 청산',
    border: 'border-amber-500/20', bg: 'bg-amber-500/5', text: 'text-amber-400' },
  { key: 'level2' as const, label: '2차 추가청산', desc: '1/3 물량 추가 청산',
    border: 'border-orange-500/20', bg: 'bg-orange-500/5', text: 'text-orange-400' },
  { key: 'level3' as const, label: '3차 전량청산', desc: '잔여 전량 강제 청산',
    border: 'border-red-500/20', bg: 'bg-red-500/5', text: 'text-red-400' },
] as const;

const STOP_LOSS_SLIDERS = [
  { key: 'level1' as const, label: '1차 손절 기준', min: -20, max: -1 },
  { key: 'level2' as const, label: '2차 손절 기준', min: -30, max: -5 },
  { key: 'level3' as const, label: '3차 강제 청산 기준', min: -50, max: -10 },
] as const;

// ─── Position risk badge ────────────────────────────────────────────────────

function positionRiskLevel(pct: number): { variant: 'success' | 'warning' | 'danger'; label: string; barColor: string } {
  if (pct <= 15) return { variant: 'success', label: '안전', barColor: 'bg-green-500' };
  if (pct <= 25) return { variant: 'warning', label: '주의', barColor: 'bg-amber-500' };
  return { variant: 'danger', label: '위험', barColor: 'bg-red-500' };
}

// ─── Timeline helpers ───────────────────────────────────────────────────────

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function TimelineBar({ startTime, endTime }: { startTime: string; endTime: string }) {
  const dayStart = 8 * 60;
  const dayEnd = 16 * 60;
  const range = dayEnd - dayStart;
  const left = ((toMinutes(startTime) - dayStart) / range) * 100;
  const width = ((toMinutes(endTime) - toMinutes(startTime)) / range) * 100;

  return (
    <div className="relative h-8 rounded-lg bg-white/5 overflow-hidden">
      <div
        className="absolute top-0 bottom-0 bg-cyan-500/20 border-x-2 border-cyan-400"
        style={{ left: `${Math.max(0, left)}%`, width: `${Math.min(100, width)}%` }}
      >
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-cyan-400">{startTime}</span>
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-bold text-cyan-400">{endTime}</span>
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

  useEffect(() => {
    fetch('/api/auto-trade/trading-settings')
      .then(r => r.json())
      .then(data => { setSettings({ ...DEFAULT_SETTINGS, ...data }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const update = useCallback(<K extends keyof TradingSettings>(
    section: K, patch: Partial<TradingSettings[K]>
  ) => {
    setSettings(prev => ({ ...prev, [section]: { ...prev[section], ...patch } }));
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

  const risk = positionRiskLevel(settings.positionLimit.maxSingleStockPercent);

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {/* Header + Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-theme-text uppercase tracking-wider">트레이딩 설정</h3>
          <p className="text-[10px] text-theme-text-muted mt-0.5">Quantus 스타일 자동매매 파라미터를 개별 카드에서 설정합니다</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setSettings(DEFAULT_SETTINGS); setDirty(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-theme-text-muted bg-white/5 hover:bg-white/10 rounded-lg border border-theme-border transition-colors"
          >
            <RotateCcw className="w-3 h-3" /> 초기화
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 text-[10px] font-bold rounded-lg transition-all',
              dirty ? 'bg-violet-500 hover:bg-violet-400 text-white shadow-[0_0_16px_rgba(139,92,246,0.3)]'
                    : 'bg-white/5 text-theme-text-muted cursor-not-allowed'
            )}
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} 저장
          </button>
        </div>
      </div>

      {/* Card 1: 매수 조건 */}
      <SettingsCard
        icon={<ShieldCheck className="w-5 h-5 text-green-400" />}
        iconColor="bg-green-500/10 border-green-500/20"
        title="매수 조건"
        description="Gate 통과 필수 여부와 최소 스코어 임계값을 설정합니다. Gate를 통과하지 못한 종목은 자동매매 대상에서 제외됩니다."
        enabled={settings.buyCondition.gatePassRequired}
        onToggle={() => update('buyCondition', { gatePassRequired: !settings.buyCondition.gatePassRequired })}
      >
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
            min={0} max={100} step={5} suffix="점"
            onChange={(v) => update('buyCondition', { minScoreThreshold: v })}
          />
        </div>
      </SettingsCard>

      {/* Card 2: 자동 손절 */}
      <SettingsCard
        icon={<TrendingDown className="w-5 h-5 text-red-400" />}
        iconColor="bg-red-500/10 border-red-500/20"
        title="자동 손절 (3단계 강제 청산)"
        description="매수 후 하락 시 3단계로 자동 손절합니다. 1차 손절에서 일부 청산, 2차에서 추가 청산, 3차에서 전량 강제 청산합니다."
        enabled={settings.autoStopLoss.enabled}
        onToggle={() => update('autoStopLoss', { enabled: !settings.autoStopLoss.enabled })}
      >
        {settings.autoStopLoss.enabled && (
          <div className="space-y-4 mt-4">
            <div className="grid grid-cols-3 gap-3">
              {STOP_LOSS_LEVELS.map(({ key, label, desc, border, bg, text }) => (
                <div key={key} className={cn('rounded-xl p-3 border text-center', border, bg)}>
                  <span className={cn('text-[9px] font-black uppercase tracking-widest block mb-1', text)}>{label}</span>
                  <span className={cn('text-lg font-black font-num', text)}>{settings.autoStopLoss[key]}%</span>
                  <p className="text-[9px] text-theme-text-muted mt-1">{desc}</p>
                </div>
              ))}
            </div>
            {STOP_LOSS_SLIDERS.map(({ key, label, min, max }) => (
              <Slider
                key={key} label={label}
                value={settings.autoStopLoss[key]} min={min} max={max} suffix="%"
                onChange={(v) => update('autoStopLoss', { [key]: v })}
              />
            ))}
          </div>
        )}
      </SettingsCard>

      {/* Card 3: 포지션 한도 */}
      <SettingsCard
        icon={<PieChart className="w-5 h-5 text-blue-400" />}
        iconColor="bg-blue-500/10 border-blue-500/20"
        title="포지션 한도"
        description="단일 종목에 대한 최대 포트폴리오 비중을 제한합니다. 집중 투자 리스크를 방지하여 분산 효과를 유지합니다."
        enabled={settings.positionLimit.enabled}
        onToggle={() => update('positionLimit', { enabled: !settings.positionLimit.enabled })}
      >
        {settings.positionLimit.enabled && (
          <div className="mt-4">
            <Slider
              label="단일 종목 최대 비중"
              description="한 종목이 전체 포트폴리오에서 차지할 수 있는 최대 비중입니다. 15% 이하를 권장합니다."
              value={settings.positionLimit.maxSingleStockPercent}
              min={5} max={50} suffix="%"
              onChange={(v) => update('positionLimit', { maxSingleStockPercent: v })}
            />
            <div className="mt-4 flex items-center gap-2">
              <div className="flex-1 h-3 rounded-full bg-white/5 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', risk.barColor)}
                  style={{ width: `${settings.positionLimit.maxSingleStockPercent}%` }}
                />
              </div>
              <Badge variant={risk.variant} size="sm">{risk.label}</Badge>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Card 4: 운용 시간 */}
      <SettingsCard
        icon={<Clock className="w-5 h-5 text-cyan-400" />}
        iconColor="bg-cyan-500/10 border-cyan-500/20"
        title="운용 시간"
        description="장중 자동매매가 활성화되는 시간대를 설정합니다. 설정 시간 외에는 신규 주문이 발생하지 않습니다."
        enabled={settings.tradingHours.enabled}
        onToggle={() => update('tradingHours', { enabled: !settings.tradingHours.enabled })}
      >
        {settings.tradingHours.enabled && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {(['startTime', 'endTime'] as const).map(field => (
                <div key={field}>
                  <label className="text-[10px] font-bold text-theme-text-muted uppercase tracking-widest block mb-2">
                    {field === 'startTime' ? '시작 시간' : '종료 시간'}
                  </label>
                  <input
                    type="time"
                    value={settings.tradingHours[field]}
                    onChange={(e) => update('tradingHours', { [field]: e.target.value })}
                    className="w-full bg-white/5 border border-theme-border rounded-lg px-3 py-2 text-sm text-theme-text font-num focus:outline-none focus:border-cyan-500/50 transition-colors"
                  />
                </div>
              ))}
            </div>
            <TimelineBar startTime={settings.tradingHours.startTime} endTime={settings.tradingHours.endTime} />
          </div>
        )}
      </SettingsCard>

      {/* Card 5: OCO 등록 */}
      <SettingsCard
        icon={<ArrowRightLeft className="w-5 h-5 text-violet-400" />}
        iconColor="bg-violet-500/10 border-violet-500/20"
        title="OCO 자동 등록"
        description="진입 시 손절/익절 주문을 동시에 등록합니다 (One-Cancels-Other). 한쪽이 체결되면 반대 주문은 자동 취소됩니다. 감정적 매매를 방지하고 기계적 실행을 보장합니다."
        enabled={settings.ocoAutoRegister.enabled}
        onToggle={() => update('ocoAutoRegister', { enabled: !settings.ocoAutoRegister.enabled })}
      >
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
      </SettingsCard>
    </motion.div>
  );
}
