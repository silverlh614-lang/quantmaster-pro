/**
 * FadeInOnScroll — 요소가 뷰포트에 들어올 때 아래→제자리로 페이드 인.
 *
 *  - motion `whileInView` 사용, once:true 로 한 번만 실행.
 *  - prefers-reduced-motion 시 즉시 표시 (애니메이션 생략).
 *  - `delay` 로 stagger 연출 (index * 0.05 등).
 */
import React from 'react';
import { motion } from 'motion/react';

interface FadeInOnScrollProps {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  duration?: number;
  className?: string;
  /** 애니메이션을 강제로 끄고 싶을 때 (서버 사이드·테스트 등). */
  disabled?: boolean;
}

export function FadeInOnScroll({
  children,
  delay = 0,
  y = 12,
  duration = 0.35,
  className,
  disabled = false,
}: FadeInOnScrollProps) {
  if (disabled) return <div className={className}>{children}</div>;

  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px' }}
      transition={{ duration, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
