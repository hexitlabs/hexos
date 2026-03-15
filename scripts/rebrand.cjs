#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const TEXT_EXTS = new Set(['.js', '.json', '.md', '.sh', '.yml', '.yaml', '.txt', '.html', '.css', '.ts', '.mjs', '.cjs', '.map', '.env', '.toml', '.cfg', '.conf', '.service']);

// Order matters: most specific first
const REPLACEMENTS = [
  ['hexos-gateway', 'hexos-gateway'],
  ['hexos.json', 'hexos.json'],
  ['.hexos', '.hexos'],
  ['HEXOS_', 'HEXOS_'],
  ['HexOS', 'HexOS'],
  ['hexos', 'hexos'],
];

let totalFiles = 0;
let modifiedFiles = 0;
let totalReplacements = 0;

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTS.has(ext)) return true;
  // Also handle extensionless files like LICENSE, Makefile, Dockerfile
  const base = path.basename(filePath);
  if (['LICENSE', 'Makefile', 'Dockerfile', 'Procfile', '.gitignore', '.dockerignore', '.npmignore', '.editorconfig'].includes(base)) return true;
  return false;
}

function processFile(filePath) {
  totalFiles++;
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return; // skip binary/unreadable
  }

  let modified = content;
  let fileReplacements = 0;

  for (const [find, replace] of REPLACEMENTS) {
    const regex = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches = modified.match(regex);
    if (matches) {
      fileReplacements += matches.length;
      modified = modified.replace(regex, replace);
    }
  }

  if (fileReplacements > 0) {
    fs.writeFileSync(filePath, modified, 'utf8');
    modifiedFiles++;
    totalReplacements += fileReplacements;
    console.log(`  ✓ ${path.relative(ROOT, filePath)} (${fileReplacements} replacements)`);
  }
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath);
    } else if (entry.isFile() && isTextFile(fullPath)) {
      processFile(fullPath);
    }
  }
}

console.log('🔷 HexOS Rebrand Script');
console.log('='.repeat(50));
console.log('Processing:', ROOT);
console.log('');

walkDir(ROOT);

console.log('');
console.log('='.repeat(50));
console.log(`Files scanned: ${totalFiles}`);
console.log(`Files modified: ${modifiedFiles}`);
console.log(`Total replacements: ${totalReplacements}`);
console.log('');

// Verify
const { execSync } = require('child_process');
const remaining = execSync(`grep -r "hexos" "${ROOT}/dist/" --include="*.js" 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim();
const remainingEnv = execSync(`grep -r "HEXOS_" "${ROOT}/dist/" --include="*.js" 2>/dev/null | wc -l`, { encoding: 'utf8' }).trim();
console.log(`Remaining 'hexos' in dist/: ${remaining}`);
console.log(`Remaining 'HEXOS_' in dist/: ${remainingEnv}`);

if (parseInt(remaining) === 0 && parseInt(remainingEnv) === 0) {
  console.log('✅ Clean rebrand!');
} else {
  console.log('⚠️ Some references remain — check manually');
}
