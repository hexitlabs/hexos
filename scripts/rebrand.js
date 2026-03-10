#!/usr/bin/env node
/**
 * HexOS Rebrand Script
 * Renames all "clawdbot" references to "hexos" across the codebase.
 * Applies replacements in order (most specific first) to avoid partial matches.
 */

import { readdir, readFile, writeFile, rename, stat } from 'fs/promises';
import { join, extname, basename } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

// Replacement pairs — ORDER MATTERS (most specific first)
const REPLACEMENTS = [
  // 1. systemd service names
  ['clawdbot-gateway', 'hexos-gateway'],
  // 2. config file names (in strings)
  ['clawdbot.json', 'hexos.json'],
  // 3. config directory paths
  ['.clawdbot', '.hexos'],
  // 4. environment variables (uppercase prefix)
  ['CLAWDBOT_', 'HEXOS_'],
  // 5. Variable names ending with _CLAWDBOT
  ['_CLAWDBOT', '_HEXOS'],
  // 6. All-caps standalone CLAWDBOT (e.g. branding in UI)
  ['CLAWDBOT', 'HEXOS'],
  // 7. Mixed case ClawdBot
  ['ClawdBot', 'HexOS'],
  // 8. Display name Clawdbot
  ['Clawdbot', 'HexOS'],
  // 9. lowercase in code
  ['clawdbot', 'hexos'],
];

// Also update the ASCII art banner
const ASCII_REPLACEMENTS = [
  // The CLAWDBOT ASCII art → HEXOS ASCII art
  [
    '░████░█░░░░░█████░█░░░█░███░░████░░████░░▀█▀',
    '░█░░█░█████░█░░░█░░████░░████',
  ],
  [
    '█░░░░░█░░░░░█░░░█░█░█░█░█░░█░█░░░█░█░░░█░░█░',
    '░█░░█░█░░░░░░░█░░░░█░░░█░█░░░░',
  ],
  [
    '█░░░░░█░░░░░█████░█░█░█░█░░█░████░░█░░░█░░█░',
    '░████░████░░░░█░░░░█░░░█░░████░',
  ],
  [
    '█░░░░░█░░░░░█░░░█░█░█░█░█░░█░█░░█░░█░░░█░░█░',
    '░█░░█░█░░░░░░░█░░░░█░░░█░░░░░█░',
  ],
  [
    '░████░█████░█░░░█░░█░█░░███░░████░░░███░░░█░',
    '░█░░█░█████░█░░░█░░████░░████░',
  ],
  [
    '              🦞 FRESH DAILY 🦞',
    '            ⬡ HexOS ⬡',
  ],
];

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.json', '.md', '.sh', '.yml', '.yaml',
  '.txt', '.html', '.css', '.ts', '.tsx', '.jsx', '.service',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.map',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILES = new Set(['rebrand.js']); // Don't modify ourselves

const PROCESS_DIRS = ['dist', 'docs', 'scripts', 'extensions', 'skills', 'package', 'git-hooks', 'patches', 'assets'];
const PROCESS_FILES = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'];

// Files to rename (path relative to root)
const FILES_TO_RENAME = [];

let totalFiles = 0;
let totalReplacements = 0;
let modifiedFiles = 0;

async function findTextFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findTextFiles(fullPath));
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(entry.name)) continue;
      const ext = extname(entry.name).toLowerCase();
      // Include files with known text extensions OR no extension (likely scripts)
      if (TEXT_EXTENSIONS.has(ext) || ext === '') {
        files.push(fullPath);
      }
    }
  }
  return files;
}

function applyReplacements(content) {
  let result = content;
  let count = 0;

  // First apply ASCII art replacements
  for (const [oldText, newText] of ASCII_REPLACEMENTS) {
    if (result.includes(oldText)) {
      result = result.replaceAll(oldText, newText);
      count++;
    }
  }

  // Then apply standard replacements in order
  for (const [oldText, newText] of REPLACEMENTS) {
    const matches = result.split(oldText).length - 1;
    if (matches > 0) {
      result = result.replaceAll(oldText, newText);
      count += matches;
    }
  }

  return { result, count };
}

