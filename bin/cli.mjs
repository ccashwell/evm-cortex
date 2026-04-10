#!/usr/bin/env node

// EVM Cortex npm CLI
// npx evm-cortex [command] [options]

import { existsSync, mkdirSync, cpSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_DIR = join(__dirname, '..');
const CLAUDE_DIR = join(homedir(), '.claude');
const VERSION = '1.0.0';

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function c(color, text) { return `${COLORS[color]}${text}${COLORS.reset}`; }

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

function countFiles(dir, pattern) {
  try {
    if (pattern === 'dirs') return readdirSync(dir).filter(f => statSync(join(dir, f)).isDirectory()).length;
    return readdirSync(dir).filter(f => f.endsWith(pattern)).length;
  } catch { return 0; }
}

function smartCopy(src, dest, force = false) {
  let added = 0, skipped = 0;
  if (!existsSync(src)) return { added, skipped };

  if (statSync(src).isDirectory()) {
    if (force || !existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest, { recursive: true });
      added++;
    } else { skipped++; }
  } else {
    if (force || !existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest);
      added++;
    } else { skipped++; }
  }
  return { added, skipped };
}

function install(options = {}) {
  const { force = false, profile = 'all' } = options;
  let totalAdded = 0, totalSkipped = 0;

  const track = (result) => { totalAdded += result.added; totalSkipped += result.skipped; };

  const count = (dir, opts = {}) => {
    const p = join(REPO_DIR, dir);
    if (!existsSync(p)) return 0;
    const entries = readdirSync(p);
    if (opts.dirs) return entries.filter(e => statSync(join(p, e)).isDirectory()).length;
    return entries.filter(e => e.endsWith(opts.ext || '.md')).length;
  };
  const agents = count('agents');
  const skills = count('skills', { dirs: true });
  const hooks = count('hooks/src', { ext: '.ts' });
  const rules = count('rules');

  console.log(c('bold', '\nEVM Cortex installer'));
  console.log('========================\n');
  console.log(`Installing into ${c('cyan', '~/.claude/')}:`);
  console.log(`  - ${agents} agents   -> ~/.claude/agents/`);
  console.log(`  - ${skills} skills   -> ~/.claude/skills/`);
  console.log(`  - ${hooks} hooks    -> ~/.claude/hooks/`);
  console.log(`  - ${rules} rules    -> ~/.claude/rules/`);
  console.log(`\nMode: ${force ? c('yellow', 'OVERWRITE') : c('green', 'MERGE')} | Profile: ${c('blue', profile)}\n`);

  // Agents
  process.stdout.write('Installing agents...');
  mkdirSync(join(CLAUDE_DIR, 'agents'), { recursive: true });
  const agentDir = join(REPO_DIR, 'agents');
  if (existsSync(agentDir)) {
    for (const f of readdirSync(agentDir).filter(f => f.endsWith('.md'))) {
      track(smartCopy(join(agentDir, f), join(CLAUDE_DIR, 'agents', f), force));
    }
  }
  console.log(c('green', ' done'));

  // Skills
  process.stdout.write('Installing skills...');
  mkdirSync(join(CLAUDE_DIR, 'skills'), { recursive: true });
  const skillDir = join(REPO_DIR, 'skills');
  if (existsSync(skillDir)) {
    for (const d of readdirSync(skillDir)) {
      const fullPath = join(skillDir, d);
      if (statSync(fullPath).isDirectory()) {
        track(smartCopy(fullPath, join(CLAUDE_DIR, 'skills', d), force));
      }
    }
  }
  console.log(c('green', ' done'));

  // Hooks (pre-built dist)
  process.stdout.write('Installing hooks...');
  mkdirSync(join(CLAUDE_DIR, 'hooks', 'dist'), { recursive: true });
  const distDir = join(REPO_DIR, 'hooks', 'dist');
  if (existsSync(distDir)) {
    for (const f of readdirSync(distDir).filter(f => f.endsWith('.mjs'))) {
      track(smartCopy(join(distDir, f), join(CLAUDE_DIR, 'hooks', 'dist', f), force));
    }
  }
  // Copy hooks.json if exists
  const hooksJson = join(REPO_DIR, 'hooks', 'hooks.json');
  if (existsSync(hooksJson)) {
    track(smartCopy(hooksJson, join(CLAUDE_DIR, 'hooks', 'hooks.json'), force));
  }
  console.log(c('green', ' done'));

  // Rules
  process.stdout.write('Installing rules...');
  mkdirSync(join(CLAUDE_DIR, 'rules'), { recursive: true });
  const rulesDir = join(REPO_DIR, 'rules');
  if (existsSync(rulesDir)) {
    for (const f of readdirSync(rulesDir).filter(f => f.endsWith('.md'))) {
      track(smartCopy(join(rulesDir, f), join(CLAUDE_DIR, 'rules', f), force));
    }
  }
  console.log(c('green', ' done'));

  // Profiles
  process.stdout.write('Installing profiles...');
  mkdirSync(join(CLAUDE_DIR, 'profiles'), { recursive: true });
  const profilesDir = join(REPO_DIR, 'profiles');
  if (existsSync(profilesDir)) {
    for (const f of readdirSync(profilesDir).filter(f => f.endsWith('.json'))) {
      track(smartCopy(join(profilesDir, f), join(CLAUDE_DIR, 'profiles', f), force));
    }
  }
  console.log(c('green', ' done'));

  // Summary
  console.log(`\n${c('bold', 'Installation complete!')}`);
  console.log(`  ${c('green', 'Added:')}   ${totalAdded} files`);
  console.log(`  ${c('dim', 'Skipped:')} ${totalSkipped} files (already existed)`);
  console.log(`\n  Agents: ${countFiles(join(CLAUDE_DIR, 'agents'), '.md')}`);
  console.log(`  Skills: ${countFiles(join(CLAUDE_DIR, 'skills'), 'dirs')}`);
  console.log(`  Hooks:  ${countFiles(join(CLAUDE_DIR, 'hooks', 'dist'), '.mjs')}`);
  console.log(`  Rules:  ${countFiles(join(CLAUDE_DIR, 'rules'), '.md')}`);

  if (totalSkipped > 0) {
    console.log(`\n  Tip: Use ${c('yellow', 'npx evm-cortex init --force')} to overwrite existing files.`);
  }

  console.log(`\n  Run ${c('cyan', 'npx evm-cortex doctor')} to verify your setup.\n`);
}

