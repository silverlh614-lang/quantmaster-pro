import { useEffect, useState } from 'react';

/**
 * targetIso 까지 남은 시간을 HH:MM:SS 로 반환. 지났거나 null 이면 null/해제됨.
 * 1초 단위 interval 을 내부에서 관리한다.
 */
export function useCountdown(targetIso: string | null | undefined): string | null {
  const [remaining, setRemaining] = useState<string | null>(null);
  useEffect(() => {
    if (!targetIso) { setRemaining(null); return; }
    const calc = () => {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) { setRemaining('해제됨'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setRemaining(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    calc();
    const id = setInterval(calc, 1_000);
    return () => clearInterval(id);
  }, [targetIso]);
  return remaining;
}
