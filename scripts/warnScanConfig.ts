import { WARN_SCAN_IGNORE_GLOBS } from './warnIgnorePatterns.ts';

export const WARN_SCAN_INCLUDE_GLOBS = ['**/*.{ts,tsx,js,jsx,md,mdx,json}'] as const;

export const WARN_SCAN_PATTERNS = [
  /console\.warn\s*\(/,
  /\bWARNING\b/,
  /\bWARN\b/,
] as const;

export const WARN_SCAN_CONFIG = {
  include: WARN_SCAN_INCLUDE_GLOBS,
  ignore: WARN_SCAN_IGNORE_GLOBS,
  patterns: WARN_SCAN_PATTERNS,
} as const;
