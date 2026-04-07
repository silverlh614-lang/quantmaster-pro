import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY),
      // KIS 자동매매 — VITE_ 접두어 없는 서버 변수를 클라이언트에 안전하게 노출
      'import.meta.env.VITE_KIS_ACCOUNT_NO':   JSON.stringify(env.KIS_ACCOUNT_NO   ?? ''),
      'import.meta.env.VITE_KIS_ACCOUNT_PROD': JSON.stringify(env.KIS_ACCOUNT_PROD ?? '01'),
      'import.meta.env.VITE_KIS_IS_REAL':      JSON.stringify(env.KIS_IS_REAL      ?? 'false'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      outDir: 'build',
    },
  };
});
