#!/usr/bin/env node
// Fails if files tracked (or staged) by git look like they contain secrets.
// Usage: npm run lint:secrets   (also suitable as a pre-commit hook / CI step)
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.includes('node_modules') && !/\.(png|jpg|svg|ico|lock)$/.test(f) && f !== 'package-lock.json');

const patterns = [
  { name: 'Private key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'JWT / HA long-lived token', re: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  { name: 'AWS key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Populated secret in env file', re: /^(CREDENTIAL_ENCRYPTION_KEY|STREAM_TOKEN_SECRET)=\S{16,}/m },
];

const problems = [];
for (const f of files) {
  if (/(^|\/)\.env$/.test(f)) problems.push(`${f}: .env files must never be committed`);
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  for (const p of patterns) if (p.re.test(text)) problems.push(`${f}: possible ${p.name}`);
}

if (problems.length) {
  console.error('Possible secrets found:\n' + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`No secrets found in ${files.length} files.`);
