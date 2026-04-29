#!/usr/bin/env node
// Enforces the platform-wide deploy contract:
//   - bare `deploy` (when present) MUST be the guard one-liner that exits non-zero
//   - `deploy:staging` (when present) MUST pin CLOUDFLARE_ACCOUNT_ID to the staging account
//     and unset CLOUDFLARE_API_TOKEN inline
//   - `deploy:production` (when present) MUST pin CLOUDFLARE_ACCOUNT_ID to the production account
//     and unset CLOUDFLARE_API_TOKEN inline
//
// Walks every package.json under the repo (skipping node_modules, dist, .wrangler, .next).
// Exits non-zero with a list of violations if the contract is broken.
//
// Run from any repo:  node scripts/lint-deploy-contract.mjs
// Standard CI hook:   .github/workflows/deploy-contract.yml runs this on push + PR.
//
// The contract is documented in TopoloDocs `deployments-and-observability.mdx` under
// "Manual Wrangler Fallback".

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STAGING_ACCT = '4f4e1c69a3830946f9fea7b1eb7531ac';
const PROD_ACCT = '49ef1ba682ad8cfd720c86699ae17521';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.wrangler', '.next', '.git', '.turbo', '.cache', '.vercel']);

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const violations = [];
const checked = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
    } else if (entry.name === 'package.json') {
      checkPkg(path.join(dir, entry.name));
    }
  }
}

function checkPkg(pkgPath) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return;
  }
  const scripts = pkg.scripts || {};
  if (!Object.keys(scripts).some((k) => k.startsWith('deploy'))) return;

  const rel = path.relative(root, pkgPath);
  checked.push(rel);

  const bare = scripts.deploy;
  const staging = scripts['deploy:staging'];
  const production = scripts['deploy:production'];

  // Rule 1: bare `deploy` must be a guard (forwarder to a sub-app's deploy is allowed
  // because the sub-app's deploy itself is a guard — but only if the forwarder doesn't
  // include "wrangler deploy" or "pages deploy" directly).
  if (bare !== undefined) {
    const isGuard = /process\.exit\(1\)/.test(bare) && /Bare\s*"?deploy/.test(bare);
    const isForwarder = !/(wrangler\s+(deploy|pages))/.test(bare);
    if (!isGuard && !isForwarder) {
      violations.push({
        file: rel,
        rule: 'bare-deploy-is-guard',
        detail: `\`deploy\` script directly invokes wrangler. It must be a guard that exits non-zero, or a forwarder that delegates to a sub-app's \`deploy\` (which is itself a guard).\nGot: ${bare}`,
      });
    }
  }

  // Rule 2: deploy:staging must pin staging account_id and unset prod token
  if (staging !== undefined) {
    const isForwarder = !/(wrangler\s+(deploy|pages))/.test(staging);
    if (!isForwarder) {
      if (!staging.includes(STAGING_ACCT)) {
        violations.push({
          file: rel,
          rule: 'staging-pins-account',
          detail: `\`deploy:staging\` must inline \`CLOUDFLARE_ACCOUNT_ID=${STAGING_ACCT}\` so a stale shell env var cannot redirect the deploy.\nGot: ${staging}`,
        });
      }
      if (!/env\s+-u\s+CLOUDFLARE_API_TOKEN/.test(staging)) {
        violations.push({
          file: rel,
          rule: 'staging-unsets-token',
          detail: `\`deploy:staging\` must \`env -u CLOUDFLARE_API_TOKEN\` so a token bound to a different account cannot authenticate.\nGot: ${staging}`,
        });
      }
    }
  }

  // Rule 3: deploy:production must pin prod account_id and unset prod token
  if (production !== undefined) {
    const isForwarder = !/(wrangler\s+(deploy|pages))/.test(production);
    if (!isForwarder) {
      if (!production.includes(PROD_ACCT)) {
        violations.push({
          file: rel,
          rule: 'production-pins-account',
          detail: `\`deploy:production\` must inline \`CLOUDFLARE_ACCOUNT_ID=${PROD_ACCT}\`.\nGot: ${production}`,
        });
      }
      if (!/env\s+-u\s+CLOUDFLARE_API_TOKEN/.test(production)) {
        violations.push({
          file: rel,
          rule: 'production-unsets-token',
          detail: `\`deploy:production\` must \`env -u CLOUDFLARE_API_TOKEN\`.\nGot: ${production}`,
        });
      }
    }
  }
}

walk(root);

if (violations.length === 0) {
  console.log(`✓ deploy contract: ${checked.length} package.json file(s) checked, no violations`);
  for (const f of checked) console.log(`  ${f}`);
  process.exit(0);
}

console.error(`\n✘ deploy contract violated in ${violations.length} place(s):\n`);
for (const v of violations) {
  console.error(`  [${v.rule}] ${v.file}`);
  console.error(`    ${v.detail.replace(/\n/g, '\n    ')}\n`);
}
console.error(`See https://docs.topolo.app/internal/operations/deployments-and-observability/`);
console.error(`for the full contract.`);
process.exit(1);
