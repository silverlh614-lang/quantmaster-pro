#!/usr/bin/env node
// @responsibility 로컬 운영 실행기 — .env 주입, 일별 로그, 비정상 종료 재기동, 운영 폴더에서 main 자동 배포.
//
// start_local.mjs(부트스트랩)가 이 파일을 띄운다. 직접 실행해도 된다(이때 자체 갱신 재시작은 동작하지 않음).
// - .env 는 서버를 띄울 때마다 다시 읽는다(paths.ts 의 PERSIST_DATA_DIR 등은 서버 import 시점에 읽힘).
// - PERSIST_DATA_DIR 가 없거나 폴더가 없으면 기동을 거부한다(빈 data/ 로 기억 없이 시작하는 사고 방지).
// - 로그: LOCAL_LOG_DIR(기본 ./logs)/qmp-YYYY-MM-DD.log (KST), LOCAL_LOG_RETENTION_DAYS(기본 14) 초과분 정리.
// - 정상 종료: stop_local.mjs 가 <로그폴더>/stop.request 를 만들면 IPC 로 서버 graceful shutdown 을 요청한다.
//   (Windows 는 다른 프로세스에 SIGINT 를 보낼 수 없어 강제 종료 시 쓰던 파일이 깨질 수 있다.)
// - 자동 배포: LOCAL_AUTO_DEPLOY=true 이고 HEAD 가 분리(detached)된 운영 폴더에서만 동작한다.
//   LOCAL_DEPLOY_POLL_SEC(기본 60)마다 GitHub origin/main 을 확인하고 local_deploy.mjs 절차로 반영한다.
//   상태는 <로그폴더>/deploy-state.json (제어판 표시용).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  DEPLOY_STATE_FILE,
  SELF_UPDATE_EXIT_CODE,
  deployCommit,
  isAutoDeployEnabled,
  resumeAfterRuntimeUpdate,
  shortSha,
  shouldDeploy,
} from './local_deploy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const SERVER_ARGS = ['--import', 'tsx', '--import', './server/utils/safePctChangeCalendarPatch.ts', 'server/index.ts'];
const HEALTHY_RUN_MS = 10 * 60_000;
const MAX_RESTART_DELAY_MS = 5 * 60_000;
const STOP_GRACE_MS = 15_000;
const HEALTH_TIMEOUT_MS = 4 * 60_000;
const HEALTH_STABLE_MS = 30_000;
const NPM_CLI = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
// 세션 0(S4U)에서 자격 증명 창을 띄우려다 멈추지 않도록 git 인증 프롬프트를 모두 끈다(저장소는 공개 — 익명 fetch).
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function kstDate() {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
}

