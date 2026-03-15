#!/usr/bin/env node
'use strict';

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const BANNER = `
\x1b[36m
  ╦ ╦┌─┐─┐ ┬╔═╗╔═╗
  ╠═╣├┤ ┌┴┬┘║ ║╚═╗
  ╩ ╩└─┘┴ └─╚═╝╚═╝
\x1b[0m
  \x1b[2mYour AI, your rules.\x1b[0m
`;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, fallback) {
  return new Promise((resolve) => {
    const prompt = fallback ? `${question} \x1b[2m(${fallback})\x1b[0m: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || fallback || '');
    });
  });
}

function copyDir(src, dest, replacements) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, replacements);
    } else {
      let content = fs.readFileSync(srcPath, 'utf8');
      for (const [key, value] of Object.entries(replacements)) {
        content = content.replaceAll(key, value);
      }
      fs.writeFileSync(destPath, content);
    }
  }
}

async function main() {
  console.log(BANNER);
  console.log('  Welcome to HexOS setup.\n');

  const workspacePath = await ask('  Workspace path', path.resolve(process.env.HOME || '~', 'hexos'));
  const assistantName = await ask('  Assistant name', 'Hex');
  const userName = await ask('  Your name');
  const timezone = await ask('  Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone);

  console.log();

  // Resolve paths
  const workspace = path.resolve(workspacePath);
  const templatesDir = path.resolve(__dirname, '..', 'templates');

  if (!fs.existsSync(templatesDir)) {
    console.error('\x1b[31m  Error: templates/ not found. Is HexOS installed correctly?\x1b[0m');
    rl.close();
    process.exit(1);
  }

  // Create workspace
  console.log(`  Creating workspace at \x1b[36m${workspace}\x1b[0m...`);
  fs.mkdirSync(workspace, { recursive: true });

  // Copy templates with replacements
  const replacements = {
    '{{ASSISTANT_NAME}}': assistantName,
    '{{USER_NAME}}': userName,
    '{{TIMEZONE}}': timezone,
  };
  copyDir(templatesDir, workspace, replacements);

  // Copy hexos.json default config if not already present
  const hexosConfigDest = path.join(workspace, 'hexos.json');
  const hexosConfigSrc = path.join(templatesDir, 'hexos.json');
  if (!fs.existsSync(hexosConfigDest) && fs.existsSync(hexosConfigSrc)) {
    fs.copyFileSync(hexosConfigSrc, hexosConfigDest);
    console.log('  ✓ hexos.json config created');
  }

  // Create additional directories
  fs.mkdirSync(path.join(workspace, 'memory'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'scratch'), { recursive: true });

  // Create state.json
  const state = {
    version: 1,
    created: new Date().toISOString(),
    assistant: assistantName,
    user: userName,
    timezone: timezone,
    tasks: [],
  };
  fs.writeFileSync(path.join(workspace, 'state.json'), JSON.stringify(state, null, 2) + '\n');

  // Create MEMORY.md
  fs.writeFileSync(
    path.join(workspace, 'MEMORY.md'),
    `# MEMORY.md — Long-Term Memory\n\nCurated memories and key facts. Updated automatically and manually.\n`
  );

  console.log('  ✓ Templates copied');
  console.log('  ✓ memory/ created');
  console.log('  ✓ scratch/ created');
  console.log('  ✓ state.json initialized');
  console.log('  ✓ MEMORY.md created');
  console.log();
  console.log(`  \x1b[32m✔ HexOS is ready!\x1b[0m`);
  console.log(`  Run \x1b[36mhexos gateway start\x1b[0m to begin.`);
  console.log();

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
