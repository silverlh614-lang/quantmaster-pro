// @responsibility 로컬 운영 자동 배포 절차 — 새 main 커밋을 반영하고 기동 확인에 실패하면 이전 커밋으로 복귀한다.
//
// 실행기(local_runtime.mjs)가 git·npm·서버 제어를 deps 로 주입하고, 이 모듈은 순서와 판정만 맡는다(테스트 대상).
// 순서: 서버 정상 종료 → 코드 교체 → (필요 시) 패키지 설치·화면 빌드 → 서버 기동 → /api/health 커밋 확인.
// 실패: 이전 커밋으로 되돌려 다시 띄우고, 실패한 커밋은 거부 목록에 올려 같은 커밋을 반복 배포하지 않는다.
//       새 커밋이 push 되면 다시 시도한다.

/** 실행기 코드 자체가 배포로 바뀌었을 때 부트스트랩(start_local.mjs)에 '새 코드로 다시 띄워 달라'고 알리는 종료 코드. */
export const SELF_UPDATE_EXIT_CODE = 75;
export const DEPLOY_STATE_FILE = 'deploy-state.json';
const MAX_REJECTED = 20;

const INSTALL_FILES = new Set(['package.json', 'package-lock.json', '.npmrc']);
// 화면 번들(vite build)에 들어가지 않는 경로. src 는 server 를 테스트에서만 import 하므로 서버만 바뀐 커밋은 빌드를 건너뛴다.
const NO_BUILD_PREFIXES = ['server/', 'scripts/', 'docs/', '.github/', '.claude/', '.codex/', 'data/'];
const RUNTIME_FILES = new Set(['scripts/local_runtime.mjs', 'scripts/local_deploy.mjs']);
const BOOTSTRAP_FILE = 'scripts/start_local.mjs';

export function shortSha(sha) {
  return String(sha ?? '').slice(0, 7);
}

/** 바뀐 파일 목록으로 이번 배포에 필요한 단계를 정한다. */
export function classifyChanges(files) {
  const needInstall = files.some((f) => INSTALL_FILES.has(f));
  const needBuild = needInstall
    || files.some((f) => !f.endsWith('.md') && !NO_BUILD_PREFIXES.some((p) => f.startsWith(p)));
  return {
    fileCount: files.length,
    needInstall,
    needBuild,
    runtimeChanged: files.some((f) => RUNTIME_FILES.has(f)),
    bootstrapChanged: files.includes(BOOTSTRAP_FILE),
  };
}

/** 자동 배포는 운영 폴더(LOCAL_AUTO_DEPLOY=true + 분리된 HEAD)에서만 켠다 — 개발 폴더의 작업물을 덮어쓰지 않기 위해. */
export function isAutoDeployEnabled({ flag, detachedHead }) {
  if (String(flag ?? '').trim().toLowerCase() !== 'true') return { enabled: false, reason: 'LOCAL_AUTO_DEPLOY 꺼짐' };
  if (!detachedHead) return { enabled: false, reason: '브랜치가 체크아웃된 폴더(개발 폴더)는 자동 배포하지 않음' };
  return { enabled: true, reason: '' };
}

export function shouldDeploy({ head, target, rejected }) {
  if (!target || target === head) return false;
  return !(rejected ?? []).includes(target);
}

function patchState(deps, update) {
  const next = { ...deps.loadState(), ...update };
  deps.saveState(next);
  return next;
}

function setPhase(deps, phase, target) {
  patchState(deps, { phase, phaseTarget: target ?? null, phaseAt: deps.now().toISOString() });
}

function errorText(e) {
  return e instanceof Error ? e.message : String(e);
}

function seconds(deps, startedAt) {
  return Math.round((deps.now().getTime() - new Date(startedAt).getTime()) / 1000);
}

/**
 * target 커밋을 배포한다. 반환 status:
 *   deployed      새 커밋으로 기동 확인 완료
 *   rolled-back   실패 → 이전 커밋으로 다시 기동
 *   self-update   실행기 코드가 바뀜 → 호출자가 SELF_UPDATE_EXIT_CODE 로 종료해야 함(새 실행기가 이어서 확인)
 */
