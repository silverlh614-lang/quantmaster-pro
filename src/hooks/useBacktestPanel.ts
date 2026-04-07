import { useState } from 'react';

export function useBacktestPanel() {
  const [backtestYears, setBacktestYears] = useState<number>(1);
  const [parsingFile, setParsingFile] = useState(false);
  return { backtestYears, setBacktestYears, parsingFile, setParsingFile } as const;
}
