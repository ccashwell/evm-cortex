/**
 * Forge Compile Check Hook
 *
 * PostToolUse handler for .sol files:
 * - Runs `forge build` after Solidity file edits
 * - Provides compilation feedback to the agent
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

interface PostToolUseInput {
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    file_path?: string;
    content?: string;
  };
  tool_response: {
    success?: boolean;
    filePath?: string;
  };
  cwd: string;
}

interface CompilerState {
  session_id: string;
  file_path: string;
  has_errors: boolean;
  errors: string;
  timestamp: number;
}

const STATE_DIR = process.env.CLAUDE_PROJECT_DIR
  ? join(process.env.CLAUDE_PROJECT_DIR, '.claude', 'cache', 'forge')
  : join(tmpdir(), 'claude-forge');

const STATE_FILE = join(STATE_DIR, 'compiler-state.json');

function readStdin(): string {
  return readFileSync(0, 'utf-8');
}

function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

function saveState(state: CompilerState): void {
  ensureStateDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function findProjectRoot(cwd: string): string | null {
  let dir = cwd;
  while (dir !== '/') {
    if (existsSync(join(dir, 'foundry.toml'))) return dir;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function runForge(filePath: string, cwd: string): { success: boolean; output: string } {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    return { success: true, output: 'No foundry.toml found, skipping forge build' };
  }

  try {
    const output = execSync('forge build 2>&1', {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 1024 * 1024,
      cwd: projectRoot
    });
    return { success: true, output };
  } catch (error: any) {
    const output = error.stdout || error.stderr || error.message;
    return { success: false, output };
  }
}

async function main() {
  const input: PostToolUseInput = JSON.parse(readStdin());

  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit') {
    console.log('{}');
    return;
  }

  const filePath = input.tool_input?.file_path || input.tool_response?.filePath || '';

  if (!filePath.endsWith('.sol')) {
    console.log('{}');
    return;
  }

  const result = runForge(filePath, input.cwd);

  const state: CompilerState = {
    session_id: input.session_id,
    file_path: filePath,
    has_errors: !result.success,
    errors: result.output,
    timestamp: Date.now()
  };
  saveState(state);

  if (!result.success) {
    const errorLines = result.output.split('\n').filter(l => l.includes('Error') || l.includes('error')).slice(0, 10);
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `FORGE BUILD ERRORS:\n\n${errorLines.join('\n')}\n\nFix compilation errors before proceeding.`
      }
    }));
  } else {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: 'forge build: compilation successful'
      }
    }));
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