export async function deployCommit(target, deps) {
  const prev = deps.head();
  const files = deps.changedFiles(prev, target);
  const changes = classifyChanges(files);
  const ctx = { target, prev, changes, subject: deps.subject(target), startedAt: deps.now().toISOString() };
  deps.log(`배포 시작 ${shortSha(prev)} → ${shortSha(target)} · 파일 ${files.length}개`
    + ` · 설치 ${changes.needInstall ? '함' : '생략'} · 빌드 ${changes.needBuild ? '함' : '생략'} · ${ctx.subject}`);
  if (changes.bootstrapChanged) deps.log('start_local.mjs 변경 — 다음 컴퓨터 시작(또는 작업 재실행) 때 적용됩니다');

  setPhase(deps, 'stopping', target);
  await deps.stopServer();
  try {
    setPhase(deps, 'updating', target);
    await deps.checkout(target);
    if (changes.needInstall) { setPhase(deps, 'installing', target); await deps.install(); }
    if (changes.needBuild) { setPhase(deps, 'building', target); await deps.build(); }
  } catch (e) {
    return rollback(deps, ctx, `준비 실패 — ${errorText(e)}`);
  }
  if (changes.runtimeChanged) {
    patchState(deps, { verifying: ctx, phase: 'restarting-runtime', phaseTarget: target, phaseAt: deps.now().toISOString() });
    return { status: 'self-update', target };
  }
  return startAndVerify(deps, ctx);
}

/** 서버를 띄우고 새 커밋으로 응답하는지 확인한다. 실패하면 복귀한다. */
export async function startAndVerify(deps, ctx) {
  setPhase(deps, 'verifying', ctx.target);
  deps.startServer();
  const health = await deps.waitHealthy(ctx.target);
  if (!health.ok) return rollback(deps, ctx, `기동 확인 실패 — ${health.reason}`);
  const took = seconds(deps, ctx.startedAt);
  patchState(deps, {
    phase: null, phaseTarget: null, verifying: null, current: ctx.target,
    last: { result: 'deployed', target: ctx.target, prev: ctx.prev, subject: ctx.subject, at: deps.now().toISOString(), seconds: took },
  });
  deps.log(`배포 완료 ${shortSha(ctx.target)} (${took}초)`);
  await deps.notify(`✅ 배포 완료 · ${shortSha(ctx.target)} ${ctx.subject} (${took}초)`, { important: false });
  return { status: 'deployed' };
}

async function rollback(deps, ctx, reason) {
  const { target, prev, changes } = ctx;
  setPhase(deps, 'rolling-back', prev);
  deps.log(`배포 실패 — ${reason} → ${shortSha(prev)} 로 복귀`);
  await deps.stopServer();
  let rollbackError = null;
  try {
    await deps.checkout(prev);
    if (changes.needInstall) await deps.install();
    if (changes.needBuild) await deps.build();
  } catch (e) {
    rollbackError = errorText(e);
    deps.log(`복귀 중 오류 — ${rollbackError}`);
  }
  const rejected = [...new Set([...(deps.loadState().rejected ?? []), target])].slice(-MAX_REJECTED);
  patchState(deps, {
    phase: null, phaseTarget: null, verifying: null, current: prev, rejected,
    last: {
      result: rollbackError ? 'rollback-failed' : 'rolled-back', target, prev, subject: ctx.subject, reason,
      at: deps.now().toISOString(), ...(rollbackError ? { rollbackError } : {}),
    },
  });
  await deps.notify(
    `⚠️ 배포 실패 → 이전 버전으로 복귀\n`
      + `새 커밋: ${shortSha(target)} ${ctx.subject}\n사유: ${reason}\n복귀: ${shortSha(prev)}`
      + (rollbackError ? `\n복귀 중 오류: ${rollbackError}` : '')
      + '\n이 커밋은 다시 배포하지 않습니다. 고친 커밋을 push 하면 다시 시도합니다.',
    { important: true },
  );
  if (changes.runtimeChanged) return { status: 'self-update', target: prev };
  deps.startServer();
  return { status: 'rolled-back' };
}

/**
 * 실행기가 SELF_UPDATE_EXIT_CODE 로 다시 시작된 직후 호출한다.
 * 배포 확인이 남아 있으면 이어서 진행하고 결과를 반환한다. 할 일이 없으면 null(호출자가 평소처럼 서버를 띄운다).
 */
export async function resumeAfterRuntimeUpdate(deps) {
  const { verifying } = deps.loadState();
  if (!verifying) return null;
  if (deps.head() !== verifying.target) {
    patchState(deps, { verifying: null, phase: null, phaseTarget: null });
    return null;
  }
  deps.log(`실행기 갱신 후 배포 확인 계속 — ${shortSha(verifying.target)}`);
  return startAndVerify(deps, verifying);
}
