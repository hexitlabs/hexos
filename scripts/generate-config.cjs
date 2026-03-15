#!/usr/bin/env node
// ============================================================================
// HexOS Config Generator
// Reads a client YAML config and generates workspace files:
//   - hexos.json   — main gateway config
//   - SOUL.md      — assistant personality
//   - USER.md      — client info
//   - AGENTS.md    — agent roster & workspace instructions
//
// Usage: node scripts/generate-config.cjs clients/jirka.yaml --output /tmp/workspace
// ============================================================================

'use strict';

const fs = require('fs');
const path = require('path');

// ── Simple YAML Parser ─────────────────────────────────────────────────────
// Handles our flat-ish YAML format: scalars, nested objects, and arrays of objects
function parseYaml(text) {
  const result = {};
  const lines = text.split('\n');
  const stack = [{ indent: -1, obj: result }];
  let currentArray = null;
  let currentArrayKey = null;
  let currentArrayIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments and empty lines
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Array item: "- key: value" or "- value"
    if (trimmed.startsWith('- ')) {
      const itemContent = trimmed.slice(2).trim();

      if (itemContent.includes(': ')) {
        // Object in array: "- id: something"
        const item = {};
        const [key, ...valParts] = itemContent.split(': ');
        item[key.trim()] = parseValue(valParts.join(': ').trim());

        // Look ahead for more properties of this array item
        const itemIndent = indent + 2;
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          if (/^\s*#/.test(nextLine) || /^\s*$/.test(nextLine)) { i++; continue; }
          const nextIndent = nextLine.search(/\S/);
          const nextTrimmed = nextLine.trim();
          if (nextIndent >= itemIndent && !nextTrimmed.startsWith('- ')) {
            const [nk, ...nv] = nextTrimmed.split(': ');
            item[nk.trim()] = parseValue(nv.join(': ').trim());
            i++;
          } else {
            break;
          }
        }

        if (currentArray) {
          currentArray.push(item);
        }
      } else {
        // Simple value in array: "- 123456789"
        if (currentArray) {
          currentArray.push(parseValue(itemContent));
        }
      }
      continue;
    }

    // Key: value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const rawVal = trimmed.slice(colonIdx + 1).trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    if (rawVal === '' || rawVal === null) {
      // Nested object or upcoming array
      // Peek ahead to determine if it's an array
      let nextNonEmpty = i + 1;
      while (nextNonEmpty < lines.length && /^\s*(#.*)?$/.test(lines[nextNonEmpty])) nextNonEmpty++;

      if (nextNonEmpty < lines.length && lines[nextNonEmpty].trim().startsWith('- ')) {
        // It's an array
        parent[key] = [];
        currentArray = parent[key];
        currentArrayKey = key;
        currentArrayIndent = indent;
      } else {
        // Nested object
        parent[key] = {};
        stack.push({ indent, obj: parent[key] });
        currentArray = null;
      }
    } else {
      parent[key] = parseValue(rawVal);
      currentArray = null;
    }
  }

  return result;
}

function parseValue(val) {
  if (val === undefined || val === '') return '';
  // Remove surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  // Remove inline comments
  const commentIdx = val.indexOf('  #');
  if (commentIdx > 0) val = val.slice(0, commentIdx).trim();
  // Numbers
  if (/^-?\d+$/.test(val)) return parseInt(val, 10);
  if (/^-?\d+\.\d+$/.test(val)) return parseFloat(val);
  // Booleans
  if (val === 'true') return true;
  if (val === 'false') return false;
  return val;
}

// ── Generator ──────────────────────────────────────────────────────────────

function generateHexosJson(config) {
  const json = {
    telegram: {
      token: config.telegram?.bot_token || 'MISSING'
    }
  };

  // Allowed users
  if (config.telegram?.allowed_users) {
    json.telegram.allowedUsers = config.telegram.allowed_users;
  }

  // API config
  if (config.api?.provider === 'anthropic') {
    json.anthropic = { apiKey: config.api.key || 'MISSING' };
  } else if (config.api?.provider === 'openai') {
    json.openai = { apiKey: config.api.key || 'MISSING' };
  }

  // Model
  if (config.A?.model) {
    json.model = config.A.model;
  }

  // Heartbeat
  if (config.heartbeat?.interval_minutes) {
    json.heartbeat = { intervalMinutes: config.heartbeat.interval_minutes };
  }

  // Vigil
  if (config.vigil?.policy) {
    json.vigil = { policy: config.vigil.policy };
  }

  return JSON.stringify(json, null, 2);
}

