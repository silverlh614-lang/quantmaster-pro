// @responsibility autoTrading 영역 EngineToggleGate 컴포넌트
/**
 * EngineToggleGate — 실매매 엔진 시동용 3단계 확인 모달.
 *
 * Nuclear Reactor Pattern: ARMED → CONFIRMING → COMMITTING.
 * 각 단계마다 시각적으로 구분된 UI + 10초 카운트다운을 표시한다.
 * 사용자는 "오늘 날짜(YYYY-MM-DD)" 를 정확히 타이핑해야 실제 mutation 발동.
 *
 * 디자인 원칙:
 *   - ARMED:    황색 경고 톤 (amber)   — 주의 단계
 *   - CONFIRM:  적색 임박 톤 (red)    — 타이핑 확인 요구
 *   - 카운트다운: 상단 진행바 + 숫자 — 시간 압박을 시각화
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Zap } from 'lucide-react';
import { Modal } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import type { ArmingState } from '../../hooks/autoTrade/useEngineArming';

interface EngineToggleGateProps {
  open: boolean;
  state: ArmingState;
  armCountdown: number;
  todayToken: string;
  mode: string;
  onAbort: () => void;
  onProceed: () => void;
  onCommit: (typedToken: string) => Promise<boolean>;
}

export function EngineToggleGate({
  open,
  state,
  armCountdown,
  todayToken,
  mode,
  onAbort,
  onProceed,
  onCommit,
}: EngineToggleGateProps) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  // 모달이 새로 열릴 때마다 입력 초기화
  useEffect(() => {
    if (!open) { setTyped(''); setError(null); return; }
  }, [open]);

  useEffect(() => {
    if (state === 'CONFIRMING') {
      setTyped('');
      setError(null);
    }
  }, [state]);

  const committing = state === 'COMMITTING';
  const armPct = Math.max(0, Math.min(100, (armCountdown / 10) * 100));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (committing) return;
    const ok = await onCommit(typed).catch(() => false);
    if (!ok) {
      setError('입력이 일치하지 않습니다. 오늘 날짜(YYYY-MM-DD)를 정확히 입력해주세요.');
    }
  };

  return (
    <Modal open={open} onClose={onAbort} size="md">
      {/* ── 카운트다운 진행바 ─────────────────────────────── */}
      {state === 'ARMED' && (
        <div className="h-1 w-full bg-amber-500/10">
          <div
            className="h-full bg-amber-400 transition-[width] duration-1000 ease-linear"
            style={{ width: `${armPct}%` }}
          />
        </div>
      )}

      <div className="p-6 sm:p-8">
        {/* ── 아이콘 + 타이틀 ───────────────────────────── */}
        <div className="flex items-start gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${
              state === 'CONFIRMING' || committing
                ? 'bg-red-500/15 border border-red-500/30'
                : 'bg-amber-500/15 border border-amber-500/30'
            }`}
          >
            {state === 'CONFIRMING' || committing ? (
              <ShieldAlert className="h-6 w-6 text-red-300" />
            ) : (
              <AlertTriangle className="h-6 w-6 text-amber-300" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
              Nuclear Reactor Pattern · {mode}
            </div>
            <h3 className="mt-1 text-xl font-black text-white">
              {state === 'ARMED' && '실매매 엔진 무장 (ARMED)'}
              {state === 'CONFIRMING' && '최종 확인 — 오늘 날짜 입력'}
              {committing && '엔진 가동 요청 전송 중…'}
            </h3>
            <p className="mt-1 text-sm text-white/60">
              {state === 'ARMED' && '이 엔진은 실계좌에 주문을 발송할 수 있습니다. 10초 내에 진행 버튼을 누르지 않으면 자동 취소됩니다.'}
              {state === 'CONFIRMING' && '마지막 안전 장치입니다. 오늘 날짜(YYYY-MM-DD)를 정확히 입력해야 실행됩니다.'}
              {committing && '브로커 API 응답을 기다리는 중…'}
            </p>
          </div>
        </div>

        {/* ── ARMED 단계 ─────────────────────────────────── */}
        {state === 'ARMED' && (
          <div className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/[0.04] p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-amber-200/80">자동 취소까지</span>
              <span className="font-mono text-2xl font-black text-amber-300">
                {armCountdown}s
              </span>
            </div>
            <ul className="mt-3 space-y-1.5 text-xs text-white/60">
              <li>• 진행 시 오늘 날짜 타이핑 확인이 추가로 요구됩니다.</li>
              <li>• 모드: <span className="font-semibold text-amber-200">{mode}</span></li>
              <li>• 중단하려면 닫기 또는 10초 대기.</li>
            </ul>
          </div>
        )}

        {/* ── CONFIRMING 단계 ─────────────────────────────── */}
        {(state === 'CONFIRMING' || committing) && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300/80">
                오늘 날짜 (KST)
              </div>
              <div className="mt-1 font-mono text-2xl font-black text-red-200">
                {todayToken}
              </div>
            </div>

            <Input
              label="위 날짜를 정확히 입력"
              placeholder="YYYY-MM-DD"
              value={typed}
              onChange={(e) => { setTyped(e.target.value); setError(null); }}
              disabled={committing}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                {error}
              </div>
            )}
          </form>
        )}

        {/* ── 액션 버튼 ──────────────────────────────────── */}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onAbort} disabled={committing}>
            취소
          </Button>

          {state === 'ARMED' && (
            <Button
              variant="danger"
              size="md"
              icon={<Zap className="h-4 w-4" />}
              onClick={onProceed}
            >
              진행 — 날짜 입력으로
            </Button>
          )}

          {(state === 'CONFIRMING' || committing) && (
            <Button
              variant="primary"
              size="md"
              icon={<ShieldAlert className="h-4 w-4" />}
              loading={committing}
              loadingText="전송 중…"
              onClick={() => void handleSubmit({ preventDefault: () => {} } as React.FormEvent)}
              disabled={typed.trim() !== todayToken || committing}
            >
              실매매 가동
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
