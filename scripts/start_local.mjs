#!/usr/bin/env node
// @responsibility 로컬 운영 부트스트랩 — 실행기(local_runtime.mjs)를 띄우고, 실행기가 배포로 바뀌면 새 코드로 다시 띄운다.
//
//   npm run start:local        (작업 스케줄러 'QuantMasterPro' 도 이 파일을 실행한다)
// 실제 일(.env 주입·로그·재기동·자동 배포)은 local_runtime.mjs 가 한다. 이 파일은 일부러 작게 유지한다:
// 자동 배포가 이 파일을 바꾸면 다음 컴퓨터 시작(또는 작업 재실행) 때에야 적용되기 때문이다.
// 실행기 종료 코드: 0 = 정상 종료(같이 끝남), 75 = 자체 갱신(즉시 다시 띄움), 그 밖 = 비정상(5초부터 늘려 가며 다시 띄움).
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME = path.join(ROOT, 'scripts', 'local_runtime.mjs');
const SELF_UPDATE_EXIT_CODE = 75; // local_deploy.mjs 와 같은 값
const HEALTHY_RUN_MS = 10 * 60_000;
const MAX_DELAY_MS = 5 * 60_000;

// 작업 스케줄러 기본 우선순위(7)는 '낮음'이라 바쁜 PC 에서 서버가 수 분간 응답하지 못한다 — 자식들이 상속하도록 먼저 올린다.
try {
  if (os.getPriority() > os.constants.priority.PRIORITY_NORMAL) os.setPriority(os.constants.priority.PRIORITY_NORMAL);
} catch (e) {
  console.warn('[start_local] 우선순위 조정 실패:', e instanceof Error ? e.message : e);
}

let delayMs = 5_000;
let stopping = false;
let runtime = null;

function start() {
  const startedAt = Date.now();
  runtime = spawn(process.execPath, [RUNTIME], { cwd: ROOT, stdio: 'inherit' });
  runtime.on('exit', (code, signal) => {
    runtime = null;
    if (stopping || code === 0) process.exit(code ?? 0);
    if (code === SELF_UPDATE_EXIT_CODE) {
      console.log('[start_local] 실행기 갱신 — 새 코드로 다시 띄웁니다');
      delayMs = 5_000;
      start();
      return;
    }
    if (Date.now() - startedAt >= HEALTHY_RUN_MS) delayMs = 5_000;
    console.error(`[start_local] 실행기 비정상 종료 (code=${code} signal=${signal}) — ${Math.round(delayMs / 1000)}초 후 다시 띄움`);
    setTimeout(start, delayMs);
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  });
}

// 콘솔 Ctrl+C 는 실행기에도 전달되어 실행기가 서버를 정상 종료한다. 여기서는 끝나기를 기다리기만 한다.
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => {
  stopping = true;
  if (runtime && process.platform !== 'win32') runtime.kill('SIGTERM');
});
start();
