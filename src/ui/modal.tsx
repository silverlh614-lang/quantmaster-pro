import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from './cn';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: ModalSize;
  className?: string;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-[95vw] sm:max-w-[90vw]',
};

export function Modal({ open, onClose, children, size = 'md', className }: ModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 12 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.1 }}
            className={cn(
              'glass-gradient rounded-2xl sm:rounded-3xl w-full shadow-2xl',
              'max-h-[85vh] flex flex-col overflow-hidden',
              sizeClasses[size],
              className
            )}
            style={{ boxShadow: 'var(--shadow-modal)' }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ModalHeaderProps {
  children: React.ReactNode;
  onClose: () => void;
  icon?: React.ReactNode;
  subtitle?: string;
  className?: string;
}

export function ModalHeader({ children, onClose, icon, subtitle, className }: ModalHeaderProps) {
  return (
    <div className={cn('flex items-center justify-between p-5 sm:p-6 pb-0 shrink-0', className)}>
      <div className="flex items-center gap-3 sm:gap-4 min-w-0">
        {icon && (
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 border border-blue-500/10">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-lg sm:text-xl font-black text-theme-text tracking-tight truncate">{children}</h3>
          {subtitle && (
            <p className="text-[10px] sm:text-xs font-bold text-theme-text-muted uppercase tracking-[0.15em] mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-theme-surface flex items-center justify-center hover:bg-theme-border transition-colors shrink-0 ml-3"
      >
        <X className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>
    </div>
  );
}

interface ModalBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModalBody({ className, children, ...props }: ModalBodyProps) {
  return (
    <div className={cn('flex-1 overflow-y-auto p-5 sm:p-6', className)} {...props}>
      {children}
    </div>
  );
}

interface ModalFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function ModalFooter({ className, children, ...props }: ModalFooterProps) {
  return (
    <div className={cn('p-5 sm:p-6 pt-0 shrink-0', className)} {...props}>
      {children}
    </div>
  );
}
