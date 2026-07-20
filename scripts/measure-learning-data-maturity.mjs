// @responsibility 누적 학습 ledger 성숙도(row 수·forward-return resolved 비율) 실측 진단 스크립트 — read-only.
/**
 * scripts/measure-learning-data-maturity.mjs — "데이터가 충분히 누적됐는가?" 정량 진단 도구.
 *
 * 배경: 실제 누적 데이터는 리포가 아니라 운영 볼륨(PERSIST_DATA_DIR / Railway Volume)에만 있다.
 *   따라서 "충분히 누적됨" 은 운영 환경에서만 정량 확인 가능하다. 이 스크립트는 각 고가치 학습
 *   ledger 의 (1) row 수 (2) forward-return "resolved(성숙)" 비율 을 집계해, 임계 자동튜닝·walk-forward
 *   활성화의 선행 판정(ROC_MIN_SAMPLE=30 등) 근거를 준다.
 *
 * 안전성: 매매/학습 로직을 일절 건드리지 않는 read-only. data/ 의 영속 JSON 만 읽는다.
 *   KIS/KRX/DART/provider 호출 0. 파일 쓰기 0. executionImpact NONE.
 *
 * 실행 (운영 서버 = data/ 가 있는 곳에서):
 *   node scripts/measure-learning-data-maturity.mjs
 *   PERSIST_DATA_DIR=/app/data node scripts/measure-learning-data-maturity.mjs
 *   node scripts/measure-learning-data-maturity.mjs --data /path/to/data
 *   node scripts/measure-learning-data-maturity.mjs --json      # 기계가독 출력
 *
 * 판정 기준(휴리스틱, 문서화):
 *   - resolved: row 의 maturity/outcomeStatus/status/state 가 RESOLVED|MATURED|FINAL|CLOSED|LABELED,
 *     또는 forward-return 필드(d1/d3/d5/d10/d20 return·forwardReturn·returnPct 등)가 non-null 로 채워짐.
 *   - pending : PENDING|PARTIAL|OPEN|IMMATURE|AWAIT, 또는 forward-return 미충전.
 *   - unknown : 위 어느 쪽도 판정 불가(스키마 미상). 정직하게 별도 카운트.
 */

import fs from 'fs';
import path from 'path';

// ─── 데이터 디렉토리 해석 (paths.ts 와 동일 규칙) ────────────────────────────
function resolveDataDir() {
  const argIdx = process.argv.indexOf('--data');
  if (argIdx >= 0 && process.argv[argIdx + 1]) return path.resolve(process.argv[argIdx + 1]);
  if (process.env.PERSIST_DATA_DIR) return path.resolve(process.env.PERSIST_DATA_DIR);
  return path.resolve(process.cwd(), 'data');
}
const DATA_DIR = resolveDataDir();
const JSON_OUT = process.argv.includes('--json');

// ROC/Youden's J 임계 튜닝 최소 표본 (server/learning/gateThresholdAutoTuning.ts 와 정합).
const ROC_MIN_SAMPLE = 30;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

// ─── 성숙도 판정 휴리스틱 ─────────────────────────────────────────────────────
const RESOLVED_RE = /^(RESOLVED|MATURED|FINAL|FINALIZED|CLOSED|LABELED|COMPLETE|COMPLETED|DONE)$/i;
const PENDING_RE  = /^(PENDING|PARTIAL|OPEN|IMMATURE|AWAIT|AWAITING|IN_PROGRESS|OBSERVING)$/i;
const STATUS_KEYS = ['maturity', 'outcomeStatus', 'status', 'state', 'outcomeLabel', 'resolutionState'];
// forward-return 필드(값이 non-null 이면 성숙으로 간주). 다양한 명명 관용 흡수.
const FWD_RETURN_RE = /(^|_)(d|day)?(1|3|5|10|20)[dD]?_?(return|ret|pnl|forward|outcome)|forwardreturn|returnpct|realizedreturn|finalreturn/i;

function classifyRow(row) {
  if (row === null || typeof row !== 'object') return 'unknown';

  // 1) 명시적 상태 필드 우선.
  for (const key of STATUS_KEYS) {
    const v = row[key];
    if (typeof v === 'string') {
      if (RESOLVED_RE.test(v)) return 'resolved';
      if (PENDING_RE.test(v)) return 'pending';
    }
    if (v === true && (key === 'resolved' || key === 'matured')) return 'resolved';
  }
  if (row.resolved === true || row.matured === true) return 'resolved';
  if (row.resolved === false || row.matured === false) return 'pending';

  // 2) forward-return 필드 충전 여부.
  let sawFwdField = false;
  let fwdFilled = false;
  for (const [k, v] of Object.entries(row)) {
    if (FWD_RETURN_RE.test(k)) {
      sawFwdField = true;
      if (v !== null && v !== undefined && !(typeof v === 'number' && Number.isNaN(v))) fwdFilled = true;
    }
  }
  if (sawFwdField) return fwdFilled ? 'resolved' : 'pending';

  return 'unknown';
}

