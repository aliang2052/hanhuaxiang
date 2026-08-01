import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const obsolete = fs.readFileSync(path.join(ROOT, 'BASELINE_DELETIONS.txt'), 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
const checkOnly = process.argv.includes('--check');
const present = obsolete.filter((relative) => fs.existsSync(path.join(ROOT, relative)));
if (checkOnly) {
  if (present.length) {
    console.error(`Legacy baseline files still present (${present.length}):`);
    for (const relative of present) console.error(`- ${relative}`);
    process.exit(1);
  }
  console.log(`Legacy cleanup check passed: ${obsolete.length} obsolete paths are absent.`);
  process.exit(0);
}
for (const relative of present) fs.rmSync(path.join(ROOT, relative), { recursive: true, force: true });
console.log(`Removed ${present.length} obsolete ac76d30 path(s); ${obsolete.length - present.length} were already absent.`);
