// @responsibility analysis 영역 UniverseSelector 컴포넌트
/**
 * UniverseSelector — Gate-0 유니버스 선택기
 *
 * Quantus의 "어떤 풀에서 낚시할지" 개념을 QuantMaster에 도입.
 * 스크리너 실행 전에 종목 풀을 먼저 선택하는 최상위 UI.
 */
import React, { useState, useCallback } from 'react';
import {
  Globe, Database, Layers, SlidersHorizontal,
  Building2, BarChart3, Users, ChevronDown, ChevronUp, Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { Card } from '../../ui/card';
import { Badge } from '../../ui/badge';
import type { UniverseConfig, UniversePreset, UniverseMarket, UniverseFilter } from '../../services/stock/types';

// ── Preset Definitions ──────────────────────────────────────────────────────

interface PresetOption {
  id: UniversePreset;
  label: string;
  labelEn: string;
  description: string;
  icon: React.ReactNode;
  market: UniverseMarket;
  defaultFilters: UniverseFilter;
  color: string;
  bgColor: string;
  borderColor: string;
}

const PRESETS: PresetOption[] = [
  {
    id: 'KOSPI200', label: 'KOSPI 200', labelEn: '대형주 200',
    description: '코스피 대표 200종목 — 유동성과 안정성 확보',
    icon: <Building2 className="w-5 h-5" />,
    market: 'J', defaultFilters: { minMarketCapBillion: 5000 },
    color: 'text-blue-400', bgColor: 'bg-blue-500/12', borderColor: 'border-blue-500/40',
  },
  {
    id: 'KOSDAQ150', label: 'KOSDAQ 150', labelEn: '성장주 150',
    description: '코스닥 대표 150종목 — 성장주 중심 탐색',
    icon: <BarChart3 className="w-5 h-5" />,
    market: 'Q', defaultFilters: { minMarketCapBillion: 1000 },
    color: 'text-purple-400', bgColor: 'bg-purple-500/12', borderColor: 'border-purple-500/40',
  },
  {
    id: 'ALL', label: '전체 상장', labelEn: 'All Listed',
    description: 'KOSPI + KOSDAQ 전체 — 최대 범위 탐색',
    icon: <Globe className="w-5 h-5" />,
    market: 'JQ', defaultFilters: {},
    color: 'text-green-400', bgColor: 'bg-green-500/12', borderColor: 'border-green-500/40',
  },
  {
    id: 'CUSTOM', label: '커스텀', labelEn: 'Custom Universe',
    description: '시총·거래량·외국인 조건을 직접 설정',
    icon: <SlidersHorizontal className="w-5 h-5" />,
    market: 'JQ', defaultFilters: { minMarketCapBillion: 1000 },
    color: 'text-orange-400', bgColor: 'bg-orange-500/12', borderColor: 'border-orange-500/40',
  },
];

// ── Condition Chips ─────────────────────────────────────────────────────────

interface ConditionChip {
  id: keyof UniverseFilter;
  label: string;
  icon: React.ReactNode;
  values: { label: string; value: number | boolean }[];
}

const CONDITION_CHIPS: ConditionChip[] = [
  {
    id: 'minMarketCapBillion',
    label: '시총 하한',
    icon: <Building2 className="w-3.5 h-3.5" />,
    values: [
      { label: '500억+', value: 500 },
      { label: '1,000억+', value: 1000 },
      { label: '5,000억+', value: 5000 },
      { label: '1조+', value: 10000 },
    ],
  },
  {
    id: 'volumeTopPercent',
    label: '거래량 상위',
    icon: <BarChart3 className="w-3.5 h-3.5" />,
    values: [
      { label: '상위 10%', value: 10 },
      { label: '상위 20%', value: 20 },
      { label: '상위 50%', value: 50 },
    ],
  },
  {
    id: 'foreignOwned',
    label: '외국인 편입',
    icon: <Users className="w-3.5 h-3.5" />,
    values: [
      { label: '외국인 편입 종목', value: true },
    ],
  },
];

// ── Component ───────────────────────────────────────────────────────────────

interface UniverseSelectorProps {
  value: UniverseConfig;
  onChange: (config: UniverseConfig) => void;
}

export function UniverseSelector({ value, onChange }: UniverseSelectorProps) {
  const [expanded, setExpanded] = useState(false);
  const selectedPreset = PRESETS.find(p => p.id === value.preset) || PRESETS[2];

  const handlePresetSelect = useCallback((preset: PresetOption) => {
    onChange({
      preset: preset.id,
      market: preset.market,
      filters: { ...preset.defaultFilters },
    });
    if (preset.id !== 'CUSTOM') setExpanded(false);
    else setExpanded(true);
  }, [onChange]);

  const handleFilterChange = useCallback((key: keyof UniverseFilter, val: number | boolean | undefined) => {
    onChange({
      ...value,
      filters: { ...value.filters, [key]: val },
    });
  }, [value, onChange]);

  // Summary text
  const summaryParts: string[] = [selectedPreset.label];
  if (value.filters.minMarketCapBillion) {
    summaryParts.push(
      value.filters.minMarketCapBillion >= 10000
        ? `시총 ${(value.filters.minMarketCapBillion / 10000).toFixed(0)}조+`
        : `시총 ${value.filters.minMarketCapBillion.toLocaleString()}억+`
    );
  }
  if (value.filters.volumeTopPercent) summaryParts.push(`거래량 상위 ${value.filters.volumeTopPercent}%`);
  if (value.filters.foreignOwned) summaryParts.push('외국인 편입');

  return (
    <Card padding="none" className="overflow-visible">
      {/* Header Bar */}
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center gap-3 sm:gap-4 p-4 sm:p-5 hover:bg-white/[0.02] transition-colors"
      >
        <div className={cn('w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center shrink-0', selectedPreset.bgColor)}>
          <span className={selectedPreset.color}>{selectedPreset.icon}</span>
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-micro">Gate 0 — 유니버스 선택</span>
            <Badge variant="info" size="sm">UNIVERSE</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {summaryParts.map((part, i) => (
              <React.Fragment key={part}>
                {i > 0 && <span className="text-theme-text-muted font-black text-[10px]">&middot;</span>}
                <span className="text-xs sm:text-sm font-black text-theme-text">{part}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
        <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="w-5 h-5 text-theme-text-muted shrink-0" />
        </motion.div>
      </button>

      {/* Expandable Detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-5 sm:pb-6 space-y-5">
              {/* Divider */}
              <div className="h-px bg-theme-border" />

              {/* ── Preset Grid ──────────────────────────────────── */}
              <div>
                <span className="text-micro block mb-3">프리셋 유니버스</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                  {PRESETS.map((preset) => {
                    const isSelected = value.preset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handlePresetSelect(preset)}
                        className={cn(
                          'relative flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all text-center',
                          isSelected
                            ? `${preset.bgColor} ${preset.borderColor} shadow-lg`
                            : 'bg-white/5 border-theme-border hover:bg-white/[0.08] hover:border-white/20'
                        )}
                      >
                        {isSelected && (
                          <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-white/20 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                        <span className={cn(isSelected ? preset.color : 'text-theme-text-muted')}>
                          {preset.icon}
                        </span>
                        <div>
                          <span className={cn(
                            'text-xs font-black block uppercase tracking-wider',
                            isSelected ? preset.color : 'text-theme-text'
                          )}>
                            {preset.label}
                          </span>
                          <span className="text-[9px] font-bold text-theme-text-muted block mt-0.5">
                            {preset.labelEn}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Condition Chips (always visible, more prominent in CUSTOM) ── */}
              <div>
                <span className="text-micro block mb-3">세부 조건 필터</span>
                <div className="space-y-3">
                  {CONDITION_CHIPS.map((chip) => (
                    <div key={chip.id} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-theme-text-muted">{chip.icon}</span>
                        <span className="text-[10px] font-black text-theme-text-muted uppercase tracking-wider">
                          {chip.label}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {chip.values.map((v) => {
                          const currentVal = value.filters[chip.id];
                          const isActive = currentVal === v.value;

                          return (
                            <button
                              key={String(v.value)}
                              type="button"
                              onClick={() => {
                                handleFilterChange(
                                  chip.id,
                                  isActive ? undefined : v.value
                                );
                              }}
                              className={cn(
                                'px-3 py-1.5 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider border transition-all',
                                isActive
                                  ? 'bg-blue-500/15 border-blue-500/40 text-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.1)]'
                                  : 'bg-white/5 border-theme-border text-theme-text-muted hover:bg-white/10'
                              )}
                            >
                              {v.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Market Switch (for CUSTOM) ── */}
              {value.preset === 'CUSTOM' && (
                <div>
                  <span className="text-micro block mb-3">시장 선택</span>
                  <div className="flex gap-2">
                    {([
                      { market: 'J' as UniverseMarket, label: 'KOSPI' },
                      { market: 'Q' as UniverseMarket, label: 'KOSDAQ' },
                      { market: 'JQ' as UniverseMarket, label: '전체' },
                    ]).map((opt) => (
                      <button
                        key={opt.market}
                        type="button"
                        onClick={() => onChange({ ...value, market: opt.market })}
                        className={cn(
                          'flex-1 py-2 rounded-lg sm:rounded-xl text-xs font-black uppercase tracking-wider border transition-all',
                          value.market === opt.market
                            ? 'bg-green-500/15 border-green-500/40 text-green-400'
                            : 'bg-white/5 border-theme-border text-theme-text-muted hover:bg-white/10'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

/** Default universe config */
export const DEFAULT_UNIVERSE: UniverseConfig = {
  preset: 'ALL',
  market: 'JQ',
  filters: {},
};
