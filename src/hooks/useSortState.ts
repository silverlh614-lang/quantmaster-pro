import { useState } from 'react';

export function useSortState() {
  const [sortBy, setSortBy] = useState<'NAME' | 'CODE' | 'PERFORMANCE'>('NAME');
  return { sortBy, setSortBy } as const;
}
