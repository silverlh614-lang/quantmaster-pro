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
            'w-full bg-theme-card border border-theme-border rounded-xl px-4 py-2.5',
            'text-sm font-medium text-theme-text',
            'placeholder:text-theme-text-muted',
            'focus:outline-none focus:border-orange-500/40 focus:ring-1 focus:ring-orange-500/20',
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
