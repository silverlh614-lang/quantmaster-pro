export const WARN_SCAN_IGNORE_GLOBS = [
  'docs/**',
  'docs/adr/**',
  '_workspace/**',
  '**/*.md',
  '**/*.mdx',
  '**/*.test.ts',
  '**/*.test.js',
  '**/*.spec.ts',
  '**/*.spec.js',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/fixtures/**',
  '**/samples/**',
  '**/examples/**',
  '**/*.fixture.ts',
  '**/*.mock.ts',
  '**/*.sample.ts',
  'ARCHITECTURE.md',
  'README.md',
  '.env.example',
] as const;

export const P5_REASON_CODES = {
  DOC_ONLY: 'P5_DOC_ONLY_WARN',
  ADR_ONLY: 'P5_ADR_ONLY_WARN',
  TEST_ONLY: 'P5_TEST_ONLY_WARN',
  TYPE_ONLY: 'P5_TYPE_ONLY_WARN',
  ENUM_ONLY: 'P5_ENUM_ONLY_WARN',
  EXAMPLE_ONLY: 'P5_EXAMPLE_ONLY_WARN',
  WORKSPACE_ONLY: 'P5_WORKSPACE_ONLY_WARN',
  FIXTURE_ONLY: 'P5_FIXTURE_ONLY_WARN',
} as const;

export type P5Reason = keyof typeof P5_REASON_CODES;
