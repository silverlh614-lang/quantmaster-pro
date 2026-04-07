import { useState } from 'react';

export function useFilterPanelState() {
  const [isFilterExpanded, setIsFilterExpanded] = useState(true);
  return { isFilterExpanded, setIsFilterExpanded } as const;
}
