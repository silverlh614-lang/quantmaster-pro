import React from 'react';
import { cn } from './cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  icon?: React.ReactNode;
}

export function Input({ label, hint, icon, className, ...props }: InputProps) {
  return (
    <div>
      {label && (
        <label className="block text-[10px] font-black text-theme-text-muted uppercase tracking-[0.15em] mb-2">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted">
            {icon}
          </div>
        )}
        <input
          className={cn(
            'w-full bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5',
            'text-sm font-medium text-theme-text',
            'placeholder:text-theme-text-muted',
            'focus:outline-none focus:border-blue-500/30 focus:ring-1 focus:ring-blue-500/15 focus:bg-white/[0.04]',
            'transition-all',
            icon && 'pl-10',
            className
          )}
          {...props}
        />
      </div>
      {hint && (
        <p className="mt-1.5 text-[10px] text-theme-text-muted font-medium leading-relaxed">{hint}</p>
      )}
    </div>
  );
}
