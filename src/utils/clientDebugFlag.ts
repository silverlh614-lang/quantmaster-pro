// @responsibility client-only P4 warning 출력 플래그 판정 모듈

type ImportMetaEnvLike = {
  DEV?: boolean;
  MODE?: string;
  NODE_ENV?: string;
  VITE_DEBUG_CLIENT_WARN?: string | boolean;
};

function readImportMetaEnv(): ImportMetaEnvLike | undefined {
  return (import.meta as unknown as { env?: ImportMetaEnvLike }).env;
}

function isTrueFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'yes';
}

function isClientWarnDebugEnabled(): boolean {
  const viteEnv = readImportMetaEnv();
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  return isTrueFlag(viteEnv?.VITE_DEBUG_CLIENT_WARN) || isTrueFlag(processEnv?.DEBUG_CLIENT_WARN);
}

function isClientWarnProduction(): boolean {
  const viteEnv = readImportMetaEnv();
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  const env = processEnv?.NODE_ENV ?? viteEnv?.NODE_ENV ?? viteEnv?.MODE;
  if (env) return env === 'production';
  return viteEnv?.DEV === false;
}

export function shouldPrintClientWarn(): boolean {
  if (isClientWarnProduction()) return isClientWarnDebugEnabled();
  return true;
}