async function processFile(filePath) {
  totalFiles++;
  let content;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    // Binary file or read error — skip
    return;
  }

  // Quick check: does file contain any target strings?
  const hasTarget = REPLACEMENTS.some(([old]) => content.includes(old)) ||
    ASCII_REPLACEMENTS.some(([old]) => content.includes(old));
  if (!hasTarget) return;

  const { result, count } = applyReplacements(content);

  if (count > 0) {
    await writeFile(filePath, result, 'utf-8');
    modifiedFiles++;
    totalReplacements += count;
    const rel = filePath.replace(ROOT + '/', '');
    console.log(`  ✓ ${rel} (${count} replacements)`);
  }
}

async function renameFiles() {
  // Find any file literally named clawdbot.json
  const findClawdbotJson = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await findClawdbotJson(fullPath);
      } else if (entry.name === 'clawdbot.json') {
        const newPath = join(dir, 'hexos.json');
        console.log(`  📁 Renaming ${fullPath} → ${newPath}`);
        await rename(fullPath, newPath);
      }
    }
  };

  await findClawdbotJson(ROOT);
}

async function updatePackageJson() {
  const pkgPath = join(ROOT, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));

  pkg.name = '@hexitlabs/hexos';
  pkg.description = (pkg.description || '').replace(/clawdbot/gi, 'HexOS');
  pkg.bin = { hexos: 'dist/entry.js' };

  if (pkg.author) {
    pkg.author = 'HexIT Labs';
  }

  if (pkg.repository) {
    if (typeof pkg.repository === 'string') {
      pkg.repository = 'https://github.com/hexitlabs/hexos';
    } else {
      pkg.repository.url = 'https://github.com/hexitlabs/hexos.git';
    }
  }

  if (pkg.homepage) {
    pkg.homepage = 'https://github.com/hexitlabs/hexos';
  }

  if (pkg.bugs) {
    if (typeof pkg.bugs === 'string') {
      pkg.bugs = 'https://github.com/hexitlabs/hexos/issues';
    } else {
      pkg.bugs.url = 'https://github.com/hexitlabs/hexos/issues';
    }
  }

  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log('  ✓ package.json updated (name, bin, author, repository)');
}

async function updateLicense() {
  const licensePath = join(ROOT, 'LICENSE');
  let content = await readFile(licensePath, 'utf-8');

  if (!content.includes('Based on Clawdbot')) {
    const header = 'Based on Clawdbot by Peter Steinberger (MIT)\n\n';
    content = header + content;
    await writeFile(licensePath, content, 'utf-8');
    console.log('  ✓ LICENSE updated with Clawdbot attribution');
  }
}

// Main
console.log('🔄 HexOS Rebrand Script');
console.log('========================\n');

// Collect all files to process
console.log('📂 Scanning files...');
let allFiles = [];

for (const dir of PROCESS_DIRS) {
  const dirPath = join(ROOT, dir);
  try {
    await stat(dirPath);
    const files = await findTextFiles(dirPath);
    allFiles.push(...files);
    console.log(`  ${dir}/: ${files.length} text files`);
  } catch {
    console.log(`  ${dir}/: not found, skipping`);
  }
}

for (const file of PROCESS_FILES) {
  const filePath = join(ROOT, file);
  try {
    await stat(filePath);
    allFiles.push(filePath);
  } catch {
    console.log(`  ${file}: not found, skipping`);
  }
}

console.log(`\n📝 Processing ${allFiles.length} files...\n`);

for (const file of allFiles) {
  await processFile(file);
}

console.log(`\n📁 Renaming files...\n`);
await renameFiles();

console.log(`\n📦 Updating package.json...\n`);
await updatePackageJson();

console.log(`\n📄 Updating LICENSE...\n`);
await updateLicense();

console.log(`\n✅ Rebrand complete!`);
console.log(`   Files scanned:  ${totalFiles}`);
console.log(`   Files modified: ${modifiedFiles}`);
console.log(`   Replacements:   ${totalReplacements}`);