function git(args, timeout = 60_000) {
  return execFileSync('git', ['-c', 'credential.helper=', '-c', 'advice.detachedHead=false', ...args], {
    cwd: ROOT, encoding: 'utf-8', timeout, env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readEnvFile() {
  return fs.existsSync(ENV_FILE) ? dotenv.parse(fs.readFileSync(ENV_FILE)) : {};
}

function buildChildEnv() {
  // 실제 OS 환경변수가 .env 보다 우선한다(dotenv 기본 규칙과 동일).
  const env = { ...readEnvFile(), ...process.env, NODE_ENV: 'production' };
  // 배포 확인은 /api/health 커밋으로 하므로 커밋은 매 기동마다 실제 HEAD 로 정한다(OS 환경변수로 준 값만 존중).
  if (!process.env.GIT_COMMIT_SHA) {
    try {
      env.GIT_COMMIT_SHA = git(['rev-parse', 'HEAD']);
    } catch (e) {
      console.warn('[local_runtime] git 커밋 확인 실패 — /api/health commit=unknown:', e instanceof Error ? e.message : e);
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

const startupEnv = buildChildEnv();
const dataDir = assertDataDir(startupEnv);
const logDir = path.resolve(ROOT, startupEnv.LOCAL_LOG_DIR?.trim() || 'logs');
fs.mkdirSync(logDir, { recursive: true });
pruneLogs(logDir, Number(startupEnv.LOCAL_LOG_RETENTION_DAYS) || 14);
const writeLog = createLogWriter(logDir);
const STATE_FILE = path.join(logDir, DEPLOY_STATE_FILE);
const STOP_REQUEST_FILE = path.join(logDir, 'stop.request');

if (!fs.existsSync(path.join(ROOT, 'build', 'index.html'))) {
  console.warn('[local_runtime] build/index.html 없음 — 화면은 `npm run build` 후 제공됩니다(API 는 정상 기동).');
}

function log(line) {
  const text = `[local_runtime ${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(text);
  writeLog(text);
}

function readDeployState() {
  try {
    return { rejected: [], ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
  } catch {
    return { rejected: [] };
  }
}

function writeDeployState(state) {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, STATE_FILE);
}

// 작업 스케줄러 기본 우선순위(7)는 '낮음'이라 다른 프로그램이 바쁘면 서버가 수 분간 응답하지 못한다.
// 부트스트랩이 이미 올렸어도, 이 파일을 직접 실행한 경우를 위해 한 번 더 확인한다(자식 프로세스가 상속).
function ensureNormalPriority() {
  try {
    if (os.getPriority() > os.constants.priority.PRIORITY_NORMAL) os.setPriority(os.constants.priority.PRIORITY_NORMAL);
    return os.getPriority() === os.constants.priority.PRIORITY_NORMAL ? 'normal' : `level ${os.getPriority()}`;
  } catch (e) {
    return `확인 실패(${e instanceof Error ? e.message : e})`;
  }
}
const priorityText = ensureNormalPriority();

let child = null;
let stopping = false;
let deployBusy = false;
let pendingStop = null;
let restartTimer = null;
let restartDelayMs = 5_000;
const exitWaiters = [];

function launch({ fromDeploy = false } = {}) {
  if (child || stopping || (deployBusy && !fromDeploy)) return;
  clearTimeout(restartTimer);
  if (fromDeploy) restartDelayMs = 5_000;
  const env = buildChildEnv();
  const startedAt = Date.now();
  log(`서버 기동 — 커밋=${shortSha(env.GIT_COMMIT_SHA) || 'unknown'} · DATA_DIR=${dataDir} · 로그=${logDir} · 우선순위=${priorityText}`);
  const proc = spawn(process.execPath, SERVER_ARGS, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child = proc;
  proc.stdout.on('data', (chunk) => { process.stdout.write(chunk); writeLog(chunk); });
  proc.stderr.on('data', (chunk) => { process.stderr.write(chunk); writeLog(chunk); });
  proc.on('exit', (code, signal) => {
    if (child === proc) child = null;
    for (const resolve of exitWaiters.splice(0)) resolve();
    if (stopping) {
      log(`서버 종료 완료 (code=${code} signal=${signal})`);
      process.exit(0);
    }
    if (deployBusy) {
      log(`서버 종료 (배포 진행 중, code=${code} signal=${signal})`);
      return;
    }
    if (Date.now() - startedAt >= HEALTHY_RUN_MS) restartDelayMs = 5_000;
    log(`서버 비정상 종료 (code=${code} signal=${signal}) — ${Math.round(restartDelayMs / 1000)}초 후 재기동`);
    restartTimer = setTimeout(() => launch(), restartDelayMs);
    restartDelayMs = Math.min(restartDelayMs * 2, MAX_RESTART_DELAY_MS);
  });
}

/** 서버만 정상 종료한다(실행기는 계속). 이미 꺼져 있으면 바로 끝난다. */
function stopChild() {
  const proc = child;
  if (!proc) return Promise.resolve();
  return new Promise((resolve) => {
    exitWaiters.push(resolve);
    // IPC 로 서버 shutdown 핸들러를 직접 호출한다(Windows 콘솔 Ctrl+C 는 자식에게도 전달되며 중복은 서버가 무시).
    if (proc.connected) proc.send({ type: 'shutdown' });
    else if (process.platform !== 'win32') proc.kill('SIGTERM');
    setTimeout(() => {
      if (child === proc) {
        log('graceful shutdown 시간 초과 — 강제 종료');
        proc.kill('SIGKILL');
      }
    }, STOP_GRACE_MS).unref();
  });
}

function stopAll(signal) {
  if (stopping) return;
  if (deployBusy) {
    if (!pendingStop) log(`${signal} 수신 — 진행 중인 배포가 끝나면 종료합니다`);
    pendingStop = signal;
    return;
  }
  stopping = true;
  clearTimeout(restartTimer);
  log(`${signal} 수신 — 서버 graceful shutdown 대기`);
  if (!child) process.exit(0);
  void stopChild();
}

async function waitHealthy(target) {
  const port = Number(buildChildEnv().PORT) || 3000;
  const expected = shortSha(target);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let seen = '';
  while (Date.now() < deadline) {
    if (!child) return { ok: false, reason: '서버가 기동 중 종료됨' };
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(5_000) });
      if (res.ok) {
        seen = String((await res.json()).commit ?? '');
        if (seen === expected) {
          const stableUntil = Date.now() + HEALTH_STABLE_MS;
          while (Date.now() < stableUntil) {
            if (!child) return { ok: false, reason: '기동 직후 서버 종료' };
            await sleep(1_000);
          }
          return { ok: true };
        }
      }
    } catch {
      // 기동 중이면 아직 응답이 없다 — 재시도
    }
    await sleep(3_000);
  }
  return { ok: false, reason: seen ? `응답 커밋 ${seen} ≠ ${expected}` : `${HEALTH_TIMEOUT_MS / 60_000}분 안에 /api/health 응답 없음` };
}

function runNpm(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    log(`npm ${args.join(' ')} 시작`);
    const proc = spawn(process.execPath, [NPM_CLI, ...args], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', writeLog);
    proc.stderr.on('data', writeLog);
    const timer = setTimeout(() => {
      log(`npm ${args.join(' ')} 시간 초과 — 중단`);
      proc.kill('SIGKILL');
    }, timeoutMs);
    proc.on('error', (e) => { clearTimeout(timer); reject(e); });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} 실패 (code=${code})`));
    });
  });
}

