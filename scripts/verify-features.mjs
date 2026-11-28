import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NEXORA_FEATURE_REGISTRY } from '../shared/featureRegistry.ts';
import { evaluateFeatureRegistry } from '../server/v1/features_router.ts';

const ROOT = process.cwd();
const REPORTS_DIR = path.resolve(ROOT, 'reports');
const TESTS_DIR = path.resolve(ROOT, 'tests');

function runCommand(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    ok: res.status === 0,
    status: res.status ?? 1,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function parseTapCounts(output) {
  let total = 0;
  let failed = 0;
  for (const line of output.split(/\r?\n/)) {
    const tMatch = /^#\s*tests\s+(\d+)/.exec(line.trim());
    if (tMatch) total = Number(tMatch[1]);
    const fMatch = /^#\s*fail\s+(\d+)/.exec(line.trim());
    if (fMatch) failed = Number(fMatch[1]);
  }
  return { total, failed };
}

async function main() {
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  console.log('1/4 Checking TypeScript (npm run lint) and ESLint security rules (npx eslint .)...');
  const tscRes = runCommand('npm', ['run', 'lint']);
  const eslintRes = runCommand('npx', ['eslint', '.']);

  console.log('2/4 Verifying feature registry files & GUI mounts...');
  const appHtml = fs.readFileSync(path.resolve(ROOT, 'app.html'), 'utf-8');
  const serverTs = fs.readFileSync(path.resolve(ROOT, 'server.ts'), 'utf-8');
  const fileErrors = [];

  for (const entry of NEXORA_FEATURE_REGISTRY) {
    for (const rel of entry.files) {
      if (!fs.existsSync(path.resolve(ROOT, rel))) {
        fileErrors.push(`${entry.id}: missing file ${rel}`);
      }
    }
    if (entry.navSection && !['settings', 'admin', 'home', 'messages', 'explore'].includes(entry.navSection)) {
      if (!appHtml.includes(`data-nx-nav="${entry.navSection}"`)) {
        fileErrors.push(`${entry.id}: missing data-nx-nav="${entry.navSection}" in app.html`);
      }
    }
  }
  if (!appHtml.includes('id="nx-platform-react-root"')) {
    fileErrors.push('Missing #nx-platform-react-root in app.html');
  }
  for (const route of ['/features', '/admin/feature-health', '/marketplace', '/visual-search', '/studio', '/nearby']) {
    if (!serverTs.includes(`'${route}'`)) {
      fileErrors.push(`Missing deep-link route ${route} in server.ts`);
    }
  }

  console.log('3/4 Running Node test suite per file...');
  const testFiles = fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.mjs'))
    .sort();

  const resultsByTestFile = {};
  let totalTests = 0;
  let failedTests = 0;

  for (const file of testFiles) {
    const relPath = `tests/${file}`;
    const res = runCommand('node', ['--test', relPath]);
    const combined = `${res.stdout}\n${res.stderr}`;
    const counts = parseTapCounts(combined);
    const total = counts.total || (res.ok ? 1 : 1);
    const failed = res.ok ? 0 : Math.max(1, counts.failed);
    totalTests += total;
    failedTests += failed;
    resultsByTestFile[relPath] = {
      passed: res.ok && failed === 0,
      total,
      failed,
    };
    console.log(`   - ${relPath}: ${res.ok ? 'PASS' : 'FAIL'} (${total - failed}/${total})`);
    if (!res.ok) {
      console.error(combined.slice(-1200));
    }
  }

  const generatedAt = new Date().toISOString();
  const overallPassed = tscRes.ok && eslintRes.ok && fileErrors.length === 0 && failedTests === 0;

  // Write preliminary JSON first so evaluateFeatureRegistry() picks up fresh resultsByTestFile
  const jsonPath = path.resolve(REPORTS_DIR, 'feature-verification.json');
  const prelimPayload = {
    generatedAt,
    passed: overallPassed,
    lintPassed: tscRes.ok,
    eslintPassed: eslintRes.ok,
    fileErrors,
    totalTests,
    failedTests,
    resultsByTestFile,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(prelimPayload, null, 2));

  const evaluated = evaluateFeatureRegistry(true);
  const fullJsonPayload = {
    ...prelimPayload,
    adapterStatus: evaluated.adapterStatus,
    features: evaluated.features.map((f) => ({
      id: f.id,
      name: f.name,
      category: f.category,
      effectiveStatus: f.effectiveStatus,
      effectiveAvailability: f.effectiveAvailability,
      providerConfigured: f.providerConfigured,
      missingEnvVars: f.providerConfig.missingEnvVars,
      testResult: f.testResult || null,
    })),
  };
  fs.writeFileSync(jsonPath, JSON.stringify(fullJsonPayload, null, 2));

  console.log('4/4 Writing /reports/NEXORA_FEATURE_VERIFICATION.md...');
  const verifiedCount = evaluated.features.filter((f) => f.effectiveStatus === 'IMPLEMENTED_AND_VERIFIED').length;
  const blockedCount = evaluated.features.filter((f) => f.effectiveStatus === 'BLOCKED_EXTERNAL_DEPENDENCY').length;

  const mdLines = [
    '# NEXORA Feature Verification Report',
    '',
    `- **Generated At:** ${generatedAt}`,
    `- **Overall Verification:** ${overallPassed ? 'PASS' : 'FAIL'}`,
    `- **TypeScript Check (\`npm run lint\`):** ${tscRes.ok ? 'PASS' : 'FAIL'}`,
    `- **ESLint Security Rules (\`npx eslint .\`):** ${eslintRes.ok ? 'PASS' : 'FAIL'}`,
    `- **Test Suite:** ${totalTests - failedTests}/${totalTests} passing (${failedTests} failed)`,
    `- **Registry Summary:** ${evaluated.features.length} registered features (${verifiedCount} implemented & verified, ${blockedCount} blocked on external provider credentials)`,
    '',
    '## Feature Matrix',
    '',
    '| ID | Feature | Category | Availability | Implementation Status | Missing External Env | Tests |',
    '|---|---|---|---|---|---|---|',
    ...evaluated.features.map((f) => {
      const missing = f.providerConfig.missingEnvVars.length > 0 ? f.providerConfig.missingEnvVars.join(', ') : 'None';
      const testCell = f.testResult
        ? `${f.testResult.passed ? 'PASS' : 'FAIL'} (${f.testResult.detail})`
        : 'N/A';
      return `| ${f.id} | ${f.name} | ${f.category} | ${f.effectiveAvailability} | ${f.effectiveStatus} | ${missing} | ${testCell} |`;
    }),
    '',
  ];

  if (fileErrors.length > 0) {
    mdLines.push('## File & GUI Wiring Errors', '', ...fileErrors.map((e) => `- ${e}`), '');
  }
  if (!tscRes.ok) {
    mdLines.push('## TypeScript Output', '', '```', tscRes.stdout.slice(-2000), tscRes.stderr.slice(-2000), '```', '');
  }
  if (!eslintRes.ok) {
    mdLines.push('## ESLint Output', '', '```', eslintRes.stdout.slice(-2000), eslintRes.stderr.slice(-2000), '```', '');
  }

  fs.writeFileSync(path.resolve(REPORTS_DIR, 'NEXORA_FEATURE_VERIFICATION.md'), mdLines.join('\n'));
  console.log(`Verification report written to reports/feature-verification.json and reports/NEXORA_FEATURE_VERIFICATION.md.`);

  if (!overallPassed) {
    process.exitCode = 1;
  }
}

void main();
