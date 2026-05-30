/**
 * @responsibility InfoTooltip — 무의존 hover/focus/click tooltip (UI_WIRING_MATRIX §10 #2B Phase B)
 *
 * 사용자 디자인 스펙: "각 상태 라벨 옆 inline tooltip — 짧은 개념 설명".
 *
 * 채택 이유:
 *  - 기존 코드가 native HTML `title=` 만 사용 — 모바일·터치에서 안 보이고 스타일 부재.
 *  - 의존성 0 (Radix/Floating-UI 등 미설치). CSS + React state 로 self-contained.
 *
 * 작동:
 *  - 트리거에 hover/focus → 팝업 표시(150ms 지연 없이 즉시)
 *  - 모바일/터치 → 트리거 클릭 토글 (hover 없는 환경)
 *  - ESC → 닫기
 *  - 자식 컴포넌트 변경 없음 — wrapping element 만 추가
 *
 * 한계 (의도):
 *  - collision detection 없음 (단순 absolute 배치). 호출자가 배치(top/bottom)를 prop 으로 선택.
 *  - portal 없음 — 부모 overflow:hidden 안에서 잘릴 수 있으나, 현재 사용처는 모두 그리드
 *    내부 배지로 잘림 위험 낮음.
 */
import React, { useId, useRef, useState, useEffect, useCallback } from 'react';
import { cn } from './cn';

export interface InfoTooltipProps {
  /** 팝업에 들어갈 내용 — 문자열 또는 ReactNode. null/undefined 면 wrapping 만 하고 아무것도 안 보임. */
  label: React.ReactNode;
  /** 트리거가 될 자식. 그대로 wrap 됨. */
  children: React.ReactNode;
  /** 팝업 위치 — default 'bottom'. */
  placement?: 'top' | 'bottom';
  /** 추가 className for 트리거 wrapper. */
  className?: string;
}

export function InfoTooltip({ label, children, placement = 'bottom', className }: InfoTooltipProps) {
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // ESC 닫기 + 바깥 클릭 닫기 (touch UX)
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  // label 이 없으면 wrap 만 하고 popup 비활성
  if (label == null || label === '') {
    return <span className={className}>{children}</span>;
  }

  const popupClass = cn(
    'absolute z-50 left-1/2 -translate-x-1/2 w-64 max-w-[80vw] rounded-xl border border-white/15 bg-black/95 px-3 py-2 text-[11px] font-bold text-theme-text-secondary shadow-2xl leading-relaxed pointer-events-none',
    placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
  );

  return (
    <span
      ref={wrapRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={toggle}
        className="appearance-none bg-transparent border-0 p-0 m-0 text-left w-full cursor-help"
      >
        {children}
      </button>
      {open && (
        <span id={id} role="tooltip" className={popupClass}>
          {label}
        </span>
      )}
    </span>
  );
}
