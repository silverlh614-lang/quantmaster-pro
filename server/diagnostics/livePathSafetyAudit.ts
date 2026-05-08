/**
 * @responsibility ADR-461 Live Path Safety static audit.
 *
 * Read-only grep-style guard for ADR-450~459 diagnostic/learning rollout code. It must not import
 * KIS order clients or mutate live gate/Kelly/order paths; existing core execution modules are
 * allowlisted so this audit verifies that the post-rollout diagnostic lanes did not become a live
 * trading lane.
 */
import fs from 'fs';
import path from 'path';

export interface LivePathSafetyAuditResult {
  kisOrderImportDetected: boolean;
  normalizedGateScoreLiveDecisionDetected: boolean;
  createLiveOrderTrueDetected: boolean;
  executionImpactFullOrPartialDetected: boolean;
  gateThresholdMutationDetected: boolean;
  kellyMutationDetected: boolean;
  coreRolloutDetected: boolean;
  unexpectedAdr460ArtifactDetected: boolean;
  passed: boolean;
  findings: string[];
}

export interface LivePathSafetyAuditOptions {
  roots?: string[];
  cwd?: string;
}

type FlagKey = Exclude<keyof LivePathSafetyAuditResult, 'passed' | 'findings'>;

const DEFAULT_ROOTS = [
  'server/learning',
  'server/trading/signalScanner',
  'server/orchestrator',
  'server/persistence',
];

const OPERATIONAL_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_SEGMENTS = new Set(['node_modules', 'dist', 'build', 'coverage', '__fixtures__', '__snapshots__']);

const CORE_LIVE_PATH_ALLOWLIST = new Set([
  'server/orchestrator/tradingOrchestrator.ts',
  'server/orchestrator/overrideExecutor.ts',
]);

const PATTERNS: Array<{ key: FlagKey; label: string; regex: RegExp }> = [
  { key: 'kisOrderImportDetected', label: 'KIS order API usage', regex: /\b(?:placeKisMarketOrder|placeKisSellOrder|cancelKisOrder|placeKisStopLossOrder|placeKisTakeProfitOrder|kisPost\s*\()/ },
  { key: 'normalizedGateScoreLiveDecisionDetected', label: 'normalizedGateScore live decision coupling', regex: /normalizedGateScore[\s\S]{0,120}signalType|signalType[\s\S]{0,120}normalizedGateScore/ },
  { key: 'createLiveOrderTrueDetected', label: 'createLiveOrder=true', regex: /createLiveOrder\s*:\s*true/ },
  { key: 'executionImpactFullOrPartialDetected', label: 'executionImpact FULL/PARTIAL', regex: /executionImpact\s*:\s*['"](?:FULL|PARTIAL)['"]/ },
  { key: 'gateThresholdMutationDetected', label: 'gate threshold mutation', regex: /setRuntimeThresholdDelta\b|GATE_SCORE_THRESHOLD_BY_REGIME\s*=/ },
  { key: 'kellyMutationDetected', label: 'Kelly mutation', regex: /positionPct[\s\S]{0,120}overlay|Kelly mutation|kelly mutation/i },
  { key: 'coreRolloutDetected', label: 'CORE rollout mutation', regex: /modifiesCoreGate\s*:\s*true|rolloutStage\s*:\s*['"]CORE['"]/ },
  { key: 'unexpectedAdr460ArtifactDetected', label: 'unexpected ADR-460 artifact', regex: /gateReclassificationLiveOverlay|gateLiveOverlayRepo|GATE_LIVE_OVERLAY_DISABLED|manualLiveOverlayApproved|GateLiveOverlay/ },
];

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function isSkippedFile(file: string, rel: string): boolean {
  if (!OPERATIONAL_EXTENSIONS.has(path.extname(file))) return true;
  if (/\.test\.[tj]sx?$|\.spec\.[tj]sx?$|Adr\d+\.test\.[tj]sx?$/.test(file)) return true;
  if (/README|\.md$|prompt/i.test(file)) return true;
  if (rel.includes('/__tests__/')) return true;
  return rel.split('/').some((segment) => SKIP_SEGMENTS.has(segment));
}

function collectFiles(root: string, cwd: string, out: string[]): void {
  const abs = path.resolve(cwd, root);
  if (!fs.existsSync(abs)) return;
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    const rel = toPosix(path.relative(cwd, abs));
    if (!isSkippedFile(abs, rel)) out.push(abs);
    return;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const next = path.join(abs, entry.name);
    const rel = toPosix(path.relative(cwd, next));
    if (entry.isDirectory()) {
      if (!rel.split('/').some((segment) => SKIP_SEGMENTS.has(segment))) collectFiles(next, cwd, out);
    } else if (entry.isFile() && !isSkippedFile(next, rel)) {
      out.push(next);
    }
  }
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

function isAllowlistedFinding(rel: string, key: FlagKey): boolean {
  if (!CORE_LIVE_PATH_ALLOWLIST.has(rel)) return false;
  return key === 'kisOrderImportDetected' || key === 'gateThresholdMutationDetected';
}

export function runLivePathSafetyAudit(options: LivePathSafetyAuditOptions = {}): LivePathSafetyAuditResult {
  const cwd = options.cwd ?? process.cwd();
  const roots = options.roots ?? DEFAULT_ROOTS;
  const files: string[] = [];
  for (const root of roots) collectFiles(root, cwd, files);

  const result: LivePathSafetyAuditResult = {
    kisOrderImportDetected: false,
    normalizedGateScoreLiveDecisionDetected: false,
    createLiveOrderTrueDetected: false,
    executionImpactFullOrPartialDetected: false,
    gateThresholdMutationDetected: false,
    kellyMutationDetected: false,
    coreRolloutDetected: false,
    unexpectedAdr460ArtifactDetected: false,
    passed: true,
    findings: [],
  };

  for (const file of files) {
    const rel = toPosix(path.relative(cwd, file));
    const source = stripComments(fs.readFileSync(file, 'utf-8'));
    for (const pattern of PATTERNS) {
      if (!pattern.regex.test(source)) continue;
      if (isAllowlistedFinding(rel, pattern.key)) continue;
      result[pattern.key] = true;
      result.findings.push(`${pattern.label}: ${rel}`);
    }
  }

  result.passed = !(
    result.kisOrderImportDetected
    || result.normalizedGateScoreLiveDecisionDetected
    || result.createLiveOrderTrueDetected
    || result.executionImpactFullOrPartialDetected
    || result.gateThresholdMutationDetected
    || result.kellyMutationDetected
    || result.coreRolloutDetected
    || result.unexpectedAdr460ArtifactDetected
  );
  if (result.passed) result.findings.push('No ADR-461 forbidden live-path patterns detected in diagnostic/learning rollout paths.');
  return result;
}
