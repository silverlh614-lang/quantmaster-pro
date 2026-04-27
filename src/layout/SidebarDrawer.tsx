// @responsibility SidebarDrawer 레이아웃 컴포넌트
/**
 * SidebarDrawer — 태블릿/모바일(<lg) 에서 `Sidebar` 를 슬라이드인 드로어로 제공.
 *
 *  - 데스크톱(≥lg) 에서는 렌더되지 않는다 (부모가 Sidebar 를 직접 렌더).
 *  - 오버레이 클릭 / ESC / Route 변경 시 닫힘.
 *  - prefers-reduced-motion 에서는 애니메이션 없이 즉시 전환.
 */
import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useSettingsStore } from '../stores/useSettingsStore';
import { cn } from '../ui/cn';

export function SidebarDrawer() {
  const open = useSettingsStore((s) => s.sidebarDrawerOpen);
  const setOpen = useSettingsStore((s) => s.setSidebarDrawerOpen);
  const view = useSettingsStore((s) => s.view);

  // Route(view) 변경 시 드로어 자동 닫힘 — 네비게이션 이후 UX 정리.
  useEffect(() => {
    if (open) setOpen(false);
    // view 만 의존 — setOpen/open 포함 시 open 직후 즉시 닫히는 루프 발생.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ESC 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // 드로어 열림 동안 body 스크롤 잠금.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[65]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="주 탐색 메뉴"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className={cn(
              'fixed top-0 bottom-0 left-0 z-[66]',
              'w-[min(320px,85vw)] shadow-2xl',
            )}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="메뉴 닫기"
              className="absolute top-3 right-3 z-10 p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-theme-text-muted hover:text-theme-text transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <Sidebar asDrawer />
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
