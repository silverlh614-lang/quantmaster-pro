// @responsibility Verdict 신뢰 유효시간 1-2px 띠 — 시간 진행 시각화 (ADR-0097 PR-Phase-C #8)

/**
 * 사용자 분석 #8 직접 구현 — Verdict 라벨 아래 1-2px 띠로 신뢰 유효시간 표시.
 * 띠가 줄어들수록 verdict 신뢰도가 줄어들며, 끝에 도달하면 "Awaiting Reverification" 으로
 * 자동 전환 (onExpire 콜백).
 *
 * ADR-0019 recommendationSnapshotLifecycle (`createdAt` + `expireStale` 30일 만료) 와 결합 —
 * RecommendationSnapshot 의 lifecycle 이 UI 띠에 그대로 반영.
 *
 * 별도 위젯 아님 — VerdictCard 의 자연 부분 (1-2px CSS 라인). 침습성 0.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { cn } from '../../ui/cn';

interface TimeBandProps {
  /** ISO 시각 또는 epoch ms — 시작 시점 */
  createdAt: string | number | Date;
  /** ISO 시각 또는 epoch ms — 만료 시점 */
  expiresAt: string | number | Date;
  /** 띠 높이 px (기본 2) */
  height?: number;
  /** 만료 도달 시 1회 호출 */
  onExpire?: () => void;
  /** 갱신 주기 ms (기본 60_000 = 1분) */
  tickIntervalMs?: number;
  className?: string;
  /** 초기 시각 (테스트용 주입). 기본 Date.now() */
  nowProvider?: () => number;
}

/**
 * 진행률 산출 (순수 함수 — 단위 테스트 가능).
 *
 * @returns `remainingPct` ∈ [0, 1]. createdAt ≥ expiresAt 또는 now ≥ expiresAt → 0 (만료).
 *          잘못된 입력 (NaN/Infinity) → 0 (보수적 — 만료 취급).
 */
export function computeRemainingPct(
  createdAt: string | number | Date,
  expiresAt: string | number | Date,
  now: number,
): number {
  const start = new Date(createdAt).getTime();
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  if (end <= start) return 0;
  if (now >= end) return 0;
  if (now <= start) return 1;
  const elapsed = now - start;
  const total = end - start;
  return Math.max(0, Math.min(1, 1 - elapsed / total));
}

/** 색상 grade 산출 (순수 함수). */
export function classifyTimeBandGrade(remainingPct: number): 'FRESH' | 'AGING' | 'STALE' | 'EXPIRED' {
  if (remainingPct <= 0) return 'EXPIRED';
  if (remainingPct <= 0.2) return 'STALE';
  if (remainingPct <= 0.5) return 'AGING';
  return 'FRESH';
}

const GRADE_COLOR: Record<ReturnType<typeof classifyTimeBandGrade>, string> = {
  FRESH: 'bg-emerald-500',
  AGING: 'bg-amber-500',
  STALE: 'bg-red-500',
  EXPIRED: 'bg-zinc-700',
};

const GRADE_LABEL: Record<ReturnType<typeof classifyTimeBandGrade>, string> = {
  FRESH: '신뢰 유효',
  AGING: '신뢰 감소 중',
  STALE: '재검증 임박',
  EXPIRED: '재검증 대기',
};

export function TimeBand({
  createdAt,
  expiresAt,
  height = 2,
  onExpire,
  tickIntervalMs = 60_000,
  className,
  nowProvider,
}: TimeBandProps): ReactElement {
  const getNow = nowProvider ?? Date.now;
  const [now, setNow] = useState<number>(() => getNow());

  useEffect(() => {
    const id = window.setInterval(() => setNow(getNow()), tickIntervalMs);
    return () => window.clearInterval(id);
  }, [tickIntervalMs, getNow]);

  const remainingPct = useMemo(() => computeRemainingPct(createdAt, expiresAt, now), [createdAt, expiresAt, now]);
  const grade = useMemo(() => classifyTimeBandGrade(remainingPct), [remainingPct]);

  // onExpire ref 패턴 — props 변화로 인한 useEffect 재실행 시 stale closure 회피 + 1회 호출 보장
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);
  const firedRef = useRef(false);
  useEffect(() => {
    if (grade === 'EXPIRED' && !firedRef.current) {
      firedRef.current = true;
      onExpireRef.current?.();
    }
  }, [grade]);

  const widthPct = Math.round(remainingPct * 100);
  const ariaLabel = `${GRADE_LABEL[grade]} (${widthPct}% 잔여)`;

  return (
    <div
      className={cn('w-full bg-zinc-800/50 overflow-hidden rounded-sm', className)}
      style={{ height: `${height}px` }}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={widthPct}
      aria-valuemin={0}
      aria-valuemax={100}
      data-time-band-grade={grade}
      data-time-band-pct={widthPct}
    >
      <div
        className={cn('h-full transition-all duration-1000', GRADE_COLOR[grade])}
        style={{ width: `${widthPct}%` }}
        aria-hidden
      />
    </div>
  );
}
