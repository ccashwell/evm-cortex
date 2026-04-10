/**
 * Gas Snapshot Diff Hook
 *
 * PostToolUse handler for .sol files:
 * - Compares gas snapshots after Solidity edits
 * - Warns on significant gas regressions (>5%)
 */

import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

interface PostToolUseInput {
  session_id: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    file_path?: string;
  };
  tool_response: {
    success?: boolean;
    filePath?: string;
  };
  cwd: string;
}

function readStdin(): string {
  return readFileSync(0, 'utf-8');
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

function checkGasSnapshot(cwd: string): { hasRegression: boolean; diff: string } {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    return { hasRegression: false, diff: '' };
  }

  const snapshotFile = join(projectRoot, '.gas-snapshot');
  if (!existsSync(snapshotFile)) {
    return { hasRegression: false, diff: '' };
  }

  try {
    const output = execSync('forge snapshot --check --tolerance 5 2>&1', {
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      cwd: projectRoot
    });
    return { hasRegression: false, diff: output };
  } catch (error: any) {
    const output = error.stdout || error.stderr || error.message;
    const regressionLines = output.split('\n')
      .filter((l: string) => l.includes('regression') || l.includes('FAIL'))
      .slice(0, 10);
    return { hasRegression: true, diff: regressionLines.join('\n') };
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

  const result = checkGasSnapshot(input.cwd);

  if (result.hasRegression) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `GAS REGRESSION DETECTED (>5% increase):\n\n${result.diff}\n\nReview gas impact. Run \`forge snapshot --diff\` for full comparison.`
      }
    }));
  } else {
    console.log('{}');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
