# PR-XX 진단 로직 추출 + 메뉴 자동 동기화 (P0+P1)

브랜치: `claude/health-diagnostics-menu-sync-KA7e9`

## 결정 1 — 메뉴 자동 동기화 (P0) SSOT 위치

옵션 비교:
- **A. commandRegistry 통합** — 메타 6개를 commandRegistry 에 register, visibility='MENU'.
  - 장점: 단일 SSOT
  - 단점: webhookHandler.ts 의 메타 case 6개를 default 분기 / 흡수해야 함 → Stage 2 Phase B 재변경 → 회귀 위험.
- **B. metaCommands.ts 에 MENU SSOT export** — 텔레그램 메뉴 8개를 `MENU_BOT_COMMANDS` 로 export, telegramClient 가 import.
  - 장점: 변경 최소(약 10줄), webhookHandler 무수정.
  - 단점: 두 SSOT (commandRegistry / MENU_BOT_COMMANDS) 가 공존, drift 위험은 명령 추가 시점 1회 메뉴 갱신 의무.
- **C. 두 소스 결합** — telegramClient 가 META_COMMAND_REGISTRY + commandRegistry MENU 둘 다 조회.
  - 장점: drift 차단 강도↑
  - 단점: 결합 로직이 telegramClient 에 들어와 응집도 ↓.

**채택: B + 보강** — `metaCommands.ts` 가 메타 명령어 정의를 이미 가지고 있으므로 거기에 `buildBotMenuCommands()` 헬퍼를 추가해 `META_COMMAND_REGISTRY` 에서 자동 생성 + /help /status 2개를 합성. telegramClient 는 import. 메타 명령어가 META_COMMAND_REGISTRY 단일 SSOT 에서 파생되므로 메타 추가 시 자동 메뉴 갱신 — drift 차단.

`/help /status` 두 일반 명령어가 메뉴에 노출되는 부분은 metaCommands.ts 에 명시 상수 (FIXED_MENU_PRELUDE) 로 둔다 — 의도적 노출 (헬프 + 상태 1줄 진입점).

## 결정 2 — server/health/ 신규 boundary

옵션 비교:
- **server/health/diagnostics.ts** (신규 디렉토리) — 채택.
  - ARCHITECTURE.md 에 boundary 추가.
  - 단일 책임: "수집". 포맷팅(텍스트 vs JSON)은 호출자가 담당.
- server/telegram/health/* — boundary 위반 (HTTP router 가 telegram 디렉토리 import).
- server/utils/healthSnapshot.ts — utils 잡종 디렉토리 사용 회피, 진단은 도메인이 있는 작업.

ARCHITECTURE.md 추가 라인:
```
| `server/health/diagnostics.ts` | Collect system health snapshot (8-axis) — shared by /health Telegram cmd and /api/health/pipeline HTTP route |
```

## 타입 계약 (HealthSnapshot)

```typescript
export interface HealthSnapshot {
  // 공통 카운트
  watchlistCount: number;
  activePositions: number;
  // 운영 상태
  emergencyStop: boolean;
  dailyLossPct: number;
  dailyLossLimit: number;
  dailyLossLimitReached: boolean;
  // 자동매매
  autoTradeEnabled: boolean;
  autoTradeMode: string;
  // KIS
  kisConfigured: boolean;
  kisTokenHours: number;
  kisTokenValid: boolean;
  realDataTokenHours: number;
  // KRX (systemRouter 측에서만 쓰지만 SSOT 통일을 위해 같이 수집)
  krxTokenConfigured: boolean;
  krxTokenValid: boolean;
  krxCircuitState: string;
  krxFailures: number;
  // 스캐너
  lastScanTs: number;
  lastBuyTs: number;
  lastScanSummary: ScanSummary | null;
  // 외부 API 상태
  yahoo: { status: string; detail: string; lastSuccessAt: number; consecutiveFailures: number };
  geminiRuntime: { status: string; reason?: string };
  // 인프라
  volumeOk: boolean;
  volumeError?: string;
  streamStatus: { connected: boolean; subscribedCount: number; ... };
  // 운영
  uptimeHours: number;
  memMB: number;
  commitSha: string;
  // verdict
  verdict: HealthVerdict;
}

export interface HealthProbeResult {
  yahoo: { ok: boolean; detail: string };
  dart: { ok: boolean; detail: string };
}

// 외부 probe (Yahoo/DART) 는 옵셔널 — health.cmd 만 실행, systemRouter 는 미실행.
export async function collectHealthSnapshot(): Promise<HealthSnapshot>;
export async function runExternalProbes(timeoutMs?: number): Promise<HealthProbeResult>;
```

## 영향 파일

- 신규: `server/health/diagnostics.ts` + `server/health/diagnostics.test.ts`
- 신규: `server/telegram/menuSync.test.ts` (P0 회귀 가드)
- 수정: `server/telegram/metaCommands.ts` (+`buildBotMenuCommands` export)
- 수정: `server/alerts/telegramClient.ts` (`setTelegramBotCommands` 본체 자동 생성으로 교체)
- 수정: `server/telegram/commands/system/health.cmd.ts` (thin wrapper — 데이터 수집은 diagnostics, 텍스트 포맷만)
- 수정: `server/routes/systemRouter.ts` (`/health/pipeline` 본체를 collectHealthSnapshot 호출로 교체)
- 수정: `ARCHITECTURE.md` (server/health/ boundary 추가)
- 수정: `CLAUDE.md` (변경 이력 추가)

## DoD

- [ ] `npm run lint` pass
- [ ] `npm run validate:all` pass (gemini/complexity/sds/exposure/responsibility/boundary 6종)
- [ ] `vitest server/health server/telegram/menuSync.test.ts` 신규 ≥10 케이스 pass
- [ ] `vitest server/telegram` 기존 무회귀 (commandRegistry/metaCommands/tradeFlowSimulation/deprecationReport/aiUniverseSnapshotRepo)
- [ ] `npm run precommit` pass
- [ ] KIS/KRX 자동매매 quota 0 침범 (절대 규칙 #2/#3/#4)
- [ ] webhookHandler.ts 무수정 (Phase B 회귀 위험 차단)

## 비범위 (P2 별도 PR)

- 부팅 reconcile dry-run (server/index.ts ~15줄)
- scheduleCatalog.ts wrapJob 메트릭 누적 (runCount/failCount/lastErrorMessage)
