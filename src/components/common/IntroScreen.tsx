// @responsibility 첫 진입 인트로(스플래시) 화면 — 브랜드 애니메이션 후 페이드아웃 전환.
/**
 * 앱 첫 로드 시 ~2.4초 브랜드 인트로 후 부드럽게 사라진다. 화면을 누르면 즉시 건너뜀.
 * prefers-reduced-motion 존중(무한/이동 애니메이션 차단). 표시 전용 — 앱 로직 무관.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Zap } from 'lucide-react';

export function IntroScreen() {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), reduce ? 700 : 2400);
    return () => clearTimeout(timer);
  }, [reduce]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="intro"
          className="fixed inset-0 z-[200] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#06090d]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          onClick={() => setVisible(false)}
        >
          {/* 앰비언트 글로우 — 깊이감 */}
          <motion.div
            className="pointer-events-none absolute h-[40rem] w-[40rem] rounded-full bg-blue-500/[0.10] blur-[160px]"
            animate={reduce ? undefined : { scale: [0.9, 1.1, 0.9], opacity: [0.5, 0.9, 0.5] }}
            transition={reduce ? undefined : { duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="pointer-events-none absolute -bottom-40 h-80 w-80 rounded-full bg-orange-500/[0.07] blur-[140px]" />

          {/* 로고 배지 + 확장 링 */}
          <motion.div
            className="relative mb-7 flex h-20 w-20 items-center justify-center rounded-3xl border border-white/[0.07] bg-gradient-to-br from-blue-500/20 to-orange-500/20 shadow-[0_0_60px_-10px_rgba(59,130,246,0.6)]"
            initial={{ scale: 0.7, opacity: 0, rotate: -8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <Zap className="h-10 w-10 text-orange-400" fill="currentColor" />
            {!reduce && (
              <motion.span
                className="absolute inset-0 rounded-3xl border border-blue-400/40"
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 1.6, opacity: 0 }}
                transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
          </motion.div>

          {/* 타이틀 */}
          <motion.h1
            className="text-5xl font-bold tracking-tight [text-shadow:0_2px_40px_rgba(59,130,246,0.4)] sm:text-6xl"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="text-gradient-blue">QuantMaster</span> <span className="text-gradient-accent">Pro</span>
          </motion.h1>

          {/* 태그라인 */}
          <motion.p
            className="mt-4 text-xs font-bold tracking-tight text-white/30 sm:text-sm"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            데이터 기반 국면·신호 분석
          </motion.p>

          {/* 진행 바 */}
          {!reduce && (
            <div className="mt-10 h-px w-40 overflow-hidden bg-white/10">
              <motion.div
                className="h-full bg-gradient-to-r from-blue-400 to-orange-400"
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 2.2, ease: 'easeInOut' }}
              />
            </div>
          )}

          <motion.span
            className="absolute bottom-8 text-[10px] font-bold tracking-tight text-white/20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          >
            화면을 누르면 건너뜁니다
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
