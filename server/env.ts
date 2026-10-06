import fs from 'node:fs';
import path from 'node:path';
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
 for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
 }
}
