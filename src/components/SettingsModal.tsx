import React from 'react';

import { cn } from '../ui/cn';
import { useSettingsStore } from '../stores';
import { TradingChecklist } from './TradingChecklist';

export function SettingsModal() {
  const {
    showSettings, setShowSettings,
    theme, setTheme,

  } = useSettingsStore();

  const handleSave = () => {
    setShowSettings(false);

      <ModalHeader
        onClose={() => setShowSettings(false)}
        icon={<Settings className="w-5 h-5 sm:w-6 sm:h-6 text-blue-500" />}
        subtitle="Application Settings"
      >
        설정
      </ModalHeader>


          <input
            type="password"
            value={userApiKey}
            onChange={(e) => setUserApiKey(e.target.value)}
            placeholder="AI 기능을 사용하려면 API 키를 입력하세요"

            <br />
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline inline-flex items-center gap-1 mt-1"
            >

            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id as any)}
                className={cn(

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

        </button>
      </ModalFooter>
    </Modal>
  );
}
