# ADR-0495 — Sector Index Master Seed & Mapping Repair

## Status
Accepted — diagnostic seed/cache/mapping repair only.

## Context
The Fresh Data Supply Layer closed loop exposes `SECTOR_ENERGY` as `DATA_UNAVAILABLE` with 0% coverage because the KRX sector index master, sector-index mapping, and stock-daily fallback structure are all missing. This blocks observation of SectorEnergy quality, but the absence of provider data must not be interpreted as market weakness.

## Decision
Add an ADR-0495 static, sanitized Sector Index Master seed plus Sector Index Code Mapping and SectorEnergy fallback structure. The seed is intentionally conservative:

- It creates canonical sector records for 조선, 방산, 원자력, 반도체, 자동차, 2차전지, 바이오, 인터넷, 게임, 금융, 증권, 보험, 은행, 화학, 정유, 철강, 기계, 건설, 전기전자, 운송장비, 산업재, 필수소비재, 음식료, 유통, 엔터/미디어.
- It does **not** invent KRX-verified index codes. Unverified sectors use `INTERNAL_PROXY:<canonicalName>` with `provider=INTERNAL` and `confidence=PARTIAL`.
- Safe aliases such as `조선주`, `방산주`, `원전`, `이차전지`, and `반도체주` map to canonical sector names.
- Unsafe aggregate aliases such as `조방원` remain `UNRESOLVED` with `isSafeAutoAlias=false`.
- Fallback records are diagnostic-only `STOCK_DAILY_PROXY` structures with empty representative symbol arrays unless verified project watchlists provide symbols later.

ADR-0488 consumes ADR-0495 coverage in its SectorEnergy master report, and `/fresh_data_status` displays verified/partial/unknown coverage buckets, unresolved names, safe/unsafe alias candidates, fallback mode, and guardrails. ADR-0494 promotion audit input receives the ADR-0495 normalized coverage and missing-index-code evidence, but stage promotion remains an audit recommendation only.

## Guardrails
- `executionImpact=NONE`.
- `liveExecutionAllowed=false`.
- `rawPayloadPersistenceAllowed=false`.
- `sectorBoostAllowed=false`.
- `strongBuyAllowed=false`.
- Provider/cache/source missing is `providerIssue=true` diagnostic evidence, not `marketSignal=true`.
- UNKNOWN remains UNKNOWN; null and missing values are not converted to zero.
- Aggregate sector/basket aliases are separated from tradeable sector/index rows.
- No Gate, Kelly, requiredScore, KIS order path, live order path, or automatic CORE/GATED/WEIGHTED promotion behavior is changed.

## Consequences
SectorEnergy can move from a non-observable 0% master/mapping state to an OBSERVE/PARTIAL diagnostic state with partial internal-proxy coverage. This does not enable SectorEnergy leadership confidence for trading, sector boost, or STRONG_BUY. A future ADR may replace internal proxies with verified KRX index codes after source verification and sufficient history.
