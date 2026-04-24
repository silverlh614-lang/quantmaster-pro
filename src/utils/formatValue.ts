/**
 * @responsibility 장외 미확정 값 표시 통일 헬퍼 — "0" 대신 "—"
 *
 * Market Sentiment 카드·종목 상세 가격·변화율 등에서 value===0 또는 null 을
 * 일관되게 "—" 로 치환한다. 호출자가 isMarketOpenFor 판정을 이미 했다면
 * 해당 정보를 hint 로 넘겨 장외 상태를 툴팁 등에 반영할 수 있다.
 */

export function isBlankValue(v: number | null | undefined): boolean {
  return v == null || v === 0 || !Number.isFinite(v);
}

/** 값이 비어있으면 대시, 아니면 formatter 적용. */
export function dashIfBlank<T extends number | null | undefined>(
  v: T,
  formatter: (n: number) => string = (n) => String(n),
): string {
  return isBlankValue(v as number | null | undefined) ? '—' : formatter(v as number);
}

/** 금액(숫자) 형식 — 빈 값은 대시. */
export function formatCurrencyOrDash(v: number | null | undefined): string {
  return dashIfBlank(v, (n) => n.toLocaleString());
}

/** 퍼센트(%) 형식 — 빈 값은 대시. */
export function formatPercentOrDash(v: number | null | undefined, digits = 2): string {
  return dashIfBlank(v, (n) => `${n.toFixed(digits)}%`);
}
