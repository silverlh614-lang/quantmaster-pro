import React from 'react';
import { Settings, Key, Sun, Moon, Contrast, Zap, Trash2, ExternalLink, Type, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { Modal, ModalHeader, ModalBody, ModalFooter } from '../ui/modal';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { cn } from '../ui/cn';
import { useSettingsStore } from '../stores';
import { TradingChecklist } from './TradingChecklist';

export function SettingsModal() {
  const {
    showSettings, setShowSettings,
    theme, setTheme,
    fontSize, setFontSize,
    userApiKey, setUserApiKey,
    emailAddress, setEmailAddress,
  } = useSettingsStore();

  const handleSave = () => {
    setShowSettings(false);
    toast.success('설정이 저장되었습니다.');
  };

  return (
    <Modal open={showSettings} onClose={() => setShowSettings(false)} size="lg">
      <ModalHeader
        onClose={() => setShowSettings(false)}
        icon={<Settings className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />}
        subtitle="Application Settings"
      >
        설정
      </ModalHeader>

      <ModalBody className="space-y-5 sm:space-y-6">
        {/* API Key Section */}
        <Card variant="ghost" padding="md">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
              <Key className="w-4 h-4 text-orange-500" />
            </div>
            <div>
              <h4 className="text-sm font-black text-theme-text">Gemini API Key</h4>
              <p className="text-[10px] text-theme-text-muted">AI 분석 기능에 필요합니다</p>
            </div>
          </div>
          <input
            type="password"
            value={userApiKey}
            onChange={(e) => setUserApiKey(e.target.value)}
            placeholder="AI 기능을 사용하려면 API 키를 입력하세요"
            className="w-full bg-theme-card border border-theme-border rounded-xl px-4 py-3 text-sm font-medium text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20 transition-all"
          />
          <p className="mt-3 text-[10px] text-theme-text-muted font-medium leading-relaxed">
            브라우저 로컬 스토리지에만 저장되며, 서버로 전송되지 않습니다.
            <span className="text-orange-500/60 ml-1">※ Gemini 3.1 Flash Lite 사용 중</span>
            <br />
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline inline-flex items-center gap-1 mt-1"
            >
              API 키 발급받기 <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </p>
        </Card>

        {/* Email Section */}
        <Card variant="ghost" padding="md">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Mail className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <h4 className="text-sm font-black text-theme-text">이메일 주소</h4>
              <p className="text-[10px] text-theme-text-muted">리포트 전송에 사용됩니다</p>
            </div>
          </div>
          <input
            type="email"
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
            placeholder="example@email.com"
            className="w-full bg-theme-card border border-theme-border rounded-xl px-4 py-3 text-sm font-medium text-theme-text placeholder:text-theme-text-muted focus:outline-none focus:border-blue-500/40 focus:ring-1 focus:ring-blue-500/20 transition-all"
          />
        </Card>

        {/* Theme Selection */}
        <Card variant="ghost" padding="md">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Sun className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h4 className="text-sm font-black text-theme-text">UI 테마</h4>
              <p className="text-[10px] text-theme-text-muted">화면 색상 모드를 선택합니다</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { id: 'light', label: '라이트', icon: Sun, desc: '밝은 배경' },
              { id: 'dark', label: '다크', icon: Moon, desc: '어두운 배경' },
              { id: 'high-contrast', label: '고대비', icon: Contrast, desc: '접근성 강화' }
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as any)}
                className={cn(
                  'flex flex-col items-center gap-1.5 p-3 sm:p-4 rounded-xl border-2 transition-all',
                  theme === t.id
                    ? 'bg-orange-500/10 border-orange-500 text-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.1)]'
                    : 'bg-theme-card border-theme-border text-theme-text-muted hover:bg-white/5 hover:border-theme-text-muted/30'
                )}
              >
                <t.icon className="w-5 h-5" />
                <span className="text-[10px] font-black uppercase tracking-wider">{t.label}</span>
                <span className="text-[8px] font-medium opacity-60">{t.desc}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* Font Size */}
        <Card variant="ghost" padding="md">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
              <Type className="w-4 h-4 text-indigo-500" />
            </div>
            <div>
              <h4 className="text-sm font-black text-theme-text">글꼴 크기</h4>
              <p className="text-[10px] text-theme-text-muted">전체 텍스트 크기를 조절합니다</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold text-theme-text-muted w-6">A</span>
            <input
              type="range"
              min="12"
              max="20"
              step="1"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value))}
              className="flex-1 accent-orange-500 h-1.5 rounded-full"
            />
            <span className="text-lg font-bold text-theme-text-muted w-6">A</span>
            <span className="text-xs font-black text-theme-text tabular-nums w-10 text-right">{fontSize}px</span>
          </div>
        </Card>

        {/* Auto Trading Checklist */}
        <Card variant="ghost" padding="md">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-violet-500" />
            </div>
            <div>
              <h4 className="text-sm font-black text-theme-text">자동매매 설정 검증</h4>
              <p className="text-[10px] text-theme-text-muted">KIS API 연동 상태를 확인합니다</p>
            </div>
          </div>
          <TradingChecklist />
        </Card>
      </ModalBody>

      <ModalFooter className="flex flex-col gap-3">
        <Button
          variant="primary"
          size="lg"
          onClick={handleSave}
          className="w-full"
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
          className="w-full py-3 bg-theme-card hover:bg-red-500/10 text-theme-text-muted hover:text-red-400 rounded-xl font-bold text-xs transition-all border border-theme-border hover:border-red-500/30 active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Trash2 className="w-3.5 h-3.5" />
          캐시 데이터 초기화
        </button>
      </ModalFooter>
    </Modal>
  );
}
