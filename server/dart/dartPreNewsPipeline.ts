// @responsibility DART 선행공시 파이프라인 조립
import { buildDartAiInterpretation, aiInterpretationConfidenceFact } from './dartAiInterpretationAdapter.js';
import { scoreDartCatalyst } from './dartCatalystScorer.js';
import { summarizeDataConfidence } from './dartDataConfidence.js';
import { parseDartDisclosureFacts } from './dartDisclosureParser.js';
import { classifyDartDisclosure } from './dartDisclosureClassifier.js';
import { fetchDartDisclosures } from './dartDisclosureFetcher.js';
import { normalizeDartPreNewsConfig, type DartPreNewsConfig } from './dartPreNewsConfig.js';
import { upsertDartPreNewsCandidates } from './dartPreNewsStore.js';
import { splitProviderIssueFromMarketSignal } from './dartProviderSignalSplit.js';
import type { DartDisclosureRecord, DartExtractedFact, DartFetchResult, DartPreNewsCandidate, DartPreNewsStage, DartShadowTelemetry } from './dartPreNewsTypes.js';

export interface DartPreNewsPipelineResult {
  candidates: DartPreNewsCandidate[];
  storedCount: number;
  providerIssue: boolean;
  executionImpact: 'NONE';
  shadowTelemetry: DartShadowTelemetry[];
}

export interface DartPreNewsPipelineOptions {
  config?: Partial<DartPreNewsConfig>;
  disclosures?: DartDisclosureRecord[];
  fetchResult?: DartFetchResult;
  persist?: boolean;
  now?: Date;
}

function chooseStage(input: {
  allowedStages: DartPreNewsStage[];
  classified: boolean;
  advisoryReady: boolean;
}): DartPreNewsStage {
  if (input.advisoryReady && input.allowedStages.includes('ADVISORY')) return 'ADVISORY';
  if (input.classified && input.allowedStages.includes('SHADOW_SCORE')) return 'SHADOW_SCORE';
  return 'OBSERVE';
}

function telemetryTags(candidate: DartPreNewsCandidate): string[] {
  const tags = ['CASE_DART_PRE_NEWS_OBSERVED'];
  if (candidate.reasons.includes('PASS_DART_LARGE_CONTRACT')) tags.push('CASE_DART_CONTRACT_DISCLOSURE_DETECTED');
  if (candidate.reasons.includes('PASS_DART_CAPEX_INVESTMENT')) tags.push('CASE_DART_CAPEX_DISCLOSURE_DETECTED');
  if (candidate.risks.includes('RISK_DART_CB_BW_ISSUANCE') || candidate.risks.includes('RISK_DART_CAPITAL_INCREASE')) tags.push('CASE_DART_DILUTION_RISK_DETECTED');
  if (candidate.risks.includes('RISK_DART_GOVERNANCE_CHANGE') || candidate.risks.includes('RISK_DART_MAJOR_SHAREHOLDER_SELL')) tags.push('CASE_DART_GOVERNANCE_RISK_DETECTED');
  if (candidate.aiInterpretation) tags.push('CASE_DART_AI_ANALYSIS_ADVISORY_ONLY');
  if (candidate.providerIssue) tags.push('CASE_DART_PROVIDER_ISSUE');
  if (candidate.reasons.includes('PROVIDER_DART_PARSER_FAILED')) tags.push('CASE_DART_PARSER_FAILURE');
  return Array.from(new Set(tags));
}

