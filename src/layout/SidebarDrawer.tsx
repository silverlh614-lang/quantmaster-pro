// @responsibility Present the mobile navigation drawer.
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useSettingsStore } from '../stores/useSettingsStore';

export function SidebarDrawer() {
  const open = useSettingsStore(state => state.sidebarDrawerOpen);
  const setOpen = useSettingsStore(state => state.setSidebarDrawerOpen);
  const view = useSettingsStore(state => state.view);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { setOpen(false); }, [view, setOpen]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  if (!open) return null;
  return <dialog ref={dialog} aria-label="주 탐색 메뉴" onCancel={() => setOpen(false)}
    onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}
    className="workspace-drawer">
    <button type="button" aria-label="메뉴 닫기" className="workspace-drawer-close" onClick={() => setOpen(false)}><X size={18} /></button>
    <Sidebar asDrawer />
  </dialog>;
}
