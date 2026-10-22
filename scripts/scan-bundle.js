#!/usr/bin/env node
// Scans an exported JS bundle (npx expo export) for privileged credentials.
// Usage: npx expo export --platform android --output-dir dist && node scripts/scan-bundle.js dist
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || 'dist';
const extraSecrets = (process.env.SCAN_FORBIDDEN_VALUES || '').split(',').map((s) => s.trim()).filter(Boolean);
const patterns = [
  [/service_role/i, 'service_role reference'],
  [/SUPABASE_SERVICE_ROLE_KEY/, 'service-role env name'],
  [/sb_secret_[A-Za-z0-9_-]+/, 'Supabase secret key'],
  [/EXPO_ACCESS_TOKEN/, 'Expo access token name'],
  [/CRON_SECRET/, 'cron secret name'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
];

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|hbc|json|map)$/.test(e.name)) files.push(p);
  }
})(dir);

let problems = 0;
for (const f of files) {
  const text = fs.readFileSync(f, 'latin1');
  for (const [re, label] of patterns) {
    if (re.test(text)) {
      console.error(`FOUND ${label} in ${f}`);
      problems++;
    }
  }
  for (const secret of extraSecrets) {
    if (text.includes(secret)) {
      console.error(`FOUND a forbidden value in ${f}`);
      problems++;
    }
  }
}
console.log(`Scanned ${files.length} file(s) in ${dir}: ${problems ? `${problems} problem(s)` : 'no privileged credentials found'}`);
process.exit(problems ? 1 : 0);
