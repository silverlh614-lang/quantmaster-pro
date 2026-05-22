// @responsibility Regime transition playbook text for Telegram display. Display only; no execution authority.

import type { RegimeLevel } from '../../src/types/core.js';

interface RegimePlaybook {
  allow: string[];
  caution: string[];
  forbid: string[];
  expectedDuration: string;
}

const PLAYBOOKS: Record<RegimeLevel, RegimePlaybook> = {
  R1_TURBO: {
    allow: [
      'positionPolicy: maxPositions=8, maxGrossExposure=80%',
      'decision uses Data Gate, finalScore, R:R, and slot only',
      'regimeAdjustment: +3 / executionImpact=NONE',
    ],
    caution: [
      'large intraday loss should be reviewed as score evidence',
      'avoid discretionary leverage outside position policy',
    ],
    forbid: [
      'do not override PositionPolicy',
      'do not use unverified prices for execution',
    ],
    expectedDuration: '2~6 weeks',
  },
  R2_BULL: {
    allow: [
      'positionPolicy: maxPositions=6, maxGrossExposure=60%',
      'label is finalScore-based only',
      'regimeAdjustment: +2 / executionImpact=NONE',
    ],
    caution: [
      'R:R below threshold becomes WATCH_RR_INSUFFICIENT',
      'keep sector concentration visible as diagnostic evidence',
    ],
    forbid: [
      'do not use leverage outside position policy',
      'do not turn regime into an execution block',
    ],
    expectedDuration: '4~8 weeks',
  },
  R3_EARLY: {
    allow: [
      'positionPolicy: maxPositions=5, maxGrossExposure=50%',
      'early leaders can be evaluated when Data Gate is usable',
      'regimeAdjustment: +1 / executionImpact=NONE',
    ],
    caution: [
      'unconfirmed rotation remains score evidence',
      'partial data should be recorded as counterfactual context',
    ],
    forbid: [
      'do not expand beyond position policy',
      'do not suppress Shadow learning',
    ],
    expectedDuration: '2~4 weeks',
  },
  R4_NEUTRAL: {
    allow: [
      'positionPolicy: maxPositions=4, maxGrossExposure=40%',
      'BUY_ALLOWED remains possible when finalScore and R:R qualify',
      'regimeAdjustment: 0 / executionImpact=NONE',
    ],
    caution: [
      'weak trend should reduce score instead of creating a block',
      'watch candidates remain internal unless near threshold',
    ],
    forbid: [
      'do not create regime-specific entry bans',
      'do not publish long diagnostic breakdowns to user channel',
    ],
    expectedDuration: 'range-bound interval',
  },
  R5_CAUTION: {
    allow: [
      'positionPolicy: maxPositions=3, maxGrossExposure=20%',
      'BUY_ALLOWED remains score-driven',
      'regimeAdjustment: -2 / executionImpact=NONE',
    ],
    caution: [
      'thin liquidity should be reflected as score/confidence adjustment',
      'slot full becomes WATCH_SLOT_FULL with counterfactual recorded',
    ],
    forbid: [
      'do not convert caution regime into a buy ban',
      'do not suppress learning samples',
    ],
    expectedDuration: '1~3 weeks',
  },
  R6_DEFENSE: {
    allow: [
      'positionPolicy: maxPositions=3, maxGrossExposure=20%',
      'regime role: position policy + score adjustment only',
      'regimeAdjustment: -5 / executionImpact=NONE',
    ],
    caution: [
      'finalScore may fall to WATCH after adjustment',
      'show adjustment context without buy-ban wording',
    ],
    forbid: [
      'do not set maxPositions to 0',
      'do not change Shadow Always-On permissions',
    ],
    expectedDuration: 'until risk context normalizes',
  },
};

export function renderPlaybook(regime: RegimeLevel): string {
  const book = PLAYBOOKS[regime];
  if (!book) return '';

  const lines: string[] = [];
  lines.push(`\n<b>Regime Playbook: ${regime}</b>`);

  for (const item of book.allow) lines.push(`  OK ${item}`);
  for (const item of book.caution) lines.push(`  NOTE ${item}`);
  for (const item of book.forbid) lines.push(`  GUARD ${item}`);

  lines.push(`\n<i>expectedDuration: ${book.expectedDuration}</i>`);
  return lines.join('\n');
}
