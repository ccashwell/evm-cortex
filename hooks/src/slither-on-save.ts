/**
 * Slither-on-Save Hook
 *
 * PostToolUse handler for .sol files:
 * - Runs Slither static analysis after Solidity file edits
 * - Reports high/medium findings to the agent
 * - Skips if Slither is not installed
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

function isSlitherAvailable(): boolean {
  try {
    execSync('which slither', { encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
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

function runSlither(cwd: string): { success: boolean; output: string; findings: number } {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    return { success: true, output: '', findings: 0 };
  }

  try {
    const output = execSync(
      'slither . --filter-paths "test/,script/,lib/" --json - 2>/dev/null',
      {
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 2 * 1024 * 1024,
        cwd: projectRoot
      }
    );

    try {
      const parsed = JSON.parse(output);
      const detectors = parsed.results?.detectors || [];
      const highMed = detectors.filter((d: any) =>
        d.impact === 'High' || d.impact === 'Medium'
      );
      return { success: true, output: JSON.stringify(highMed, null, 2), findings: highMed.length };
    } catch {
      return { success: true, output, findings: 0 };
    }
  } catch (error: any) {
    return { success: false, output: error.message, findings: 0 };
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

  if (!isSlitherAvailable()) {
    console.log('{}');
    return;
  }

  const result = runSlither(input.cwd);

  if (result.findings > 0) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `SLITHER: ${result.findings} High/Medium finding(s) detected. Review before proceeding.\n\n${result.output.slice(0, 2000)}`
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
