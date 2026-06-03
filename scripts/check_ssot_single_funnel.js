#!/usr/bin/env node
/**
 * @responsibility SSOT 단일통로 정적 가드 — Gate evaluator·Telegram projection·candidate-universe
 *   경계에서 provider client 직접 import 신규 위반을 커밋타임 차단(ADR-0555 P1, baseline allowlist grandfather).
 *
 * 검사 규칙 (Information Ownership Registry / 03-source-snapshot-ssot.md):
 *   R1  Gate evaluator 격리: server/quant/conditions/** 는 SourceSnapshot 입력만 (불변식 #9).
 *       → kisClient/krxClient/raw provider client 의 "값(runtime) import" 또는 동적 import 금지.
 *         (import type 은 허용 — 타입 의존은 fetch 가 아님.)
 *   R2  Telegram projection 격리: server/telegram/renderers/** + server/telegram/commands/** 는
 *       정본 읽기·렌더만 (불변식 #3). → provider client 직접 import 금지.
 *         (positions reader 류 ledger 읽기는 grandfather allowlist 로 오탐 격리.)
 *   R3  candidate-universe 단일통로: universeScanner 의 provider 직접 호출 패턴이 신규 파일로
 *       복제 확산되지 않도록 — candidate 발굴 단일통로(quantitativeCandidateGenerator/
 *       candidatePoolBuilder/aiUniverseService/universeScanner) 외부의 신규 파일에서
 *       동일 provider import 패턴 금지.
 *
 * baseline allowlist: 기존 위반(V1/V3/V5)은 파일 경로 단위로 grandfather → 신규 위반만 EXIT 1.
 *   (V2 dartProviderSignalSplit 은 불변식 #6 isolation 정정 완료로 P2 묶음1 에서 제거됨.)
 * 위반 발견 시 [FAIL] + 파일:라인 + 위반 규칙 + 허용 경로(SourceSnapshot.<field>) 안내, EXIT 1.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/**
 * Provider client 토큰 — import 경로(소문자) 부분 문자열 매칭.
 * 이 경로에서 *값*을 import 하면 provider 직접 fetch 통로다.
 * 주의: 일부는 ledger/truth 읽기(positions reader)일 수 있어 allowlist 로 오탐 격리.
 */
const PROVIDER_IMPORT_TOKENS = [
  { token: '/clients/kisclient', label: 'kisClient (KIS provider)' },
  { token: '/clients/krxclient', label: 'krxClient (KRX provider)' },
  { token: '/clients/dartfinancialclient', label: 'dartFinancialClient (DART provider)' },
  { token: '/clients/naverfinanceclient', label: 'naverFinanceClient (Naver provider)' },
  { token: '/clients/yahooconsensusclient', label: 'yahooConsensusClient (Yahoo provider)' },
  { token: 'gate2externaldataprovider', label: 'gate2ExternalDataProvider (DART/외부 provider)' },
];

/**
 * 도메인별 스캔 규칙. 각 규칙은 scanDir + 허용 SourceSnapshot 통로 안내.
 */
const RULES = [
  {
    id: 'R1',
    name: 'Gate-evaluator-isolation',
    scanDir: 'server/quant/conditions',
    allowedFunnel: 'SourceSnapshot.featuresBySymbol / FeatureSnapshot (carry)',
    invariant: '불변식 #9 (Gate 는 provider 직접 조회 금지)',
  },
  {
    id: 'R2',
    name: 'Telegram-projection-isolation',
    scanDir: 'server/telegram/renderers',
    allowedFunnel: 'snapshotBundle 정본(projection) 읽기',
    invariant: '불변식 #3 (렌더 시점 provider 직접 조회 금지)',
  },
  {
    id: 'R2',
    name: 'Telegram-projection-isolation',
    scanDir: 'server/telegram/commands',
    allowedFunnel: 'snapshotBundle 정본(projection) 읽기 / ledger truth 읽기',
    invariant: '불변식 #3 (렌더·명령 projection only)',
  },
  {
    id: 'R3',
    name: 'candidate-universe-single-funnel',
    scanDir: 'server/screener',
    allowedFunnel:
      'candidate 단일통로(quantitativeCandidateGenerator → candidatePoolBuilder / aiUniverseService)',
    invariant: 'ADR-0011 (candidate-universe 단일통로)',
  },
];

