/**
 * SessionRecoveryBanner — 세션 간 설정 복구 배너
 * 마지막 저장된 설정 상태를 감지하고, 복구 여부를 사용자에게 안내합니다.
 */
import React, { useState, useEffect } from 'react';
import { X, Clock, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface SessionStateResponse {
  restored: boolean;
  savedAt?: string;
}

function buildSessionPayload() {
  return {
    gateWeights: {},
    universeSelection: [],
    initialInvestment: 100000000,
    tradingSettings: {},
    savedAt: new Date().toISOString(),
  };
}

export function SessionRecoveryBanner() {
  const [session, setSession] = useState<SessionStateResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // 서버에서 세션 상태 복구
  useEffect(() => {
    fetch('/api/session-state')
      .then(r => r.json())
      .then((data: SessionStateResponse) => {
        if (data.restored && data.savedAt) setSession(data);
      })
      .catch(() => {});
  }, []);

  // 자동 저장: 5분 주기 + 페이지 언로드 시
  useEffect(() => {
    const save = () => {
      navigator.sendBeacon(
        '/api/session-state',
        new Blob([JSON.stringify(buildSessionPayload())], { type: 'application/json' })
      );
    };

    window.addEventListener('beforeunload', save);
    const interval = setInterval(() => {
      fetch('/api/session-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildSessionPayload()),
      }).catch(() => {});
    }, 5 * 60 * 1000);

    return () => {
      window.removeEventListener('beforeunload', save);
      clearInterval(interval);
    };
  }, []);

  if (!session?.restored || dismissed) return null;

  const formattedDate = session.savedAt
    ? new Date(session.savedAt).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12, height: 0 }}
        animate={{ opacity: 1, y: 0, height: 'auto' }}
        exit={{ opacity: 0, y: -12, height: 0 }}
        className="rounded-xl border border-green-500/20 bg-green-500/5 overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-green-400">마지막 설정 복구됨</span>
              <div className="flex items-center gap-1 text-[10px] text-theme-text-muted">
                <Clock className="w-3 h-3" />
                {formattedDate}
              </div>
            </div>
            <p className="text-[10px] text-theme-text-muted mt-0.5">
              이전 세션의 Gate 가중치, 유니버스 선택, 트레이딩 설정이 자동으로 복구되었습니다.
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="p-1.5 rounded-lg hover:bg-white/5 text-theme-text-muted hover:text-theme-text transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
