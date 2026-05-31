// @responsibility common 영역 SettingsModal 컴포넌트 (UIVerbosityToggle 임베드 — ADR-0100)
import React from 'react';
import { Settings, Key, Trash2, ExternalLink, Layers, Stethoscope } from 'lucide-react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../../ui/modal';
import { Button } from '../../ui/button';
import { cn } from '../../ui/cn';
import { useSettingsStore } from '../../stores';
import { THEME_OPTIONS } from '../../config';
import { UIVerbosityToggle } from './UIVerbosityToggle';

export function SettingsModal() {
  const {
    showSettings, setShowSettings,
    theme, setTheme,
    userApiKey, setUserApiKey,
    showOperatorDiagnostics, setShowOperatorDiagnostics,
  } = useSettingsStore();

  return (
    <Modal open={showSettings} onClose={() => setShowSettings(false)} size="md">
      <ModalHeader
        onClose={() => setShowSettings(false)}
        icon={<Settings className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />}
        subtitle="Application Settings"
      >
        설정
      </ModalHeader>

      <ModalBody className="space-y-6">
        {/* API Key */}
        <div className="space-y-2">
          <label className="text-xs font-black text-theme-text-muted tracking-tight flex items-center gap-2">
            <Key className="w-3.5 h-3.5" />
            API Key
          </label>
          <input
            type="password"
            value={userApiKey}
            onChange={(e) => setUserApiKey(e.target.value)}
            placeholder="AI 기능을 사용하려면 API 키를 입력하세요"
            className="w-full px-4 py-3 bg-white/5 border border-theme-border rounded-xl text-sm text-theme-text placeholder:text-theme-text-muted/50 focus:outline-none focus:border-orange-500/50 transition-colors"
          />
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 mt-1"
          >
            API 키 발급받기 <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Theme */}
        <div className="space-y-2">
          <label className="text-xs font-black text-theme-text-muted tracking-tight">테마</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-xs font-black transition-all border',
                  theme === t.id
                    ? 'bg-orange-500/15 text-orange-400 border-orange-500/25'
                    : 'bg-theme-surface text-theme-text-muted border-theme-border hover:bg-theme-border'
                )}
              >
                <t.icon className="w-4 h-4" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Operator diagnostics — ADR-537 */}
        <div className="space-y-2 rounded-xl border border-theme-border bg-white/[0.03] p-3">
          <label className="text-xs font-black text-theme-text-muted tracking-tight flex items-center gap-2">
            <Stethoscope className="w-3.5 h-3.5" />
            Operator Diagnostics
          </label>
          <button
            type="button"
            onClick={() => setShowOperatorDiagnostics(!showOperatorDiagnostics)}
            className={cn(
              'w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-all',
              showOperatorDiagnostics
                ? 'border-blue-500/30 bg-blue-500/10 text-blue-200'
                : 'border-theme-border bg-theme-surface text-theme-text-secondary hover:bg-theme-border',
            )}
          >
            <span className="text-xs font-black">
              {showOperatorDiagnostics ? '운영자 진단 메뉴 표시 중' : '운영자 진단 메뉴 숨김'}
            </span>
            <span className="text-[10px] font-semibold tracking-tight">
              {showOperatorDiagnostics ? 'ON' : 'OFF'}
            </span>
          </button>
          <p className="text-[11px] text-theme-text-muted leading-snug">
            일반 화면에는 raw log, provider response, execution trace, SourceSnapshot 원자료를 숨깁니다.
            이 토글은 운영자 메뉴 노출만 바꾸며 Shadow Learning과 리포트 생성은 계속 유지됩니다.
          </p>
        </div>

        {/* UI 정보 밀도 — ADR-0100 (사용자 #12) */}
        <div className="space-y-2">
          <label className="text-xs font-black text-theme-text-muted tracking-tight flex items-center gap-2">
            <Layers className="w-3.5 h-3.5" />
            정보 밀도
          </label>
          <UIVerbosityToggle className="w-full justify-between" />
          <p className="text-[11px] text-theme-text-muted leading-snug">
            카드/배지의 정보 노출량을 직접 제어합니다. <b>간결</b>은 핵심 결정만, <b>균형</b>은
            V-E-R 3 슬롯, <b>상세</b>는 합치도·결손 사유·신뢰 띠까지 (운영자).
          </p>
        </div>
      </ModalBody>

      <ModalFooter className="flex flex-col sm:flex-row gap-3">
        <Button onClick={() => setShowSettings(false)} className="flex-1">
          설정 저장
        </Button>
        <button
          onClick={() => {
            localStorage.removeItem('k-stock-recommendations');
            localStorage.removeItem('k-stock-market-context');
            localStorage.removeItem('k-stock-last-updated');
            localStorage.removeItem('k-stock-search-results');
            window.location.reload();
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 transition-all"
        >
          <Trash2 className="w-3.5 h-3.5" />
          캐시 초기화
        </button>
      </ModalFooter>
    </Modal>
  );
}
