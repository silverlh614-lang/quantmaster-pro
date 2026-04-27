# Exit Rules Catalog

> 자동 생성 — `npm run build:exit-catalog` (스크립트: `scripts/generate_exit_rules_catalog.js`)
> Schema: [docs/EXIT_RULE_HEADER.md](./EXIT_RULE_HEADER.md)
> Generated: 2026-04-26

**총 1개 매도 규칙** (priority 오름차순).

| # | rule | priority | action | ratio | trigger | rationale | source |
|---|------|---------:|--------|------:|---------|-----------|--------|
| 1 | `R6_EMERGENCY_EXIT` | 1 | `PARTIAL_SELL` | 30% | `currentRegime === 'R6_DEFENSE' && !shadow.r6EmergencySold && shadow.quantity > 0` | 블랙스완 (시장 -3% 이상 하락 또는 VKOSPI 35+) 진입 시 보유 포지션 30% 즉시 시장가 청산. 1회 한정 (재발 방지 플래그). | `server/trading/exitEngine/rules/r6EmergencyExit.ts:2` |

---

신규 규칙 추가 시 `docs/EXIT_RULE_HEADER.md` 의 표준 schema 를 따라 헤더 작성 후 재생성.
