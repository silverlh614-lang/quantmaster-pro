/**
 * Idea 9: Floating Action Button (FAB) for mobile
 * Bottom-right FAB that fans out into refresh/search/PDF actions.
 */
import React, { useState } from 'react';
import { Plus, X, RefreshCw, Search, FileDown } from 'lucide-react';
import { cn } from '../ui/cn';
import { AnimatePresence, motion } from 'motion/react';

interface FloatingActionButtonProps {
  onRefresh: () => void;
  onSearch: () => void;
  onExportPDF: () => void;
  isRefreshing?: boolean;
}

export function FloatingActionButton({ onRefresh, onSearch, onExportPDF, isRefreshing }: FloatingActionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const actions = [
    {
      icon: RefreshCw,
      label: '새로고침',
      color: 'bg-blue-500 shadow-blue-500/30',
      onClick: () => { onRefresh(); setIsOpen(false); },
      spinning: isRefreshing,
    },
    {
      icon: Search,
      label: '검색',
      color: 'bg-emerald-500 shadow-emerald-500/30',
      onClick: () => { onSearch(); setIsOpen(false); },
    },
    {
      icon: FileDown,
      label: 'PDF',
      color: 'bg-purple-500 shadow-purple-500/30',
      onClick: () => { onExportPDF(); setIsOpen(false); },
    },
  ];

  return (
    <div className="fab-container">
      {/* Fan-out Action Buttons */}
      <AnimatePresence>
        {isOpen && (
          <div className="absolute bottom-16 right-0 flex flex-col-reverse items-end gap-3 mb-2">
            {actions.map((action, i) => {
              const Icon = action.icon;
              return (
                <motion.div
                  key={action.label}
                  initial={{ scale: 0, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0, opacity: 0, y: 20 }}
                  transition={{ delay: i * 0.05, type: 'spring', stiffness: 400, damping: 20 }}
                  className="flex items-center gap-2"
                >
                  <span className="text-[10px] font-black text-white bg-black/80 backdrop-blur-md px-2 py-1 rounded-lg border border-white/10 shadow-lg whitespace-nowrap">
                    {action.label}
                  </span>
                  <button
                    onClick={action.onClick}
                    className={cn(
                      'w-11 h-11 rounded-full flex items-center justify-center text-white shadow-lg transition-transform active:scale-90',
                      action.color
                    )}
                  >
                    <Icon className={cn('w-5 h-5', action.spinning && 'animate-spin')} />
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </AnimatePresence>

      {/* Main FAB */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={cn(
          'w-14 h-14 rounded-full flex items-center justify-center shadow-xl transition-all duration-300',
          isOpen
            ? 'bg-white/10 border border-white/20 backdrop-blur-xl rotate-45'
            : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/40 hover:shadow-blue-500/60'
        )}
      >
        {isOpen ? (
          <X className="w-6 h-6 text-white -rotate-45" />
        ) : (
          <Plus className="w-6 h-6 text-white" />
        )}
      </button>
    </div>
  );
}