function showHelp() {
  const cnt = (dir, opts = {}) => {
    const p = join(REPO_DIR, dir);
    if (!existsSync(p)) return '?';
    const entries = readdirSync(p);
    if (opts.dirs) return entries.filter(e => statSync(join(p, e)).isDirectory()).length;
    return entries.filter(e => e.endsWith(opts.ext || '.md')).length;
  };
  console.log(`
${c('bold', 'EVM Cortex')} v${VERSION} - Ethereum protocol engineering squad

${c('bold', 'USAGE')}
  npx evm-cortex [command] [options]

${c('bold', 'COMMANDS')}
  init              Install EVM Cortex into ~/.claude/
  init --force      Overwrite existing files
  doctor            Run health check on installation
  version           Show version
  help              Show this help

${c('bold', 'EXAMPLES')}
  npx evm-cortex init          # Install all components
  npx evm-cortex init --force  # Overwrite existing setup
  npx evm-cortex doctor        # Verify installation

${c('bold', 'COMPONENTS')}
  ${cnt('agents')} agents   Solidity engineering, security, DeFi, Uniswap, testing
  ${cnt('skills', { dirs: true })} skills   Deep domain knowledge across all Ethereum domains
  ${cnt('hooks/src', { ext: '.ts' })} hooks    Real-time feedback (forge, slither, gas, natspec)
  ${cnt('rules')} rules    EVM-specific development guidelines

${c('dim', 'https://github.com/ccashwell/evm-cortex')}
`);
}

function doctor() {
  console.log(`\n${c('bold', 'EVM Cortex doctor')} - Health Check\n`);
  const checks = [
    { name: 'Agents directory', path: join(CLAUDE_DIR, 'agents'), type: 'dir' },
    { name: 'Skills directory', path: join(CLAUDE_DIR, 'skills'), type: 'dir' },
    { name: 'Hooks dist', path: join(CLAUDE_DIR, 'hooks', 'dist'), type: 'dir' },
    { name: 'Rules directory', path: join(CLAUDE_DIR, 'rules'), type: 'dir' },
  ];

  let pass = 0, fail = 0;
  for (const check of checks) {
    const exists = existsSync(check.path);
    const status = exists ? c('green', 'PASS') : c('red', 'FAIL');
    console.log(`  ${status}  ${check.name}`);
    if (exists) pass++; else fail++;
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) {
    console.log(`  Run ${c('cyan', 'npx evm-cortex init')} to fix.\n`);
  }
}

// Parse args
const args = process.argv.slice(2);
const command = args[0] || 'help';

switch (command) {
  case 'init': {
    const force = args.includes('--force');
    const profileIdx = args.indexOf('--profile');
    const profile = profileIdx !== -1 ? args[profileIdx + 1] : 'all';
    install({ force, profile });
    break;
  }
  case 'doctor':
    doctor();
    break;
  case 'version':
  case '--version':
  case '-v':
    console.log(`EVM Cortex v${VERSION}`);
    break;
  case 'help':
  case '--help':
  case '-h':
  default:
    showHelp();
    break;
}
