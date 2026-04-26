// @responsibility useCopiedCode React hook
import { useState } from 'react';

export function useCopiedCode() {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = (text: string, code: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return { copiedCode, handleCopy } as const;
}