/**
 * baseline allowlist — 기존 위반(파일 경로 단위). P3~P5 burn-down 예정.
 * 신규 위반은 여기 없으면 즉시 fail. (감사 grep + ADR-0555 §Consequences Grandfather 근거)
 */
const BASELINE_ALLOWLIST = new Map([
  // ── V1 candidate-universe 직접 provider 호출 (P3 burn-down) ──
  ['server/screener/universeScanner.ts', 'P3 burn-down 예정 / audit V1 (provider 직접 fetch, snapshot 입력화 예정)'],
  // R3 grandfather: 기존 screener provider 통로(quote/technicals SSOT adapter 포함).
  //   universeScanner 패턴의 *신규* 복제만 차단 — 아래 기존 importer 는 candidate/quote 발굴 단일통로 자산.
  ['server/screener/adapters/kisQuoteAdapter.ts', 'P3 burn-down 검토 / audit V1-extended (quote SSOT adapter — technicalQuoteRouter 소유)'],
  ['server/screener/adapters/krxScreenerAdapter.ts', 'P3 burn-down 검토 / audit V1-extended (KRX screener adapter — quote/technicals 발굴)'],
  ['server/screener/dynamicUniverseExpander.ts', 'P3 burn-down 검토 / audit V1-extended (universe 확장 — candidate 발굴)'],
  ['server/screener/kisChartDataFetcher.ts', 'P3 burn-down 검토 / audit V1-extended (KIS 차트 fetch — technicals 발굴)'],
  ['server/screener/stockScreener.ts', 'P3 burn-down 검토 / audit V1-extended (스크리너 본체 — candidate 발굴)'],

  // ── V3 investor-flow provider 우회 (P3 burn-down) ──
  ['server/trading/signalScanner/marketProgramFlowProvider.ts', 'P3 burn-down 예정 / audit V3 (kis/krx program flow 직접 fetch)'],

  // ── V2 providerHealth mixed: 정정 완료(불변식 #6 isolation) → allowlist 제거 (P2 묶음1) ──

  // ── V5 telegram projection 직접 provider 조회 (P5/별건 burn-down) ──
  ['server/telegram/commands/system/dartProviderHealth.cmd.ts', 'P5 burn-down 예정 / audit V5 (gate2ExternalDataProvider 직접 조회)'],
  ['server/telegram/renderers/snapshotBundle.ts', 'P5 burn-down 예정 / audit V5 (projection-only — 재계산 금지; import 위반 아님, ADR 명시 grandfather)'],

  // ── V5-extended: telegram command provider read (audit grep, P5 burn-down 트랙) ──
  //    ADR-0555 Rule 2 의 commands/** projection-only 경계상 기존 위반. trade/* 실주문·
  //    system/* 진단 probe·positions/* ledger truth 읽기 포함 — 신규 복제만 차단, 기존은 grandfather.
  ['server/telegram/commands/system/gate2ExternalRefresh.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (gate2External 직접 refresh)'],
  ['server/telegram/commands/system/healthFull.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (krxClient 헬스 직접 조회)'],
  ['server/telegram/commands/system/programMarket.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis program 직접 fetch — 진단)'],
  ['server/telegram/commands/system/programMarketProbe.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis program probe — 진단)'],
  ['server/telegram/commands/system/programMarketRaw.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis program raw — 진단)'],
  ['server/telegram/commands/system/programToday.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis program 직접 fetch — 진단)'],
  ['server/telegram/commands/system/scanBlockers.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kisClient health section — 진단)'],
  ['server/telegram/commands/system/sectorIscdProbe.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis sector index probe — 진단)'],
  ['server/telegram/commands/system/supplyHealth.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis supply 직접 fetch — 진단)'],
  ['server/telegram/commands/trade/cancel.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kisPost 주문취소 — 실행 경로)'],
  ['server/telegram/commands/trade/krxScan.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (krxClient 캐시 reset — 진단)'],
  ['server/telegram/commands/trade/sell.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (placeKisSellOrder — 실행 경로)'],
  ['server/telegram/commands/watchlist/add.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis 현재가/종목명 조회)'],
  ['server/telegram/commands/learning/circuits.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis circuit stats 읽기)'],
  ['server/telegram/commands/learning/resetCircuits.cmd.ts', 'P5 burn-down 예정 / audit V5-extended (kis circuit reset)'],
  ['server/telegram/commands/positions/readers/liveKisPositionReader.ts', 'P5 burn-down 예정 / audit V5-extended (live KIS 보유 — ledger truth 읽기, 오탐 가능)'],
  ['server/telegram/commands/positions/shadowPositionSources.ts', 'P5 burn-down 예정 / audit V5-extended (현재가 — position 표시용, 오탐 가능)'],
]);