function generateSoulMd(config) {
  const name = config.A?.name || 'Assistant';
  const clientName = config.client?.name || 'the client';
  const company = config.client?.company || '';
  const agents = config.agents || [];

  let md = `# SOUL.md — ${name}\n\n`;
  md += `You are **${name}**, a personal AI assistant`;
  if (company) {
    md += ` for **${company}**`;
  }
  md += `.\n\n`;
  md += `## Your Human\n\n`;
  md += `Your primary user is **${clientName}**.`;
  if (company) {
    md += ` They run ${company}.`;
  }
  md += `\n\n`;
  md += `## Core Principles\n\n`;
  md += `- Be helpful, proactive, and concise\n`;
  md += `- Protect your human's time — give answers, not lectures\n`;
  md += `- When unsure, ask rather than guess\n`;
  md += `- Keep conversations focused and actionable\n`;

  if (agents.length > 0) {
    md += `\n## Your Team\n\n`;
    md += `You coordinate with these specialist agents:\n\n`;
    for (const agent of agents) {
      md += `- **${agent.name}** (${agent.id}) — ${agent.specialty || 'General purpose'}\n`;
    }
  }

  md += `\n## Communication Style\n\n`;
  md += `- Direct and professional\n`;
  md += `- Use bullet points for multiple items\n`;
  md += `- Lead with the answer, then explain if needed\n`;
  md += `- Match your human's energy — brief if they're brief, detailed if they ask\n`;

  return md;
}

function generateUserMd(config) {
  const name = config.client?.name || 'Client';
  const company = config.client?.company || '';

  let md = `# USER.md — ${name}\n\n`;
  if (company) {
    md += `**Company:** ${company}\n\n`;
  }
  md += `## About\n\n`;
  md += `<!-- Add personal details, preferences, and context here -->\n\n`;
  md += `## Preferences\n\n`;
  md += `- Language: English\n`;
  md += `- Timezone: <!-- fill in -->\n`;
  md += `- Communication style: Direct, professional\n\n`;
  md += `## Notes\n\n`;
  md += `<!-- Add anything relevant about the client -->\n`;

  return md;
}

function generateAgentsMd(config) {
  const agents = config.agents || [];

  let md = `# AGENTS.md — Your Workspace\n\n`;
  md += `This folder is home. Treat it that way.\n\n`;
  md += `## Every Session\n\n`;
  md += `Before doing anything else:\n`;
  md += `1. Read \`SOUL.md\` — this is who you are\n`;
  md += `2. Read \`USER.md\` — this is who you're helping\n`;
  md += `3. Read \`memory/\` for recent context\n\n`;
  md += `## Memory\n\n`;
  md += `You wake up fresh each session. These files are your continuity:\n`;
  md += `- **Daily notes:** \`memory/YYYY-MM-DD.md\` — raw logs of what happened\n`;
  md += `- **Long-term:** \`MEMORY.md\` — your curated memories\n\n`;

  if (agents.length > 0) {
    md += `## Agent Roster\n\n`;
    md += `| ID | Name | Specialty |\n`;
    md += `|----|------|-----------|\n`;
    for (const agent of agents) {
      const model = agent.model ? ` (${agent.model})` : '';
      md += `| ${agent.id} | ${agent.name}${model} | ${agent.specialty || '—'} |\n`;
    }
    md += `\n`;
  }

  md += `## Safety\n\n`;
  md += `- Don't exfiltrate private data. Ever.\n`;
  md += `- Don't run destructive commands without asking.\n`;
  md += `- When in doubt, ask.\n`;

  return md;
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/generate-config.cjs <client.yaml> --output <dir>');
    console.log('');
    console.log('Generates HexOS workspace files from a client YAML config:');
    console.log('  hexos.json  — main gateway configuration');
    console.log('  SOUL.md     — assistant personality');
    console.log('  USER.md     — client information');
    console.log('  AGENTS.md   — agent roster & workspace instructions');
    process.exit(0);
  }

  // Parse args
  let configPath = null;
  let outputDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    } else if (!args[i].startsWith('-')) {
      configPath = args[i];
    }
  }

  if (!configPath) {
    console.error('Error: No config file specified');
    process.exit(1);
  }

  if (!outputDir) {
    console.error('Error: No output directory specified (use --output <dir>)');
    process.exit(1);
  }

  // Resolve paths
  configPath = path.resolve(configPath);
  outputDir = path.resolve(outputDir);

  if (!fs.existsSync(configPath)) {
    console.error(`Error: Config file not found: ${configPath}`);
    process.exit(1);
  }

  // Parse YAML
  const yamlText = fs.readFileSync(configPath, 'utf8');
  const config = parseYaml(yamlText);

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate files
  const files = {
    'hexos.json': generateHexosJson(config),
    'SOUL.md': generateSoulMd(config),
    'USER.md': generateUserMd(config),
    'AGENTS.md': generateAgentsMd(config),
  };

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`  ✓ Generated ${filename} (${content.length} bytes)`);
  }

  console.log(`\n  All files written to: ${outputDir}`);
}

main();
