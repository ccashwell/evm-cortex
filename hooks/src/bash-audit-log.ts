/**
 * Bash Audit Log - PostToolUse hook
 * Her bash komutu calistirildiginda ~/.claude/bash-audit.log'a yazar
 * Mutation komutlarini [WRITE] olarak isaretler
 */
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { appendWithRotation } from './shared/log-rotation.js';

interface PostToolInput {
  session_id: string;
  tool_name: string;
  tool_input: {
    command?: string;
    description?: string;
  };
  tool_output?: string;
}

const WRITE_PATTERNS = [
  /^(rm|mv|cp|mkdir|rmdir|touch|chmod|chown)\b/,
  /^git\s+(push|commit|reset|checkout|merge|rebase|stash|clean|branch\s+-[dD])/,
  /\b(npm|pnpm|yarn)\s+(install|uninstall|publish|run\s+build)/,
  />(>)?/,  // redirect
  /\bsudo\b/,
  /\bdocker\s+(rm|stop|kill|exec|run)/,
];

function isWriteCommand(cmd: string): boolean {
  return WRITE_PATTERNS.some(p => p.test(cmd.trim()));
}

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf-8'); } catch { return; }
  if (!raw) return;

  let input: PostToolInput;
  try { input = JSON.parse(raw); } catch { console.log('{}'); return; }
  if (input.tool_name !== 'Bash' || !input.tool_input?.command) {
    console.log('{}');
    return;
  }

  const cmd = input.tool_input.command;
  const tag = isWriteCommand(cmd) ? '[WRITE]' : '[READ]';
  const timestamp = new Date().toISOString();
  const desc = input.tool_input.description || '';
  const sessionId = input.session_id?.slice(0, 8) || 'unknown';

  const logDir = join(homedir(), '.claude');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const logLine = `${timestamp} ${tag} [${sessionId}] ${cmd}${desc ? ` # ${desc}` : ''}\n`;
  appendWithRotation(join(logDir, 'bash-audit.log'), logLine);

  console.log('{}');
}

main();