// import ... from '...'  /  export ... from '...'  /  import('...')  /  await import('...')
const IMPORT_RE =
  /(?:import|export)\b([^;]*?)\bfrom\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** import 절이 type-only 인가? `import type ...` 또는 `from` 앞 절이 type. */
function isTypeOnlyImport(line) {
  return /\bimport\s+type\b/.test(line) || /\bexport\s+type\b/.test(line);
}

function walk(absDir, relDir, out) {
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    const abs = join(absDir, name);
    const rel = relDir ? `${relDir}/${name}` : name;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, rel, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) {
      out.push({ abs, rel });
    }
  }
}

function checkFile(absPath, relPath, rule) {
  const src = readFileSync(absPath, 'utf-8');
  const lines = src.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // 주석 라인 제외 (// 또는 * 로 시작하는 라인)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (isTypeOnlyImport(line)) continue; // import type 은 fetch 가 아님 (R1 types.ts 오탐 방지)

    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(line)) !== null) {
      const clause = m[1] || '';
      const spec = (m[2] || m[3] || '').toLowerCase();
      if (!spec) continue;
      // `import { type X } from` 처럼 모든 specifier 가 type-only 면 제외
      const isInlineTypeOnly =
        /^\s*\{\s*type\s+[^}]*\}\s*$/.test(clause) && !/,/.test(clause.replace(/type\s+\w+/g, ''));
      if (isInlineTypeOnly) continue;
      for (const { token, label } of PROVIDER_IMPORT_TOKENS) {
        if (spec.includes(token)) {
          violations.push({
            relPath,
            lineNo: i + 1,
            spec: m[2] || m[3],
            label,
            ruleId: rule.id,
            ruleName: rule.name,
            allowedFunnel: rule.allowedFunnel,
            invariant: rule.invariant,
          });
        }
      }
    }
  }
  return violations;
}

function main() {
  const allViolations = [];
  let scannedCount = 0;

  for (const rule of RULES) {
    const absDir = join(ROOT, rule.scanDir);
    const files = [];
    walk(absDir, rule.scanDir, files);
    scannedCount += files.length;
    for (const { abs, rel } of files) {
      allViolations.push(...checkFile(abs, rel, rule));
    }
  }

  // baseline allowlist 분리
  const newViolations = [];
  const grandfathered = [];
  for (const v of allViolations) {
    if (BASELINE_ALLOWLIST.has(v.relPath)) {
      grandfathered.push(v);
    } else {
      newViolations.push(v);
    }
  }

  if (newViolations.length > 0) {
    console.error('[SSOTSingleFunnel] [FAIL] 신규 SSOT 단일통로 위반 (ADR-0555 P1)');
    console.error(
      '  각 정보는 단일 소유 모듈(SourceSnapshot)로만 흘러야 합니다. provider client 직접 import 금지.\n',
    );
    for (const v of newViolations) {
      console.error(
        `  [${v.ruleId}/${v.ruleName}] ${v.relPath}:${v.lineNo}\n` +
          `      금지 import → '${v.spec}'  [${v.label}]\n` +
          `      ${v.invariant}\n` +
          `      허용 경로: ${v.allowedFunnel}\n`,
      );
    }
    console.error(`  총 ${newViolations.length}건 신규 위반 (allowlist 미등재).`);
    console.error(
      '  → 신규 파일은 처음부터 SourceSnapshot 통로를 사용하세요. 기존 baseline 이면 ADR-0555 누락 가능 — architect 확인.',
    );
    process.exit(1);
  }

  console.log(
    `[SSOTSingleFunnel] [OK] — ${scannedCount}개 파일 검사, 신규 위반 0건 ` +
      `(grandfather baseline ${grandfathered.length}건 등재됨, P3~P5 burn-down 대상).`,
  );
}

// 테스트에서 재사용할 수 있도록 export
export { checkFile, BASELINE_ALLOWLIST, PROVIDER_IMPORT_TOKENS, RULES };

// 직접 실행 시에만 main() (테스트 import 시 미실행)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
