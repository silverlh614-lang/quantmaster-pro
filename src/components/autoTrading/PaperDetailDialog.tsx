// @responsibility Display accessible Shadow application details.
import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import '../../styles/paperDetails.css';

export function PaperDetailDialog({ title, subtitle, onClose, children }: {
  title: string; subtitle: string; onClose: () => void; children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null), close = useRef<HTMLButtonElement>(null);
  const titleId = useId(), subtitleId = useId();
  useEffect(() => {
    const element = dialog.current!, previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element.showModal(); close.current?.focus(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="paper-detail-dialog" aria-labelledby={titleId} aria-describedby={subtitleId}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="paper-detail-header"><div><span>적용 내용</span><h2 id={titleId}>{title}</h2><p id={subtitleId}>{subtitle}</p></div>
      <button type="button" ref={close} aria-label="상세 팝업 닫기" onClick={onClose}><X size={22} aria-hidden="true" /></button></header>
    <div className="paper-detail-body">{children}</div>
    <footer className="paper-detail-footer">한국 시간 기준 · Shadow 가상 판단<button type="button" onClick={onClose}>확인하고 닫기</button></footer>
  </dialog>, document.body);
}
