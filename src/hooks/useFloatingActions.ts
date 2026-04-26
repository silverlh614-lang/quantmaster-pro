// @responsibility useFloatingActions React hook
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';

interface UseFloatingActionsArgs {
  fetchStocks: () => void;
  generatePDF: () => void;
  loadingNews: boolean;
}

/**
 * Produces the prop bundle for the mobile floating action button.
 */
export function useFloatingActions({ fetchStocks, generatePDF, loadingNews }: UseFloatingActionsArgs) {
  const onSearch = useCallback(() => {
    const searchInput = document.querySelector<HTMLInputElement>('input[placeholder*="검색"]');
    searchInput?.focus();
  }, []);

  const onExportPDF = useCallback(() => {
    generatePDF();
  }, [generatePDF]);

  return {
    onRefresh: fetchStocks,
    onSearch,
    onExportPDF,
    isRefreshing: loadingNews,
  };
}
