#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

// ANSI colors (no external deps)
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const PASS = green('✓');
const WARN = yellow('⚠');
const FAIL = red('✗');

let passes = 0;
let warnings = 0;
let failures = 0;

function pass(msg) {
  console.log(`  ${PASS} ${msg}`);
  passes++;
}

function warn(msg) {
  console.log(`  ${WARN} ${msg}`);
  warnings++;
}

function fail(msg) {
  console.log(`  ${FAIL} ${msg}`);
  failures++;
}

// Resolve workspace: use HEXOS_WORKSPACE env, or fall back to ~/hexos
function resolveWorkspace() {
  if (process.env.HEXOS_WORKSPACE) return path.resolve(process.env.HEXOS_WORKSPACE);
  return path.resolve(os.homedir(), 'hexos');
}

// 1. Node.js version
function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major >= 18) {
    pass(`Node.js ${version} ${dim('(requires 18+)')}`);
  } else {
    fail(`Node.js ${version} — requires 18+ ${dim('(upgrade at https://nodejs.org)')}`);
  }
}

// 2. Workspace exists
function checkWorkspace(workspace) {
  const soulExists = fs.existsSync(path.join(workspace, 'SOUL.md'));
  const configExists = fs.existsSync(path.join(workspace, 'hexos.json'));
  const memoryExists = fs.existsSync(path.join(workspace, 'memory'));

  if (soulExists || configExists || memoryExists) {
    pass(`Workspace found at ${dim(workspace)}`);
    return true;
  } else {
    fail(`Workspace not found at ${workspace} ${dim('(run hexos setup)')}`);
    return false;
  }
}

// 3. Config valid
function checkConfig(workspace) {
  const configPath = path.join(workspace, 'hexos.json');
  if (!fs.existsSync(configPath)) {
    warn(`No hexos.json found ${dim('(using defaults)')}`);
    return null;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    if (typeof config.version !== 'number') {
      warn(`hexos.json missing "version" field`);
      return config;
    }
    pass(`Config valid ${dim('(hexos.json)')}`);
    return config;
  } catch (e) {
    fail(`hexos.json parse error: ${e.message}`);
    return null;
  }
}

// 4. Ollama available
function checkOllama() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:11434/', { timeout: 3000 }, (res) => {
      pass(`Ollama reachable ${dim('(localhost:11434)')}`);
      res.resume();
      resolve();
    });
    req.on('error', () => {
      warn(`Ollama not reachable ${dim('(Recall memory will be limited)')}`);
      resolve();
    });
    req.on('timeout', () => {
      req.destroy();
      warn(`Ollama not reachable ${dim('(Recall memory will be limited)')}`);
      resolve();
    });
  });
}

// 5. API key set
function checkApiKey() {
  const hasKey = !!(
    process.env.HEXOS_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENAI_API_KEY
  );
  if (hasKey) {
    pass('API key configured');
  } else {
    warn(`No API key found ${dim('(set HEXOS_API_KEY or ANTHROPIC_API_KEY)')}`);
  }
}

// 6. Vigil policies
function checkVigil(workspace, config) {
  const policiesDir = path.join(workspace, 'policies');
  const policy = config?.vigil?.policy || 'moderate';
  if (fs.existsSync(policiesDir)) {
    pass(`Vigil policies loaded ${dim(`(${policy})`)}`);
  } else if (config?.vigil?.enabled === false) {
    pass(`Vigil disabled ${dim('(no policies needed)')}`);
  } else {
    warn(`Vigil policies directory not found ${dim('(using built-in defaults)')}`);
  }
}

// 7. Memory directory
function checkMemory(workspace) {
  const memDir = path.join(workspace, 'memory');
  if (!fs.existsSync(memDir)) {
    warn(`Memory directory not found ${dim('(run hexos setup)')}`);
    return;
  }
  try {
    const testFile = path.join(memDir, '.doctor-write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    pass('Memory directory writable');
  } catch {
    fail(`Memory directory not writable ${dim(`(${memDir})`)}`);
  }
}

// 8. Disk space
function checkDiskSpace() {
  try {
    const stats = fs.statfsSync('/');
    const freeBytes = stats.bfree * stats.bsize;
    const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
    if (freeBytes < 1024 * 1024 * 1024) {
      warn(`Low disk space: ${freeGB} GB free ${dim('(recommend > 1 GB)')}`);
    } else {
      pass(`Disk space: ${freeGB} GB free`);
    }
  } catch {
    // fs.statfsSync not available on older Node
    warn(`Could not check disk space ${dim('(requires Node 18.15+)')}`);
  }
}

async function main() {
  console.log();
  console.log(`🔷 ${bold('HexOS Doctor')}`);
  console.log();

  const workspace = resolveWorkspace();

  // Run checks
  checkNodeVersion();
  const wsExists = checkWorkspace(workspace);
  const config = wsExists ? checkConfig(workspace) : null;
  await checkOllama();
  checkApiKey();
  if (wsExists) checkVigil(workspace, config);
  if (wsExists) checkMemory(workspace);
  checkDiskSpace();

  // Summary
  const total = passes + warnings + failures;
  console.log();
  const parts = [`${passes}/${total} checks passed.`];
  if (warnings > 0) parts.push(`${warnings} warning${warnings > 1 ? 's' : ''}.`);
  if (failures > 0) parts.push(`${failures} failure${failures > 1 ? 's' : ''}.`);
  
  if (failures > 0) {
    console.log(`  ${red(parts.join(' '))}`);
  } else if (warnings > 0) {
    console.log(`  ${yellow(parts.join(' '))}`);
  } else {
    console.log(`  ${green(parts.join(' '))}`);
  }
  console.log();

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
