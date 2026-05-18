// @responsibility Runtime warn scan ignore-list for documentation-only WARN strings.

export const DOC_WARN_IGNORE_GLOBS = [
  'docs/adr/**',
  'ARCHITECTURE.md',
  '.env.example',
] as const;

export function isDocOnlyWarnPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return (
    normalized === 'ARCHITECTURE.md' ||
    normalized === '.env.example' ||
    normalized.startsWith('docs/adr/')
  );
}

export function classifyDocWarn(path: string): 'P5_DOC_ONLY_WARN' | undefined {
  return isDocOnlyWarnPath(path) ? 'P5_DOC_ONLY_WARN' : undefined;
}