function tallyArray(rows) {
  const t = { rows: rows.length, resolved: 0, pending: 0, unknown: 0 };
  for (const r of rows) {
    const c = classifyRow(r);
    t[c] += 1;
  }
  return t;
}

// ledger 파일 1개 측정. array/object/부재 모두 정직하게 표기.
function measureFile(absPath, label) {
  if (!fs.existsSync(absPath)) {
    return { label, present: false };
  }
  let stat;
  try { stat = fs.statSync(absPath); } catch { return { label, present: false }; }
  const raw = readJson(absPath, null);
  const base = {
    label,
    present: true,
    sizeKB: +(stat.size / 1024).toFixed(1),
    mtime: new Date(stat.mtimeMs + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' KST',
  };
  if (Array.isArray(raw)) {
    return { ...base, shape: 'array', ...tallyArray(raw) };
  }
  // 배열을 품은 객체(예: { items: [...] } / { records: [...] }) 흡수.
  if (raw && typeof raw === 'object') {
    const arrKey = Object.keys(raw).find((k) => Array.isArray(raw[k]));
    if (arrKey) {
      return { ...base, shape: `object.${arrKey}[]`, ...tallyArray(raw[arrKey]) };
    }
    return { ...base, shape: 'object', keys: Object.keys(raw).length };
  }
  return { ...base, shape: 'unreadable' };
}

// 서브디렉토리 내 *.json 을 하나의 논리 ledger 로 합산(월별/일별 롤링).
function measureDir(absDir, label) {
  if (!fs.existsSync(absDir)) return { label, present: false };
  let files;
  try { files = fs.readdirSync(absDir).filter((f) => f.endsWith('.json')); }
  catch { return { label, present: false }; }
  if (files.length === 0) return { label, present: true, shape: 'dir', files: 0, rows: 0, resolved: 0, pending: 0, unknown: 0 };
  const agg = { rows: 0, resolved: 0, pending: 0, unknown: 0 };
  let sizeKB = 0;
  let latestMtime = 0;
  for (const f of files) {
    const p = path.join(absDir, f);
    try { const s = fs.statSync(p); sizeKB += s.size / 1024; latestMtime = Math.max(latestMtime, s.mtimeMs); } catch { /* skip */ }
    const raw = readJson(p, null);
    const rows = Array.isArray(raw) ? raw : (raw && typeof raw === 'object' ? (Object.values(raw).find(Array.isArray) ?? []) : []);
    const t = tallyArray(rows);
    agg.rows += t.rows; agg.resolved += t.resolved; agg.pending += t.pending; agg.unknown += t.unknown;
  }
  return {
    label, present: true, shape: 'dir', files: files.length,
    sizeKB: +sizeKB.toFixed(1),
    mtime: latestMtime ? new Date(latestMtime + 9 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' KST' : '—',
    ...agg,
  };
}

// ─── 고가치 학습 ledger 인벤토리 (server/persistence/paths.ts SSOT 기준) ──────
const FILE_LEDGERS = [
  ['condition-weights.json',                              'F2W LIVE 조건가중치 (진화중·유실=학습초기화)'],
  ['condition-weight-history.json',                       'F2W 가중치 변경 이력'],
  ['gate-learned-thresholds.json',                        'Gate1 학습 임계 store (operator apply 대상)'],
  ['attribution-records.json',                            'attribution 조건별 귀속 (F2W 입력·최근 500)'],
  ['shadow-trades.json',                                  'Shadow paper-fill 본체'],
  ['shadow-learning-only-signals.json',                   '매매금지일 학습샘플 (FIFO 5000·1/3/5/20d)'],
  ['counterfactual-shadow.json',                          'Gate1 탈락후보 가상진입'],
  ['counterfactual-shadow-learning-ledger.json',          'SELL_ONLY/HARD_BLOCK 학습record (365d)'],
  ['counterfactual-universe-learning-ledger.json',        'preflight 차단 universe 스냅샷'],
  ['ghost-portfolio.json',                                'Ghost 미매수 종목 30d 추적'],
  ['twin-portfolio.json',                                 'Twin 포트폴리오'],
  ['parallel-universe-ledger.json',                       'Parallel-universe ledger'],
  ['rejection-shadow.json',                               'Rejection shadow'],
  ['provisional-shadow-ledger.json',                      'Provisional shadow (FIFO 2000)'],
  ['near-miss-outcomes.json',                             'Near-miss outcome 라벨'],
  ['gate3-outcomes.json',                                 'Gate3 forward-return outcome'],
  ['gate2-outcome-ledger.json',                           'Gate2 outcome ledger'],
  ['shakeout-stop-outcome-ledger-adr0625.json',           '셰이크아웃 손절-후 outcome (FIFO 12000)'],
  ['missed-learning-queue.json',                          'Missed-learning 큐'],
  ['walk-forward-results.json',                           'Walk-forward IS/OOS 결과'],
  ['walk-forward-shadow-results.json',                    'Walk-forward shadow 결과'],
  ['reflection-impact.json',                              'nightlyReflection 효과 추적'],
];
const DIR_LEDGERS = [
  [path.join('attribution', 'evidence-ledger'),           'attribution 증거 월별 ledger (F2W 입력)'],
  ['reflections',                                          'nightlyReflection 일별 회고 이력'],
];

// ─── 집계 실행 ────────────────────────────────────────────────────────────────
const results = [];
for (const [file, label] of FILE_LEDGERS) results.push(measureFile(path.join(DATA_DIR, file), label));
for (const [dir, label] of DIR_LEDGERS) results.push(measureDir(path.join(DATA_DIR, dir), label));

if (JSON_OUT) {
  process.stdout.write(JSON.stringify({ dataDir: DATA_DIR, rocMinSample: ROC_MIN_SAMPLE, results }, null, 2) + '\n');
  process.exit(0);
}

// ─── 사람가독 출력 ────────────────────────────────────────────────────────────
function pct(n, d) { return d > 0 ? ((100 * n) / d).toFixed(0) + '%' : '—'; }
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); }

