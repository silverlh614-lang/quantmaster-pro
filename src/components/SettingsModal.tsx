import React from 'react';
import { Settings, Key, Sun, Moon, Contrast, Zap, Trash2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/modal';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { useSettingsStore } from '../stores';
import { TradingChecklist } from './TradingChecklist';

export function SettingsModal() {
  const {
    showSettings, setShowSettings,
    theme, setTheme,
    userApiKey, setUserApiKey,
  } = useSettingsStore();

  const handleSave = () => {
    setShowSettings(false);
    toast.success('API 키가 저장되었습니다. 이제 AI 기능을 사용할 수 있습니다.');
  };

  return (
    <Modal open={showSettings} onClose={() => setShowSettings(false)} size="md">
      <ModalHeader
        onClose={() => setShowSettings(false)}
        icon={<Settings className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />}
        subtitle="Application Settings"
      >
        설정
      </ModalHeader>

      <ModalBody className="space-y-6 sm:space-y-8">
        {/* API Key */}
        <div>
          <label className="flex items-center gap-2 text-micro mb-3 sm:mb-4">
            <Key className="w-3 h-3" />
            Gemini API Key
          </label>
          <input
            type="password"
            value={userApiKey}
            onChange={(e) => setUserApiKey(e.target.value)}
            placeholder="AI 기능을 사용하려면 API 키를 입력하세요"
            className="w-full bg-theme-card border border-theme-border rounded-xl sm:rounded-2xl px-4 sm:px-6 py-3 sm:py-4 text-sm font-bold text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-blue-500/50 transition-all"
          />
          <p className="mt-3 sm:mt-4 text-[10px] text-theme-text-muted font-bold leading-relaxed">
            입력하신 API 키는 브라우저의 로컬 스토리지에만 안전하게 저장되며, 서버로 전송되지 않습니다.
            <br />
            <span className="text-orange-500/60">※ 현재 할당량 절약을 위해 Gemini 3.1 Flash Lite 모델을 사용 중입니다.</span>
            <br />
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline inline-flex items-center gap-1 mt-1"
            >
              API 키 발급받기 <ExternalLink className="w-2 h-2" />
            </a>
          </p>
        </div>

        {/* Theme */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-orange-500" />
            <span className="text-micro">UI 테마 설정</span>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { id: 'light', label: '라이트', icon: Sun },
              { id: 'dark', label: '다크', icon: Moon },
              { id: 'high-contrast', label: '고대비', icon: Contrast }
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as any)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all',
                  theme === t.id
                    ? 'bg-orange-500/15 border-orange-500 text-orange-500'
                    : 'bg-theme-card border-theme-border text-theme-text-muted hover:bg-white/5'
                )}
              >
                <t.icon className="w-5 h-5" />
                <span className="text-[10px] font-black uppercase tracking-widest">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Auto Trading Checklist */}
        <div className="space-y-3 sm:space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-violet-500" />
            <span className="text-micro">자동매매 설정 검증</span>
          </div>
          <TradingChecklist />
        </div>
      </ModalBody>

      <ModalFooter className="flex flex-col gap-3 sm:gap-4">
        <Button
          variant="accent"
          size="lg"
          onClick={handleSave}
          className="w-full text-base sm:text-lg"
        >
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
          className="w-full py-3 sm:py-4 bg-theme-card hover:bg-red-500/15 text-theme-text-muted hover:text-red-400 rounded-xl sm:rounded-2xl font-black text-xs sm:text-sm transition-all border border-theme-border hover:border-red-500/40 active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          캐시 데이터 초기화 (과거 데이터 삭제)
        </button>
      </ModalFooter>
    </Modal>
  );
}
