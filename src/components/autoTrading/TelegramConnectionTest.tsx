// @responsibility autoTrading 영역 TelegramConnectionTest 컴포넌트

import React, { useState } from 'react';
import { Send, CheckCircle, XCircle, Loader } from 'lucide-react';
import { cn } from '../../ui/cn';
import { deriveTelegram } from './ApiConnectionLamps';

type TestStatus = 'idle' | 'sending' | 'success' | 'error';

interface PipelineHealth {
  telegramConfigured?: boolean;
  telegramBotTokenOnly?: boolean;
  telegramChatIdOnly?: boolean;
}

/**
 * 텔레그램 연결 테스트 버튼.
 * - `POST /api/telegram/test` 호출
 * - 응답 상태별 토스트성 인라인 메시지 (idle / sending / success / error)
 * - `/api/health/pipeline` 조회로 사전 검증 (둘 다 설정됐을 때만 enabled)
 *
 * 자동매매 페이지 진단 영역에 임베드. 운영자가 클릭 1회로 텔레그램 도달성 확인.
 */
export function TelegramConnectionTest() {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [message, setMessage] = useState<string>('');
  const [health, setHealth] = useState<PipelineHealth | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch('/api/health/pipeline');
        if (!res.ok) return;
        const json = (await res.json()) as PipelineHealth;
        if (!cancelled) setHealth(json);
      } catch {
        /* SDS-ignore: 폴링 실패는 조용히 무시 — UI 상태는 미설정으로 표시 */
      }
    };
    void poll();
    return () => { cancelled = true; };
  }, []);

  const lamp = deriveTelegram(health);
  const canSend = health?.telegramConfigured === true;

  const handleClick = async () => {
    if (status === 'sending') return;
    setStatus('sending');
    setMessage('');
    try {
      const res = await fetch('/api/telegram/test', { method: 'POST' });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('success');
        setMessage(json?.message ?? 'Telegram 메시지 전송 완료');
      } else {
        setStatus('error');
        setMessage(json?.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div
      className="rounded-lg border border-theme-border bg-white/[0.02] p-3 sm:p-4 flex flex-col gap-2"
      role="region"
      aria-label="텔레그램 연결 테스트"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-black uppercase tracking-widest text-theme-text-muted">
            Telegram
          </span>
          <span className={cn(
            'text-[10px] font-bold px-1.5 py-0.5 rounded',
            lamp.state === 'ok'   ? 'bg-emerald-500/15 text-emerald-300' :
            lamp.state === 'warn' ? 'bg-amber-500/15 text-amber-300' :
            lamp.state === 'down' ? 'bg-red-500/15 text-red-300' :
                                    'bg-white/5 text-theme-text-muted',
          )}>
            {lamp.detail}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClick}
          disabled={!canSend || status === 'sending'}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-black border transition-colors shrink-0',
            canSend
              ? 'bg-violet-500/20 border-violet-500/40 text-violet-200 hover:bg-violet-500/30'
              : 'bg-white/5 border-white/10 text-theme-text-muted cursor-not-allowed',
            status === 'sending' && 'opacity-60 cursor-wait',
          )}
          title={canSend ? '텔레그램 테스트 메시지 전송' : 'BOT_TOKEN + CHAT_ID 설정 필요'}
        >
          {status === 'sending' ? <Loader className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          테스트 발송
        </button>
      </div>

      {status === 'success' && (
        <div className="flex items-start gap-1.5 text-[10px] text-emerald-300 bg-emerald-500/10 rounded px-2 py-1 border border-emerald-500/20">
          <CheckCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="leading-snug">{message}</span>
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-start gap-1.5 text-[10px] text-red-300 bg-red-500/10 rounded px-2 py-1 border border-red-500/20">
          <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="leading-snug">{message}</span>
        </div>
      )}
      {status === 'idle' && !canSend && (
        <p className="text-[10px] text-theme-text-muted leading-snug">
          BOT_TOKEN 과 CHAT_ID 가 모두 설정돼야 발송 가능합니다 — Railway 환경변수 확인.
        </p>
      )}
    </div>
  );
}
