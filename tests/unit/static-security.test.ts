import fs from 'fs';
import path from 'path';

// Static guard: the mobile app source must never reference privileged credentials.
const root = path.join(__dirname, '../..');
const clientFiles: string[] = [];
function walk(dir: string) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|json)$/.test(entry.name)) clientFiles.push(p);
  }
}
walk(path.join(root, 'src'));
clientFiles.push(path.join(root, 'App.tsx'), path.join(root, 'index.ts'), path.join(root, 'app.config.ts'));

const FORBIDDEN = [
  /service[_-]?role/i,
  /SUPABASE_SERVICE/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, // JWT-shaped literal
  /sb_secret_/i,
  /EXPO_ACCESS_TOKEN/,
  /CRON_SECRET/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{35}/, // hard-coded Google API key
];

test.each(clientFiles.map((f) => [path.relative(root, f)]))('%s contains no privileged secret', (rel) => {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  for (const re of FORBIDDEN) expect(text).not.toMatch(re);
});

test('.env files with real values are git-ignored', () => {
  const gi = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  expect(gi).toMatch(/^\.env$/m);
  expect(gi).toMatch(/^\.env\.\*$/m);
});

test('.env.example contains placeholders only', () => {
  const lines = fs.readFileSync(path.join(root, '.env.example'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l));
  for (const l of lines) expect(l).toMatch(/^[A-Z_]+=(|false)$/);
});
