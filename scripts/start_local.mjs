#!/usr/bin/env node
// @responsibility 로컬 PC 상시 운영 실행기 — .env 선주입, 영속 데이터 경로 확인, 일별 로그, 비정상 종료 시 재기동.
//
// Railway 가 대신하던 플랫폼 역할(환경변수 주입·재시작·로그 보관)을 로컬에서 수행한다.
//   npm run start:local
// - .env 를 서버 모듈 import 이전에 주입한다(paths.ts 의 PERSIST_DATA_DIR 등은 import 시점에 읽힘).
// - PERSIST_DATA_DIR 가 없거나 폴더가 없으면 기동을 거부한다(빈 data/ 로 기억 없이 시작하는 사고 방지).
// - 로그: LOCAL_LOG_DIR(기본 ./logs)/qmp-YYYY-MM-DD.log (KST), LOCAL_LOG_RETENTION_DAYS(기본 14) 초과분 정리.
// - 정상 종료: `npm run stop:local` 이 <로그폴더>/stop.request 를 만들면 IPC 로 서버 graceful shutdown 을 요청한다.
//   (Windows 는 다른 프로세스에 SIGINT 를 보낼 수 없어 강제 종료 시 쓰던 파일이 깨질 수 있다.)
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const SERVER_ARGS = ['--import', 'tsx', '--import', './server/utils/safePctChangeCalendarPatch.ts', 'server/index.ts'];
const HEALTHY_RUN_MS = 10 * 60_000;
const MAX_RESTART_DELAY_MS = 5 * 60_000;
const STOP_GRACE_MS = 15_000;

function kstDate() {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function buildChildEnv() {
  const fileEnv = fs.existsSync(ENV_FILE) ? dotenv.parse(fs.readFileSync(ENV_FILE)) : {};
  // 실제 OS 환경변수가 .env 보다 우선한다(dotenv 기본 규칙과 동일).
  const env = { ...fileEnv, ...process.env, NODE_ENV: 'production' };
  if (!env.GIT_COMMIT_SHA) {
    try {
      env.GIT_COMMIT_SHA = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
    } catch (e) {
      console.warn('[start_local] git 커밋 확인 실패 — /api/health commit=unknown:', e instanceof Error ? e.message : e);
    }
  }
  return env;
}

function assertDataDir(env) {
  const dir = env.PERSIST_DATA_DIR?.trim();
  if (!dir) {
    throw new Error('PERSIST_DATA_DIR 미설정 — .env 에 이전한 영속 데이터 폴더 경로를 지정하세요.');
  }
  const resolved = path.resolve(ROOT, dir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`PERSIST_DATA_DIR 폴더 없음: ${resolved}`);
  }
  return resolved;
}

function pruneLogs(logDir, retentionDays) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  for (const name of fs.readdirSync(logDir)) {
    const m = /^qmp-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (m && new Date(m[1]).getTime() < cutoff) fs.rmSync(path.join(logDir, name), { force: true });
  }
}

function createLogWriter(logDir) {
  let currentDate = '';
  let stream = null;
  return (chunk) => {
    const today = kstDate();
    if (today !== currentDate) {
      stream?.end();
      currentDate = today;
      stream = fs.createWriteStream(path.join(logDir, `qmp-${today}.log`), { flags: 'a' });
    }
    stream.write(chunk);
  };
}

const env = buildChildEnv();
const dataDir = assertDataDir(env);
const logDir = path.resolve(ROOT, env.LOCAL_LOG_DIR?.trim() || 'logs');
fs.mkdirSync(logDir, { recursive: true });
pruneLogs(logDir, Number(env.LOCAL_LOG_RETENTION_DAYS) || 14);
const writeLog = createLogWriter(logDir);

if (!fs.existsSync(path.join(ROOT, 'build', 'index.html'))) {
  console.warn('[start_local] build/index.html 없음 — 화면은 `npm run build` 후 제공됩니다(API 는 정상 기동).');
}

let child = null;
let stopping = false;
let restartDelayMs = 5_000;

function log(line) {
  const text = `[start_local ${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(text);
  writeLog(text);
}

function launch() {
  const startedAt = Date.now();
  log(`서버 기동 — DATA_DIR=${dataDir} · 로그=${logDir}`);
  child = spawn(process.execPath, SERVER_ARGS, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', (chunk) => { process.stdout.write(chunk); writeLog(chunk); });
  child.stderr.on('data', (chunk) => { process.stderr.write(chunk); writeLog(chunk); });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) {
      log(`서버 종료 완료 (code=${code} signal=${signal})`);
      process.exit(0);
    }
    if (Date.now() - startedAt >= HEALTHY_RUN_MS) restartDelayMs = 5_000;
    log(`서버 비정상 종료 (code=${code} signal=${signal}) — ${Math.round(restartDelayMs / 1000)}초 후 재기동`);
    setTimeout(launch, restartDelayMs);
    restartDelayMs = Math.min(restartDelayMs * 2, MAX_RESTART_DELAY_MS);
  });
}

function stop(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal} 수신 — 서버 graceful shutdown 대기`);
  if (!child) process.exit(0);
  // IPC 로 서버 shutdown 핸들러를 직접 호출한다(Windows 콘솔 Ctrl+C 는 자식에게도 전달되며 중복은 서버가 무시).
  if (child.connected) child.send({ type: 'shutdown' });
  else if (process.platform !== 'win32') child.kill(signal);
  setTimeout(() => {
    if (child) {
      log('graceful shutdown 시간 초과 — 강제 종료');
      child.kill('SIGKILL');
    }
  }, STOP_GRACE_MS).unref();
}

const STOP_REQUEST_FILE = path.join(logDir, 'stop.request');
fs.rmSync(STOP_REQUEST_FILE, { force: true });
setInterval(() => {
  if (!fs.existsSync(STOP_REQUEST_FILE)) return;
  fs.rmSync(STOP_REQUEST_FILE, { force: true });
  stop('STOP_REQUEST');
}, 2_000);

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
launch();