function buildProviderIssueCandidate(fetchResult: DartFetchResult, nowIso: string): DartPreNewsCandidate {
  const facts: DartExtractedFact[] = [];
  return {
    id: `dart-provider-issue-${nowIso}`,
    corpName: 'UNKNOWN',
    market: 'UNKNOWN',
    disclosureId: `PROVIDER_ISSUE_${nowIso}`,
    disclosureTitle: 'DART provider issue',
    disclosureType: 'PROVIDER_ISSUE',
    receivedAt: nowIso,
    stage: 'OBSERVE',
    catalystCategory: 'UNKNOWN',
    catalystScore: 0,
    riskScore: 0,
    extractedFacts: facts,
    dataConfidence: summarizeDataConfidence(facts),
    providerIssue: true,
    marketSignal: false,
    executionImpact: 'NONE',
    reasons: fetchResult.reasons,
    risks: [],
    missingData: fetchResult.missingData,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export async function runDartPreNewsPipeline(options: DartPreNewsPipelineOptions = {}): Promise<DartPreNewsPipelineResult> {
  const config = normalizeDartPreNewsConfig(options.config);
  const nowIso = (options.now ?? new Date()).toISOString();
  console.log(`[DART_PRE_NEWS_START] lookbackDays=${config.lookbackDays} executionImpact=NONE`);

  const fetchResult = options.fetchResult ?? (options.disclosures
    ? { disclosures: options.disclosures, providerIssue: false, dataHealth: 'VERIFIED', reasons: [], missingData: [], executionImpact: 'NONE' } satisfies DartFetchResult
    : await fetchDartDisclosures(config));
  console.log(`[DART_DISCLOSURES_FETCHED] total=${fetchResult.disclosures.length} providerIssue=${fetchResult.providerIssue}`);

  if (fetchResult.disclosures.length === 0 && fetchResult.providerIssue) {
    const providerCandidate = buildProviderIssueCandidate(fetchResult, nowIso);
    console.log('[DART_DISCLOSURES_CLASSIFIED] positive=0 risk=0 neutral=0 unknown=1');
    console.log('[DART_BODY_PARSE_RESULT] parsed=0 failed=0');
    console.log('[DART_CATALYST_SCORE_RESULT] advisory=0 riskAlerts=0');
    console.log('[DART_AI_INTERPRETATION_SKIPPED] reason=no_candidates');
    console.log('[DART_PRE_NEWS_STORE_UPDATED] count=0');
    console.log('[DART_PRE_NEWS_DONE] executionImpact=NONE');
    return { candidates: [providerCandidate], storedCount: 0, providerIssue: true, executionImpact: 'NONE', shadowTelemetry: [] };
  }

  const unique = Array.from(new Map(fetchResult.disclosures.map((d) => [d.disclosureId, d])).values());
  let positive = 0;
  let risk = 0;
  let neutral = 0;
  let unknown = 0;
  let parsed = 0;
  let failed = 0;
  const candidates: DartPreNewsCandidate[] = [];

  for (const disclosure of unique) {
    const classification = classifyDartDisclosure(disclosure);
    if (classification.category === 'UNKNOWN') unknown += 1;
    else if (classification.category === 'NEUTRAL_INFO') neutral += 1;
    else if (classification.category.endsWith('RISK') || classification.category === 'RISK_NEGATIVE') risk += 1;
    else positive += 1;

    if (!config.includeRiskDisclosures && (classification.category.endsWith('RISK') || classification.category === 'RISK_NEGATIVE')) continue;
    if (!config.includePositiveDisclosures && classification.reasons.length > 0) continue;

    const parseResult = parseDartDisclosureFacts(disclosure);
    if (parseResult.providerIssue) failed += 1;
    else parsed += 1;

    const score = scoreDartCatalyst({
      category: classification.category,
      facts: parseResult.facts,
      reasons: [...classification.reasons, ...parseResult.reasons],
      risks: classification.risks,
      parserFailed: parseResult.providerIssue,
    });
    const split = splitProviderIssueFromMarketSignal({
      category: classification.category,
      reasons: [...score.reasons, ...fetchResult.reasons],
      risks: score.risks,
      fetchProviderIssue: fetchResult.providerIssue || parseResult.providerIssue,
    });

    const advisoryReady = classification.marketSignal
      && (score.catalystScore >= config.minCatalystScoreForAdvisory || score.riskScore >= config.minRiskScoreForRiskAlert);
    const stage = chooseStage({ allowedStages: config.allowedStages, classified: classification.category !== 'UNKNOWN', advisoryReady });
    const facts = [...parseResult.facts];
    const shouldInterpret = config.enableAiInterpretation && stage === 'ADVISORY' && candidates.length < config.maxCandidatesForAiInterpretation;
    const aiInterpretation = shouldInterpret
      ? buildDartAiInterpretation({
        disclosureTitle: disclosure.disclosureTitle,
        disclosureType: classification.disclosureType,
        extractedFacts: facts,
        catalystCategory: classification.category,
        catalystScore: score.catalystScore,
        riskScore: score.riskScore,
        missingData: [...fetchResult.missingData, ...parseResult.missingData],
      })
      : undefined;
    if (aiInterpretation) facts.push(aiInterpretationConfidenceFact());

    candidates.push({
      id: `${disclosure.disclosureId}:${stage}`,
      corpCode: disclosure.corpCode,
      stockCode: disclosure.stockCode,
      corpName: disclosure.corpName,
      market: disclosure.market ?? 'UNKNOWN',
      disclosureId: disclosure.disclosureId,
      disclosureTitle: disclosure.disclosureTitle,
      disclosureType: classification.disclosureType,
      receivedAt: disclosure.receivedAt,
      reportUrl: disclosure.reportUrl,
      stage,
      catalystCategory: classification.category,
      catalystScore: score.catalystScore,
      riskScore: score.riskScore,
      extractedFacts: facts,
      aiInterpretation,
      dataConfidence: summarizeDataConfidence(facts),
      providerIssue: split.providerIssue,
      marketSignal: split.marketSignal,
      executionImpact: 'NONE',
      reasons: Array.from(new Set([...score.reasons, ...fetchResult.reasons])),
      risks: score.risks,
      missingData: Array.from(new Set([...fetchResult.missingData, ...parseResult.missingData])),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  const advisory = candidates.filter((c) => c.stage === 'ADVISORY' && c.catalystScore >= config.minCatalystScoreForAdvisory).length;
  const riskAlerts = candidates.filter((c) => c.riskScore >= config.minRiskScoreForRiskAlert).length;
  console.log(`[DART_DISCLOSURES_CLASSIFIED] positive=${positive} risk=${risk} neutral=${neutral} unknown=${unknown}`);
  console.log(`[DART_BODY_PARSE_RESULT] parsed=${parsed} failed=${failed}`);
  console.log(`[DART_CATALYST_SCORE_RESULT] advisory=${advisory} riskAlerts=${riskAlerts}`);
  if (config.enableAiInterpretation) console.log(`[DART_AI_INTERPRETATION_COMPLETED] count=${candidates.filter((c) => c.aiInterpretation).length}`);
  else console.log('[DART_AI_INTERPRETATION_SKIPPED] reason=disabled');

  const stored = options.persist === false ? candidates : upsertDartPreNewsCandidates(candidates);
  console.log(`[DART_PRE_NEWS_STORE_UPDATED] count=${options.persist === false ? 0 : stored.length}`);
  console.log('[DART_PRE_NEWS_DONE] executionImpact=NONE');

  const shadowTelemetry = candidates.map((candidate) => ({
    disclosureId: candidate.disclosureId,
    stockCode: candidate.stockCode,
    corpCode: candidate.corpCode,
    learningTags: telemetryTags(candidate),
    executionImpact: 'NONE' as const,
    liveExecutionAllowed: false as const,
    shadowLearning: true as const,
    stage: candidate.stage,
    createdAt: nowIso,
  }));

  return { candidates, storedCount: options.persist === false ? 0 : stored.length, providerIssue: fetchResult.providerIssue, executionImpact: 'NONE', shadowTelemetry };
}
