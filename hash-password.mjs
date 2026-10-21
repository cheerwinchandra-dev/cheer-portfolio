#!/usr/bin/env node
// Creates the value for your Netlify environment variable ADMIN_PASSWORD_HASH.
//
//   npm run hash-password            -> prints ADMIN_PASSWORD_HASH
//   npm run hash-password -- --local -> also saves it to .env.local for "npm run dev"
//
// Only a PBKDF2 hash is printed. The password itself never leaves this computer.
// (No Node.js? Open https://<your-site>/admin/setup in a browser instead.)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashPassword } from '../lib/crypto.js';
import { askHidden } from './prompt.mjs';

const password = await askHidden('New admin password: ');
const again = await askHidden('Type it again: ');
if (password !== again) {
  console.error('\nThe two passwords do not match. Nothing was created.');
  process.exit(1);
}
if (password.length < 8) {
  console.error('\nUse at least 8 characters (10+ with letters and numbers is better).');
  process.exit(1);
}
if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
  console.warn('Tip: this password is short. You can change it to a stronger one later in Dashboard -> Security.');
}
const hash = await hashPassword(password);

console.log('\nAdd this in Netlify -> Project configuration -> Environment variables, then redeploy:\n');
console.log(`  ADMIN_PASSWORD_HASH = ${hash}\n`);

if (process.argv.includes('--local')) {
  const file = '.env.local';
  const keep = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !/^ADMIN_PASSWORD_HASH=/.test(l)) : [];
  writeFileSync(file, [...keep, `ADMIN_PASSWORD_HASH='${hash}'`].join('\n') + '\n', { mode: 0o600 });
  console.log('Also saved to .env.local for local testing (this file is git-ignored).');
}
