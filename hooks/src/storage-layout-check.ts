/**
 * Storage Layout Check Hook
 *
 * PostToolUse handler for .sol files in upgradeable contracts:
 * - Detects if the edited file is part of an upgradeable contract system
 * - Warns about storage layout changes that could break upgrades
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
    content?: string;
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

function isUpgradeable(filePath: string): boolean {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, 'utf-8');
  return (
    content.includes('Initializable') ||
    content.includes('UUPSUpgradeable') ||
    content.includes('TransparentUpgradeableProxy') ||
    content.includes('initializer') ||
    content.includes('__gap')
  );
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

function getContractName(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, 'utf-8');
  const match = content.match(/contract\s+(\w+)/);
  return match ? match[1] : null;
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

  if (!isUpgradeable(filePath)) {
    console.log('{}');
    return;
  }

  const contractName = getContractName(filePath);
  if (!contractName) {
    console.log('{}');
    return;
  }

  const projectRoot = findProjectRoot(input.cwd);
  if (!projectRoot) {
    console.log('{}');
    return;
  }

  try {
    execSync(`forge build 2>/dev/null`, {
      cwd: projectRoot,
      timeout: 30000
    });

    const layout = execSync(
      `forge inspect ${contractName} storage-layout 2>/dev/null`,
      {
        encoding: 'utf-8',
        timeout: 15000,
        cwd: projectRoot
      }
    );

    const hasGap = layout.includes('__gap');

    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `UPGRADEABLE CONTRACT: ${contractName}\n${hasGap ? 'Storage gap detected.' : 'WARNING: No __gap found. Add uint256[50] private __gap for future upgrade safety.'}\nVerify storage layout compatibility: forge inspect ${contractName} storage-layout`
      }
    }));
  } catch {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `UPGRADEABLE CONTRACT: ${contractName}\nCould not inspect storage layout. Run: forge inspect ${contractName} storage-layout`
      }
    }));
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
