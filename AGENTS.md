# AGENTS.md — QuantMaster Pro (General AI Coding Agent Rules)

> **Scope:** Execution rules for general AI coding agents (Codex, OpenAI agents, VS Code / Copilot-style agents).
> Claude Code reads `CLAUDE.md`; both files share the **same invariants** and the **same `docs/ai/` reference router**.
> Keep this file short. Detailed rules live in `docs/ai/00`~`10` — read only the one document your task needs.
> Do **not** accumulate patch notes here (history → `docs/ai/10-patch-history-index.md`).

---

## 1. Project Identity

QuantMaster Pro is an AI-driven Korean-stock quant trading system. It emits a signal only for
tickers that pass **27 conditions + a 4-stage Gate (0/1/2/3)** filter, and executes real orders
through the KIS (Korea Investment & Securities) API.

- `src/` — frontend + shared types/services (Vite + React 19 + Zustand + TanStack Query)
- `server/` — Express backend (KIS client, trading engine, screener, Telegram)
- `scripts/` — self-validation pipeline (complexity / responsibility / exposure / sds / gemini)
- `docs/` — incident playbook, ADRs (`docs/adr/`), and the `docs/ai/` reference documents

Identity · the 9 invariants · data-trust grades (full detail) → `docs/ai/00-project-charter.md`

---

## 2. Non-Negotiable Rules

### 2.1 Nine Invariants (VERBATIM — never delete or alter)

These are the system's constitution. No ADR or patch may violate them. The Korean text below is
**canonical** (byte-identical to `CLAUDE.md` and `docs/ai/00-project-charter.md`). If an English gloss
ever seems to disagree with the Korean, the Korean wins.

1. Trading Engine은 항상 살아 있어야 한다.
2. Shadow Learning은 어떤 상황에서도 멈추면 안 된다.
3. 모든 판단은 단일 SourceSnapshot에서 출발한다.
4. R6, SELL_ONLY, HOLIDAY, 장전/장후, providerIssue는 SourceSnapshot을 바꾸지 않는다.
5. 위 상태들은 Policy, Confidence, ExecutionPermission, LearningLabel만 바꾼다.
6. Provider 장애는 market signal이 아니다.
7. AI_ESTIMATED 데이터는 live execution에 사용하면 안 된다.
8. 실거래 차단과 Shadow 판단 차단은 분리한다.
9. SourceSnapshot을 우회하여 Gate 내부에서 provider를 직접 조회하지 않는다.

**English gloss (Korean above is authoritative):** (1) the trading engine must always stay alive;
(2) shadow learning must never stop; (3) every decision starts from a single SourceSnapshot;
(4) R6 / SELL_ONLY / HOLIDAY / pre-&-post-market / providerIssue must not mutate the SourceSnapshot;
(5) those states change only Policy, Confidence, ExecutionPermission, LearningLabel; (6) a provider
outage is not a market signal; (7) AI_ESTIMATED (L4) data must never feed live execution; (8) blocking
real trades and blocking shadow judgement are separate concerns; (9) never bypass the SourceSnapshot to
query a provider directly inside a Gate.

### 2.2 Single-Channel Rules

1. **@responsibility tag** — every new file declares its responsibility (≤25 words) within the top 20 lines (`scripts/check_responsibility.js`).
2. **kisClient single channel** — all KIS API calls go through `server/clients/kisClient.ts`. No raw KIS REST.
3. **stockService / aiUniverseService single channel** — auto-trade & server-screener external data only via `src/services/stockService.ts`; AI-recommendation universe discovery only via `server/services/aiUniverseService.ts` (no direct KIS/KRX; ADR-0011; auto-trade paths must not import it).
4. **autoTradeEngine single channel** — with `AUTO_TRADE_ENABLED=true`, only the server-side `autoTradeEngine` places real orders. No client-side real orders.
5. **ARCHITECTURE.md boundaries** — re-confirm a module's Single Responsibility before editing it.
6. **Complexity limit** — 1,500 lines per file (`scripts/check_complexity.js`). Split on overflow (ADR first).
7. **precommit required** — never bypass hooks (`--no-verify`).

### 2.3 Data Trust Grades

