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
 *   (V1 universeScanner 계열은 LEGITIMATE_BUDGET_LAZY 로 영구 허용 재분류 — ADR-0558, burn-down 종결.)
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
 * baseline allowlist — 두 종류로 분류된다 (P2 묶음2 분류 작업, ADR-0555):
 *   (1) BURN_DOWN  — 진짜 projection/단일통로 위반. snapshot factory 완성 후 제거 대상 (V3 잔존).
 *   (1b) LEGITIMATE_BUDGET_LAZY — candidate-universe lazy/budget fetch(quota 절약 정당 분기, ADR-0558).
 *       factory eager 통합 시 budget 우회·dedup 파괴(불변식 #9)이므로 비-통합이 헌법 정합. 영구 허용
 *       (V1 universeScanner 계열). burn-down 대상 아님 — 단일 소유는 supply 공유 단일함수로 이미 충족.
 *   (2) LEGITIMATE_DIAGNOSTIC — 명령의 *목적 자체가* provider health/회로/raw 응답 진단이거나
 *       (provider 상태 = 데이터가 아니라 메타, 불변식 #6), 실주문 실행 경로(kisClient 단일통로 정당),
 *       또는 ledger-truth 읽기다. 시장상태/판단(bullish·bearish·gate결과·후보)을 추론·표시하지 *않는다*.
 *       → burn-down 대상 아님(영구 허용). 신규 *유사* 진단 명령 복제는 여전히 차단(allowlist 미등재면 fail).
 * 신규 위반은 여기 없으면 즉시 fail. (감사 grep + ADR-0555 §Consequences Grandfather 근거)
 *
 * P2 묶음2 분류 결과(2026-06-03): V5/V5-extended telegram callsite 전부 (2) LEGITIMATE_DIAGNOSTIC
 *   으로 확정 — (1) 진짜 projection 위반 (A) 0건(재배선 없음). V1(candidate-universe)은 ADR-0558 로
 *   LEGITIMATE_BUDGET_LAZY 영구 허용 종결 → 남은 burn-down 대상은 V3(investor-flow marketProgramFlowProvider)뿐.
 */
const BASELINE_ALLOWLIST = new Map([
  // ── V1 candidate-universe lazy/budget fetch (LEGITIMATE_BUDGET_LAZY, 영구 허용 — ADR-0558) ──
  //   universeScanner Stage1/2 의 provider 직접 호출은 *quota 절약을 위한 정당한 lazy/budget 분기* 다
  //   (KIS_LOAD_STATE budget max25 universeScanner.ts:187 / 통과 후보만 fetch :509 / 음수 changePercent
  //   SKIP 제외). factory eager 전수수집(collectUnifiedSnapshot, symbolDataCollector.ts:579) 으로 강제
  //   통합하면 budget 이전 60개 eager fetch = quota 순증 + SKIP-제외 dedup 경계 파괴(불변식 #9 위반) →
  //   비-통합이 헌법 정합. supply(fetchKisInvestorTradeByStockDaily, query.ts:901)는 factory 와 *이미*
  //   동일 단일함수 공유 = 단일 소유 충족. → burn-down 대상 아님(영구 허용). 신규 *유사* lazy/budget
  //   복제는 여전히 차단(allowlist 미등재 시 fail). V5 LEGITIMATE_DIAGNOSTIC 선례와 동일 패턴(ADR-0558).
  ['server/screener/universeScanner.ts', 'LEGITIMATE_BUDGET_LAZY (영구 허용, ADR-0558) / audit V1 — quota 절약 lazy/budget fetch(max25, 통과 후보만), supply 는 factory 와 단일함수 공유. factory eager 통합 시 불변식 #9 위반 → 비-통합 정당. burn-down 대상 아님.'],
  // R3 grandfather: 기존 screener provider 통로(quote/technicals SSOT adapter 포함).
  //   universeScanner 패턴의 *신규* 복제만 차단 — 아래 기존 importer 는 candidate/quote 발굴 단일통로 자산.
  ['server/screener/adapters/kisQuoteAdapter.ts', 'LEGITIMATE_BUDGET_LAZY (영구 허용, ADR-0558) / audit V1-extended (quote SSOT adapter — technicalQuoteRouter 소유, lazy/budget 발굴 자산).'],
  ['server/screener/adapters/krxScreenerAdapter.ts', 'LEGITIMATE_BUDGET_LAZY (영구 허용, ADR-0558) / audit V1-extended (KRX screener adapter — quote/technicals lazy 발굴).'],
  ['server/screener/dynamicUniverseExpander.ts', 'LEGITIMATE_BUDGET_LAZY (영구 허용, ADR-0558) / audit V1-extended (universe 확장 — candidate lazy 발굴).'],
  ['server/screener/kisChartDataFetcher.ts', 'LEGITIMATE_BUDGET_LAZY (영구 허용, ADR-0558) / audit V1-extended (KIS 차트 fetch — technicals lazy 발굴).'],
  ['server/screener/stockScreener.ts', 'LEGITIMATE_BUDGET_LAZY (영구 허용, ADR-0558) / audit V1-extended (스크리너 본체 — candidate lazy/budget 발굴).'],

  // ── V3 investor-flow provider 우회 (P3 burn-down) ──
  ['server/trading/signalScanner/marketProgramFlowProvider.ts', 'P3 burn-down 예정 / audit V3 (kis/krx program flow 직접 fetch)'],

  // ── V2 providerHealth mixed: 정정 완료(불변식 #6 isolation) → allowlist 제거 (P2 묶음1) ──

  // ── V5 telegram projection (P2 묶음2 분류 완료, ADR-0555) ──
  //    재배선 대상 (A) projection 위반 0건. 두 callsite 모두 (B) LEGITIMATE_DIAGNOSTIC 으로 확정:
  //    - dartProviderHealth.cmd: 명령의 *목적 자체가* DART provider/Gate2 cache 건강 진단(메타)이다.
  //      getGate2DartProviderHealth() 는 apiKey/cache/rateLimit/lastHttpStatus 등 provider 메타만
  //      반환(executionImpact=NONE) — 시장상태/판단(bullish·bearish·gate·후보) 추론 0. 불변식 #6
  //      "provider 상태 = 데이터가 아니라 메타". → 영구 허용(burn-down 대상 아님).
  //    - snapshotBundle.ts:273 은 import 위반이 아니다(provider client import 0). 정본 스캔 요약의
  //      providerIssue/marketSignal/providerIssueDistribution 를 boolOf/topKey 로 *pass-through
  //      projection* 할 뿐, 렌더 시점 재계산/재추론 0 (telegramSnapshotBundle.test.ts 로 잠금).
  ['server/telegram/commands/system/dartProviderHealth.cmd.ts', 'LEGITIMATE_DIAGNOSTIC (영구 허용) / audit V5 — 명령 목적=DART provider health 메타 진단, 시장판단 추론 0 (불변식 #6). 재배선 대상 아님.'],
  ['server/telegram/renderers/snapshotBundle.ts', 'LEGITIMATE_DIAGNOSTIC (영구 허용) / audit V5 — projection-only pass-through, provider import 0·재계산 0 (ADR-0525/0526, telegramSnapshotBundle.test.ts 잠금).'],

  // ── V5-extended: telegram command provider read (audit grep, P2 묶음2 분류 완료) ──
  //    ADR-0555 Rule 2 commands/** projection-only 경계상 기존 등재. 분류 결과 전부 (B) — provider
  //    health/회로 진단(메타) · 실주문 실행(kisClient 단일통로 정당) · ledger-truth 읽기다. 어느 것도
  //    시장상태/판단을 추론·표시하지 않으므로 LEGITIMATE_DIAGNOSTIC(영구 허용). 신규 *유사* 복제는
  //    여전히 차단(allowlist 미등재 시 fail).
  ['server/telegram/commands/system/gate2ExternalRefresh.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — Gate2 external cache 수동 refresh(운영 진단 액션), 시장판단 추론 0.'],
  ['server/telegram/commands/system/healthFull.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — krxClient/다중 provider 헬스 통합 진단(메타).'],
  ['server/telegram/commands/system/programMarket.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — KIS program 매매 추이 read-only 진단(메타, 1회).'],
  ['server/telegram/commands/system/programMarketProbe.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — KIS program 파라미터 조합 read-only probe(메타).'],
  ['server/telegram/commands/system/programMarketRaw.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — KIS program raw 응답 진단 노출(메타, Patch-004).'],
  ['server/telegram/commands/system/programToday.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — KIS 종목별 program 매매 read-only 진단(메타, 1회).'],
  ['server/telegram/commands/system/scanBlockers.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — kisClient health section 진단(메타); 차단 분포는 정본 scan summary projection.'],
  ['server/telegram/commands/system/sectorIscdProbe.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — KIS sector iscd brute-force read-only probe(메타 검증).'],
  ['server/telegram/commands/system/supplyHealth.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — 수급 채널 source/freshness/coverage read-only 진단(메타).'],
  ['server/telegram/commands/trade/cancel.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — kisPost 미체결 주문 취소(실행 경로, kisClient 단일통로 정당).'],
  ['server/telegram/commands/trade/krxScan.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — krxClient 서킷/캐시 reset 후 발굴 재실행(운영 액션).'],
  ['server/telegram/commands/trade/sell.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — placeKisSellOrder LIVE 매도(실행 경로, autoTrade/kisClient 단일통로 정당).'],
  ['server/telegram/commands/watchlist/add.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — 워치리스트 추가용 현재가/종목명 조회(표시 데이터, 시장판단 추론 0).'],
  ['server/telegram/commands/learning/circuits.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — KIS/KRX 회로 차단 상태 read-only 진단(메타).'],
  ['server/telegram/commands/learning/resetCircuits.cmd.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — KIS/KRX 회로 즉시 reset(운영 액션).'],
  ['server/telegram/commands/positions/readers/liveKisPositionReader.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — live KIS 보유 = ledger truth 읽기(position SSOT).'],
  ['server/telegram/commands/positions/shadowPositionSources.ts', 'LEGITIMATE_DIAGNOSTIC / V5-ext — position 표시용 현재가(표시 데이터, 시장판단 추론 0).'],
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
      `(allowlist baseline ${grandfathered.length}건: V1 LEGITIMATE_BUDGET_LAZY 영구 허용(ADR-0558) ` +
      `+ V5 LEGITIMATE_DIAGNOSTIC + V3 burn-down 잔존).`,
  );
}

// 테스트에서 재사용할 수 있도록 export
export { checkFile, BASELINE_ALLOWLIST, PROVIDER_IMPORT_TOKENS, RULES };

// 직접 실행 시에만 main() (테스트 import 시 미실행)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
