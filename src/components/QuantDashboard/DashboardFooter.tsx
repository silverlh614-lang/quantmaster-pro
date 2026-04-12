import React, { useMemo } from 'react';

export function DashboardFooter() {
  const timestamp = useMemo(() => new Date().toISOString(), []);

  return (
    <footer className="mt-12 pt-8 border-t border-theme-text flex justify-between items-center opacity-50">
      <p className="text-[10px] font-mono">LIVING QUANT SYSTEM V2.0 // SELF-EVOLVING BACKTESTING LOOP ACTIVE</p>
      <p className="text-[10px] font-mono">LAST UPDATED: {timestamp}</p>
    </footer>
  );
}