L1 (KIS·KRX official → buy/sell decisions) / L2 (FRED·ECOS·DART → Gate input) /
L3 (Yahoo·Naver → fallback only after stale/sanity check) /
L4 (AI estimate → reference only, **never** a live trade decision — invariant #7).

---

## 3. Agent Workflow

Before editing code:

1. Identify the target domain.
2. From §5 Reference Docs Router, read **only** the one relevant `docs/ai/` document.
3. Do not modify unrelated files.
4. Prefer small, reversible patches — diff only, no broad rewrites.
5. Preserve every QuantMaster Pro invariant (§2.1).
6. Run the smallest relevant validation command (§7).
7. Report changed files, impact, and remaining risks (§8).

Complex work (a new Gate condition, decomposing `signalScanner`, trading-engine changes) should follow
the orchestrator/harness flow described in `docs/ai/01-architecture-map.md`. Simple questions
("what does this function do?", "fix one type error") need no harness — answer directly.

---

## 4. Patch Scope Rule

- **Diff only** — output only the changed lines; full output only for newly created files.
- **Standard PR prompt** — file / one-sentence task / scope (allowed vs off-limits) / ADR / constraints.
- **ADR vs patch type** — a new boundary or policy issues an ADR (`docs/adr/INDEX.md` "다음 발급" is the
  single source of the next number) and updates `INDEX.md`. A hotfix / consistency fix / diagnostic
  visibility change is patch type (0 ADRs issued, 0 INDEX edits).
- **One change-history line** — every PR appends exactly one row to `docs/ai/10-patch-history-index.md`.
- **byte-equivalent principle** — LIVE trading body 0-line change + 1-line ENV rollback + regression
  test + 0 KIS/KRX quota impact, whenever you touch anything near the live path.

Detail → `docs/ai/08-testing-checklist.md` (PR self-review) · `docs/ai/09-refactor-rules.md` (refactor scope)

---

## 5. Reference Docs Router

Read the one document whose trigger keywords match your task. All paths are under `docs/ai/`.
Each document's header carries "Read this file only when working on:" / "Do not read this file for:"
sections — those are the authoritative SRP boundaries.

| Trigger keywords | Doc |
|------------------|-----|
| project identity · 9 invariants · L1~L4 trust philosophy | `00-project-charter.md` |
| directories · module boundaries · agents · complexity status · harness workflow | `01-architecture-map.md` |
| Trading Engine · engineMode · executionAllowed · shadowAllowed · SELL_ONLY · R6 · SHADOW_ONLY · FOMC · sizing | `02-trading-engine-rules.md` |
| SourceSnapshot · providerIssue · marketSignal · confidence · ExecutionPermission · carry wiring · single channel | `03-source-snapshot-ssot.md` |
| Gate0/1/2/3 · scan_blockers · requiredScore · STRONG_BUY · RRR · VCP · candidateSnapshots · LastTrigger | `04-gate-system.md` |
| KIS/KRX/DART/Yahoo · fallback · stale · empty · circuit breaker · Last Good Value · provider health | `05-provider-policy.md` |
| Telegram Bot · channel routing CH1~4 · dedup · command registry · HTML sanitize · diagnostic output | `06-telegram-policy.md` |
| Shadow Learning · Counterfactual · Ghost Portfolio · LearningLabel · attribution · nightlyReflection | `07-learning-engine.md` |
| typecheck · test · validate:* · precommit · PR self-review · static guards | `08-testing-checklist.md` |
| refactor · file split · SRP · 1,500-line limit · baseline catalog · ADR INDEX SLA | `09-refactor-rules.md` |
| past ADR/patch history index — keyword-search rows only, **do not load the whole file** | `10-patch-history-index.md` |

External SSOT (outside `docs/ai/`): requirements/domain `README.md` · module-boundary single-responsibility
`ARCHITECTURE.md` · operations/incidents `docs/incident-playbook.md` · AI-collaboration & token policy
`CLAUDE_patch_section.md`.

---

## 6. Forbidden Behavior

- Violating any of the 9 invariants (§2.1) — stopping the Trading Engine, stopping Shadow Learning, or bypassing the SourceSnapshot.
- raw KIS REST calls outside `kisClient.ts`.
- client-side real orders — real orders flow only through the server `autoTradeEngine`.
- using AI_ESTIMATED (L4) data for a live trade decision.
- converting a provider outage into a bearish market signal (`providerIssue` ≠ bearish).
- silent catch — swallowing an error with no reason; an intentional ignore must be marked `/* SDS-ignore: <reason> */`.
- bypassing hooks (`--no-verify`) · leaving any file over the 1,500-line limit.
- accumulating patch notes in this file or `CLAUDE.md` (history belongs in `docs/ai/10-patch-history-index.md`).
- copying long Gate / Telegram / KIS / Shadow implementation detail into this file — link to `docs/ai/` instead.

---

## 7. Validation Rules

Run the smallest command that covers your change; never bypass precommit.

- `npm run lint` — typecheck (client + server `tsc`).
- the relevant `*.test.ts` — regression for the modules you touched.
- `npm run validate:all` — the full self-validation gate, required before commit.
- targeted guards as needed: `validate:complexity` (1,500-line limit), `validate:responsibility`,
  `validate:sds` (silent catch), `validate:exposure`, plus boundary / `dataTrust` guards.
  Full pipeline → `docs/ai/08-testing-checklist.md`.

**ADR-0146 PR self-review (5 categories):** (1) LIVE-trade safety (KIS/KRX quota · ENV rollback ·
regression) (2) wiring complete vs infra-only (3) ADR integrity (4) regression adequacy
(5) no policy-violation baseline regression.

---

## 8. Reporting Format

After a change, report:

1. **Changed files** — an explicit list; confirm no unrelated files were touched.
2. **Impact** — what behavior changes; when you claim it, confirm the LIVE trading body is unchanged.
3. **Validation** — which commands ran and their results. State failures honestly; do not hide a skip.
4. **Remaining risks / follow-ups** — open items, the 1-line ENV rollback, any pending wiring.

> **ONE-LINE PRINCIPLE:** tokens cost money — diff only, one pass, Telegram first.
> Shared invariants and all detail live in `docs/ai/`; read only what your task needs.
