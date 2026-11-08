#!/usr/bin/env node
// @responsibility 로컬 실행기에 정상 종료를 요청하고 서버 포트가 닫힐 때까지 기다린다.
//   npm run stop:local
// start_local.mjs 가 <로그폴더>/stop.request 를 감지해 서버 graceful shutdown(IPC)을 수행한다.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const fileEnv = fs.existsSync(ENV_FILE) ? dotenv.parse(fs.readFileSync(ENV_FILE)) : {};
const logDir = path.resolve(ROOT, (process.env.LOCAL_LOG_DIR ?? fileEnv.LOCAL_LOG_DIR ?? '').trim() || 'logs');
const port = Number(process.env.PORT ?? fileEnv.PORT) || 3000;
const WAIT_MS = 45_000;

// HTTP 응답 대신 TCP 연결로 판단한다 — 무거운 작업 중인 서버도 연결은 받으므로 '이미 종료' 오판이 없다.
function isServerUp() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (up) => { socket.destroy(); resolve(up); };
    socket.setTimeout(3_000, () => done(true)); // 응답 지연은 아직 살아 있는 것으로 본다
    socket.once('connect', () => done(true));
    socket.once('error', (e) => done(e.code !== 'ECONNREFUSED')); // 연결 거부 = 포트 닫힘 = 종료 완료
  });
}

if (!(await isServerUp())) {
  console.log(`[stop_local] localhost:${port} 응답 없음 — 이미 종료된 상태입니다.`);
  process.exit(0);
}

fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(path.join(logDir, 'stop.request'), new Date().toISOString());
console.log('[stop_local] 종료 요청 기록 — 서버 graceful shutdown 대기 중...');

const deadline = Date.now() + WAIT_MS;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  if (!(await isServerUp())) {
    console.log('[stop_local] 서버 종료 확인.');
    process.exit(0);
  }
}
console.error(`[stop_local] ${WAIT_MS / 1000}초 내 종료되지 않았습니다. 실행기(start_local)가 떠 있는지 로그를 확인하세요.`);
process.exit(1);
