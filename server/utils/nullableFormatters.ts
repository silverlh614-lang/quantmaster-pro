// @responsibility nullableFormatters 카드/리포트 표시용 nullable 숫자 포맷 SSOT

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatNullablePercent(value: number | null | undefined, digits = 1): string {
  if (!isFiniteNumber(value)) {
    return 'N/A';
  }
  return `${value.toFixed(digits)}%`;
}

export function formatSignedNullablePercent(value: number | null | undefined, digits = 1): string {
  if (!isFiniteNumber(value)) {
    return 'N/A';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function formatNullableNumber(value: number | null | undefined, digits = 2): string {
  if (!isFiniteNumber(value)) {
    return 'N/A';
  }
  return value.toFixed(digits);
}

export function formatWon(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) {
    return 'N/A';
  }
  return `${Math.round(value).toLocaleString()}원`;
}
