// @responsibility pulse UI 프리미티브 컴포넌트
/**
 * Pulse — 상태 변화(체결·알림 도착·신규 트리거 등) 시 자녀에 순간적인 강조.
 *
 * 사용:
 *   <Pulse trigger={order.status === 'FILLED' ? order.id : null}>
 *     <PositionCard ... />
 *   </Pulse>
 *
 *   `trigger` 값이 바뀔 때마다 링 + scale 펄스가 1회 재생된다.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './cn';

type PulseTone = 'success' | 'warning' | 'danger' | 'info' | 'accent';

interface PulseProps {
  children: React.ReactNode;
  /** 이 값이 바뀔 때마다 1회 펄스. null 시 펄스 스킵. */
  trigger: string | number | null;
  tone?: PulseTone;
  className?: string;
}

const toneRing: Record<PulseTone, string> = {
  success: 'ring-emerald-500/50',
  warning: 'ring-amber-500/50',
  danger: 'ring-red-500/50',
  info: 'ring-blue-500/50',
  accent: 'ring-orange-500/50',
};

export function Pulse({ children, trigger, tone = 'info', className }: PulseProps) {
  const [pulseKey, setPulseKey] = useState<string | number | null>(null);

  useEffect(() => {
    if (trigger == null) return;
    setPulseKey(trigger);
    const t = setTimeout(() => setPulseKey(null), 800);
    return () => clearTimeout(t);
  }, [trigger]);

  return (
    <div className={cn('relative', className)}>
      {children}
      <AnimatePresence>
        {pulseKey !== null && (
          <motion.div
            key={String(pulseKey)}
            initial={{ opacity: 0.85, scale: 1 }}
            animate={{ opacity: 0, scale: 1.03 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-0 rounded-2xl ring-2',
              toneRing[tone],
            )}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