async function notify(text, { important = false } = {}) {
  const env = buildChildEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = important ? env.TELEGRAM_CHAT_ID : (env.TELEGRAM_SYSTEM_CHANNEL_ID || env.TELEGRAM_CHAT_ID);
  if (!token || !chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) log(`텔레그램 배포 알림 실패: HTTP ${res.status}`);
  } catch (e) {
    log(`텔레그램 배포 알림 실패: ${e instanceof Error ? e.message : e}`);
  }
}

const deployDeps = {
  now: () => new Date(),
  head: () => git(['rev-parse', 'HEAD']),
  changedFiles: (from, to) => git(['diff', '--name-only', from, to]).split(/\r?\n/).filter(Boolean),
  subject: (sha) => git(['log', '-1', '--format=%s', sha]),
  checkout: async (sha) => { git(['checkout', '--force', '--detach', sha], 120_000); },
  install: () => runNpm(['ci', '--include=dev', '--no-audit', '--no-fund'], 20 * 60_000),
  build: () => runNpm(['run', 'build'], 15 * 60_000),
  stopServer: () => stopChild(),
  startServer: () => launch({ fromDeploy: true }),
  waitHealthy,
  loadState: readDeployState,
  saveState: writeDeployState,
  notify,
  log,
};

function exitForRuntimeUpdate() {
  log('실행기 코드가 바뀌어 새 실행기로 다시 시작합니다');
  process.exit(SELF_UPDATE_EXIT_CODE);
}

let lastFetchErrorAt = 0;
async function checkForUpdate() {
  if (deployBusy || stopping) return;
  let target;
  try {
    git(['fetch', '--quiet', 'origin', '+refs/heads/main:refs/remotes/origin/main'], 30_000);
    target = git(['rev-parse', 'refs/remotes/origin/main']);
  } catch (e) {
    if (Date.now() - lastFetchErrorAt > 30 * 60_000) {
      log(`자동 배포: GitHub 확인 실패 — ${e instanceof Error ? e.message.split('\n')[0] : e}`);
      lastFetchErrorAt = Date.now();
    }
    return;
  }
  if (!shouldDeploy({ head: deployDeps.head(), target, rejected: readDeployState().rejected })) return;

  deployBusy = true;
  clearTimeout(restartTimer);
  let result = null;
  try {
    result = await deployCommit(target, deployDeps);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`자동 배포 오류: ${msg}`);
    writeDeployState({ ...readDeployState(), phase: null, phaseTarget: null });
    await notify(`⚠️ 자동 배포 오류: ${msg}`, { important: true });
    if (!child) launch({ fromDeploy: true });
  } finally {
    deployBusy = false;
  }
  if (result?.status === 'self-update') exitForRuntimeUpdate();
  if (pendingStop) stopAll(pendingStop);
}

fs.rmSync(STOP_REQUEST_FILE, { force: true });
setInterval(() => {
  if (!fs.existsSync(STOP_REQUEST_FILE)) return;
  fs.rmSync(STOP_REQUEST_FILE, { force: true });
  stopAll('STOP_REQUEST');
}, 2_000);
process.on('SIGINT', () => stopAll('SIGINT'));
process.on('SIGTERM', () => stopAll('SIGTERM'));

let detachedHead = false;
try { git(['symbolic-ref', '-q', 'HEAD']); } catch { detachedHead = true; }
const autoDeploy = isAutoDeployEnabled({ flag: startupEnv.LOCAL_AUTO_DEPLOY, detachedHead });
const pollSec = Math.max(30, Number(startupEnv.LOCAL_DEPLOY_POLL_SEC) || 60);
log(`자동 배포: ${autoDeploy.enabled ? `켜짐 (${pollSec}초마다 GitHub main 확인)` : `꺼짐 — ${autoDeploy.reason}`}`);
writeDeployState({ ...readDeployState(), autoDeploy: autoDeploy.enabled, pollSec, current: deployDeps.head() });

deployBusy = true;
let resumed = null;
try {
  resumed = await resumeAfterRuntimeUpdate(deployDeps);
} catch (e) {
  log(`배포 확인 재개 실패: ${e instanceof Error ? e.message : e}`);
} finally {
  deployBusy = false;
}
if (resumed?.status === 'self-update') exitForRuntimeUpdate();
if (!child) launch();
if (pendingStop) stopAll(pendingStop);
if (autoDeploy.enabled) setInterval(() => void checkForUpdate(), pollSec * 1_000);
