// @responsibility Runtime JavaScript shim for node scripts/check_*.js warning separation.

function getScriptWarnEnvironment() {
  if (process.env.SCRIPT_WARN_ENV === 'RUNTIME' || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME) return 'RUNTIME';
  if (process.env.CI === 'true') return 'CI';
  return 'LOCAL';
}

const suppressed = new Map();

function scriptWarn(...args) {
  const env = getScriptWarnEnvironment();
  if (env === 'CI' || env === 'LOCAL') {
    console.warn(...args);
    return;
  }
  const key = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ').slice(0, 120);
  suppressed.set(key, (suppressed.get(key) ?? 0) + 1);
  if (process.env.OPERATIONAL_WARN_DEBUG === 'true') {
    console.warn('[P3][DIAGNOSTIC][P3_SCRIPT_WARN] executionImpact=NONE runtimeVisible=false ttlSec=600', {
      priority: 'P3',
      code: 'P3_SCRIPT_WARN',
      source: 'SCRIPT',
      suppressedCount: suppressed.get(key),
    });
  }
}

export { getScriptWarnEnvironment, scriptWarn };
