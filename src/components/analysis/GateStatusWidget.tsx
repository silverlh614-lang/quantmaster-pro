/**
 * GateStatusWidget — 실시간 Gate 통과 현황 미니 위젯

import { Shield, TrendingUp, Clock, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../ui/cn';
import { Badge } from '../../ui/badge';

  {
    label: 'G1', labelKo: '생존필터', ids: GATE1_IDS, required: GATE1_REQUIRED,
    color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/20',
    icon: <Shield className="w-3 h-3" />,
  },
  {
    label: 'G2', labelKo: '성장검증', ids: GATE2_IDS, required: GATE2_REQUIRED,
    color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/20',
    icon: <TrendingUp className="w-3 h-3" />,
  },
  {
    label: 'G3', labelKo: '타이밍', ids: GATE3_IDS, required: GATE3_REQUIRED,
    color: 'text-green-400', bgColor: 'bg-green-500/10', borderColor: 'border-green-500/20',
    icon: <Clock className="w-3 h-3" />,
  },


  }

  return scores;
}


      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center gap-3 hover:bg-white/[0.03] transition-colors"
      >

          )}>
            {overallPercent}%
          </span>
          <Badge

            size="sm"
          >
            {gateResults.filter(g => g.ok).length}/3 GATE
          </Badge>

        </div>
      </button>

      {/* Expanded Checklist */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3">

                  <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-theme-border/30">
                    <span className={cn('shrink-0', gate.color)}>{gate.icon}</span>
                    <span className={cn('text-[10px] font-black uppercase tracking-widest', gate.color)}>
                      {gate.label} — {gate.labelKo}
                    </span>

                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
