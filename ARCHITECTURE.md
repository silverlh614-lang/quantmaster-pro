# ARCHITECTURE.md

This document defines module boundaries to guide AI-assisted refactoring and serve as a code-review checklist.
When modifying any file, ensure changes stay within the owning module's stated responsibility.

---

## Module Boundaries

> **Path note**: `src/` contains frontend and shared source; `server/` (root-level) contains the standalone Express server (routes, clients).

| Module | Single Responsibility (<= 25 words) |
|--------|--------------------------------------|
| `src/services/quantEngine.ts` (gateEngine) | Evaluate Gate 0/1/2/3 conditions and compute final stock score |
| `src/services/quantEngine.ts` (bearEngine) | Execute bear-market strategies: seasonality, screener, Kelly, simulator |
| `src/services/stockService.ts` | Fetch and aggregate stock data from Yahoo Finance, DART, KIS, and Gemini |
| `src/services/autoTrading.ts` | Handle client-side manual-trigger trading: shadow trades, slippage, Kelly orders |
| `src/services/ecosService.ts` | Query Bank of Korea ECOS API for macro indicators: rate, FX, M2, GDP, trade |
| `src/utils/indicators.ts` | Compute technical indicators: RSI, MACD, Bollinger Bands, Ichimoku, VCP |
| `server/trading/signalScanner.ts` | Run 24/7 server-side automated signal scanning and trade execution via KIS order API |
| `server/quantFilter.ts` | Evaluate 8 server-side Gate conditions from Yahoo Finance data with adaptive weights |
| `server/clients/kisClient.ts` | Proxy all KIS API calls with token management and VTS/real switching |
| `server/routes/kisRouter.ts` | Expose REST endpoints that delegate KIS supply, short-selling, and order calls |
| `server/routes/autoTradeRouter.ts` | Expose REST endpoints for auto-trade control, watchlist management, and macro state |

---

## Boundary Rules

- **gateEngine boundary**: Functions named `evaluateGate*`, `evaluateStock`, `computeSignalVerdict`, and related scoring helpers belong here. Do not add data-fetching or order logic.
- **bearEngine boundary**: Functions named `evaluateBear*`, `evaluateInverseGate*`, `evaluateMarketNeutral`, `evaluateIPS`, `evaluateFSS` belong here. Do not mix with bull-market Gate evaluation.
- **kisClient boundary**: All raw KIS REST calls (`kisGet`, `kisPost`, `getKisToken`) must go through this module. No other module may call the KIS API directly.
- **stockService boundary**: All external data fetches (Yahoo, DART, Gemini, KIS via proxy) originate here. quantEngine must not perform network requests.
- **autoTradeEngine boundary**: This is the sole channel for real order execution on the server. Client-side modules must not place live orders when `AUTO_TRADE_ENABLED=true`.

---

## Planned Decompositions (advisory)

The following files currently exceed `scripts/check_complexity.js` thresholds. Their
planned decomposition is documented in `docs/adr/`. Until migration completes, the
current file continues to own the listed responsibility above.

| File | Lines | ADR | Planned sub-modules |
|------|------:|-----|---------------------|
| `server/trading/signalScanner.ts` | 1,820 | [ADR-0001](./docs/adr/0001-signalScanner-decomposition.md) | `signalScanner/{index,preflight,candidateSelect,perSymbolEvaluation,approvalQueue,scanDiagnostics}` |
| `server/telegram/webhookHandler.ts` | 1,700 | TBD (P1) | — |
| `server/screener/stockScreener.ts` | 1,571 | TBD (P1) | — |
| `server/trading/exitEngine.ts` | 1,233 | TBD (P2) | — |

When implementing a decomposition, follow `.claude/skills/server-refactor-orchestrator/SKILL.md` 6-Phase flow and update this table.
