// @responsibility Lightweight script warning wrapper that separates CI/local output from runtime logs.

import { emitMaintenanceWarn } from './maintenanceWarn.js';

export type ScriptWarnEnvironment = 'CI' | 'LOCAL' | 'RUNTIME';

export function getScriptWarnEnvironment(): ScriptWarnEnvironment {
  if (process.env.SCRIPT_WARN_ENV === 'RUNTIME' || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_NAME) return 'RUNTIME';
  if (process.env.CI === 'true') return 'CI';
  return 'LOCAL';
}

function stringify(args: unknown[]): string {
  return args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
}

export function scriptWarn(...args: unknown[]): void {
  const env = getScriptWarnEnvironment();
  if (env === 'CI' || env === 'LOCAL') {
    console.warn(...args);
    return;
  }

  emitMaintenanceWarn({
    domain: 'DIAGNOSTIC',
    code: 'P3_SCRIPT_WARN',
    message: stringify(args).slice(0, 500),
    source: 'SCRIPT',
    dedupKey: `p3:script:${stringify(args).slice(0, 120)}`,
    details: { scriptWarnEnv: env, railwaySuppressed: true },
  });
}
