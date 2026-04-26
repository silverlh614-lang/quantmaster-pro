// @responsibility data-table UI 프리미티브 컴포넌트
/**
 * DataTable — 정렬 가능한 반응형 데이터 테이블 프리미티브.
 *
 * 설계 (Step 5):
 *   - sticky header + horizontal scroll (narrow screens)
 *   - 컬럼 단위 정렬 (key 제공 시 상태 토글)
 *   - 선택적 행 클릭 핸들러 + 키보드(Enter/Space) 지원
 *   - 빈 상태는 EmptyState 대신 심플 인라인 메시지 (테이블 문맥에 맞춤)
 *
 * 고의적으로 스코프 제한:
 *   - 가상 스크롤 / 컬럼 리사이즈는 향후 확장 포인트로 남김.
 */
import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { cn } from './cn';

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  /** 셀 렌더러. 미지정 시 `row[key as keyof T]` 를 그대로 렌더. */
  accessor?: (row: T) => React.ReactNode;
  /** 정렬 비교용 숫자/문자/날짜 키를 반환. 미지정 시 정렬 비활성. */
  sortKey?: (row: T) => string | number;
  /** 셀 정렬. */
  align?: 'left' | 'center' | 'right';
  /** 고정 너비(px) 또는 Tailwind 클래스. */
  width?: string;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  /** 각 행의 고유 key 를 반환. */
  rowKey: (row: T) => string;
  /** 행 클릭 시 호출. */
  onRowClick?: (row: T) => void;
  /** 빈 상태 메시지. */
  emptyMessage?: string;
  /** caption (접근성). */
  caption?: string;
  className?: string;
  /** 최대 높이 — 초과 시 sticky header 와 함께 세로 스크롤. */
  maxHeight?: string;
}

type SortDir = 'asc' | 'desc' | null;

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  emptyMessage = '표시할 데이터가 없습니다.',
  caption,
  className,
  maxHeight,
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<{ key: string; dir: SortDir }>({
    key: '',
    dir: null,
  });

  const sortedRows = useMemo(() => {
    if (!sortState.dir || !sortState.key) return data;
    const column = columns.find((c) => c.key === sortState.key);
    if (!column?.sortKey) return data;

    const sorted = [...data].sort((a, b) => {
      const av = column.sortKey!(a);
      const bv = column.sortKey!(b);
      if (av < bv) return sortState.dir === 'asc' ? -1 : 1;
      if (av > bv) return sortState.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [data, sortState, columns]);

  const toggleSort = (key: string) => {
    setSortState((prev) => {
      if (prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key: '', dir: null };
      return { key, dir: 'asc' };
    });
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden',
        className,
      )}
    >
      <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
        <table className="min-w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-white/[0.04] backdrop-blur-sm sticky top-0 z-[1]">
            <tr>
              {columns.map((col) => {
                const sortable = Boolean(col.sortKey);
                const isActive = sortState.key === col.key && sortState.dir;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={
                      isActive
                        ? sortState.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : sortable
                          ? 'none'
                          : undefined
                    }
                    className={cn(
                      'px-4 py-3 text-[11px] font-black uppercase tracking-[0.15em] text-theme-text-muted border-b border-white/[0.06]',
                      col.align === 'right' && 'text-right',
                      col.align === 'center' && 'text-center',
                      col.align === 'left' && 'text-left',
                      !col.align && 'text-left',
                      col.className,
                    )}
                    style={col.width ? { width: col.width } : undefined}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          'inline-flex items-center gap-1 group transition-colors',
                          isActive ? 'text-theme-text' : 'hover:text-theme-text-secondary',
                        )}
                      >
                        <span>{col.header}</span>
                        <SortIcon active={isActive ? sortState.dir : null} />
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-sm text-theme-text-muted"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              sortedRows.map((row) => (
                <tr
                  key={rowKey(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    'border-b border-white/[0.04] last:border-b-0 transition-colors',
                    onRowClick &&
                      'cursor-pointer hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-blue-500/30',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        'px-4 py-3 text-theme-text-secondary',
                        col.align === 'right' && 'text-right tabular-nums',
                        col.align === 'center' && 'text-center',
                        col.className,
                      )}
                    >
                      {col.accessor ? col.accessor(row) : ((row as any)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function SortIcon({ active }: { active: SortDir }) {
  if (active === 'asc') return <ChevronUp className="w-3.5 h-3.5" aria-hidden />;
  if (active === 'desc') return <ChevronDown className="w-3.5 h-3.5" aria-hidden />;
  return <ChevronsUpDown className="w-3.5 h-3.5 opacity-50" aria-hidden />;
}
