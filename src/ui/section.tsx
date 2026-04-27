// @responsibility section UI 프리미티브 컴포넌트
/**
 * Section — 섹션 래퍼 (제목 + 서브타이틀 + 액션 + 본문).
 *
 * 디자인 원칙 (Step 4):
 *   - 기본(variant="default") = 순수 여백 기반 구분. 상단 제목으로 계층 표시.
 *   - variant="neo"           = 테두리·그림자가 있는 박스형, Gate 판정 같은 결정적 UI 용.
 *   - 스페이싱은 --space-* 토큰을 활용한 Tailwind 클래스로만 사용.
 */
import React from 'react';
import { cn } from './cn';

interface SectionProps extends React.HTMLAttributes<HTMLElement> {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  compact?: boolean;
  variant?: 'default' | 'neo';
}

export function Section({ title, subtitle, actions, compact = false, variant = 'default', className, children, ...props }: SectionProps) {
  const isNeo = variant === 'neo';

  return (
    <section
      className={cn(
        compact ? 'space-y-3' : 'space-y-4 sm:space-y-6',
        isNeo && 'neo-section rounded-xl sm:rounded-2xl p-4 sm:p-5 lg:p-6',
        className
      )}
      {...props}
    >
      {(title || actions) && (
        <div className={cn(
          'flex items-center justify-between gap-4',
          isNeo && 'pb-3 border-b-2 border-slate-700/40'
        )}>
          <div>
            {title && (
              <h3 className="text-sm sm:text-base font-black text-theme-text uppercase tracking-wider leading-snug">{title}</h3>
            )}
            {subtitle && (
              <p className="text-[10px] sm:text-xs text-theme-text-muted font-medium mt-0.5">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