console.log('');
console.log('═══ 누적 학습 ledger 성숙도 측정 ══════════════════════════════════════');
console.log(`DATA_DIR: ${DATA_DIR}`);
if (!fs.existsSync(DATA_DIR)) {
  console.log('⚠️  DATA_DIR 이 존재하지 않습니다. 운영 볼륨에서 실행하거나 --data / PERSIST_DATA_DIR 로 지정하세요.');
  process.exit(0);
}
console.log('─────────────────────────────────────────────────────────────────────');
console.log(`${pad('ledger', 40)} ${pad('rows', 7)} ${pad('resolved', 9)} ${pad('pending', 8)} ${pad('unk', 5)} size`);
console.log('─────────────────────────────────────────────────────────────────────');

let tunableReady = 0;
const missing = [];
for (const r of results) {
  if (!r.present) { missing.push(r.label); continue; }
  if (r.shape === 'object') {
    console.log(`${pad(r.label, 40)} ${pad('obj', 7)} ${pad(`${r.keys}k`, 9)} ${pad('—', 8)} ${pad('—', 5)} ${r.sizeKB}KB`);
    continue;
  }
  if (r.shape === 'dir') {
    console.log(`${pad(r.label, 40)} ${pad(r.rows, 7)} ${pad(`${r.resolved} (${pct(r.resolved, r.resolved + r.pending)})`, 9)} ${pad(r.pending, 8)} ${pad(r.unknown, 5)} ${r.sizeKB}KB/${r.files}f`);
    if (r.resolved >= ROC_MIN_SAMPLE) tunableReady += 1;
    continue;
  }
  const resolvedCell = `${r.resolved} (${pct(r.resolved, r.resolved + r.pending)})`;
  console.log(`${pad(r.label, 40)} ${pad(r.rows, 7)} ${pad(resolvedCell, 9)} ${pad(r.pending, 8)} ${pad(r.unknown, 5)} ${r.sizeKB}KB`);
  if (r.resolved >= ROC_MIN_SAMPLE) tunableReady += 1;
}

console.log('─────────────────────────────────────────────────────────────────────');
if (missing.length) console.log(`미존재(볼륨에 아직 없음): ${missing.length}종 — ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' …' : ''}`);
console.log(`resolved ≥ ROC_MIN_SAMPLE(${ROC_MIN_SAMPLE}) ledger: ${tunableReady}종 (임계 자동튜닝 표본 충족 후보)`);
console.log('');
console.log('※ resolved% 는 forward-return 성숙 표본 비율. pending 이 높으면 forward-outcome');
console.log('  라벨러(future_return_resolve 등) 활성/적체 여부부터 점검할 것 (라벨 성숙이 튜닝 선행조건).');
console.log('═══════════════════════════════════════════════════════════════════════');
