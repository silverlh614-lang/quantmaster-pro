import React from 'react';
import { Settings, Key, Trash2, ExternalLink } from 'lucide-react';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../../ui/modal';
import { Button } from '../../ui/button';
import { cn } from '../../ui/cn';
import { useSettingsStore } from '../../stores';
import { THEME_OPTIONS } from '../../config';

export function SettingsModal() {
  const {
    showSettings, setShowSettings,
    theme, setTheme,
    userApiKey, setUserApiKey,
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
          <label className="text-xs font-black text-theme-text-muted uppercase tracking-widest flex items-center gap-2">
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
          <label className="text-xs font-black text-theme-text-muted uppercase tracking-widest">테마</label>
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
