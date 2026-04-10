/**
 * NatSpec Enforcer Hook
 *
 * PostToolUse handler for .sol files:
 * - Checks for missing NatSpec on public/external functions
 * - Warns the agent to add documentation
 */

import { readFileSync, existsSync } from 'fs';

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

function checkNatSpec(filePath: string): string[] {
  if (!existsSync(filePath)) return [];

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const missing: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    const isFunctionDecl = /^\s*(function\s+\w+)/.test(line);
    if (!isFunctionDecl) continue;

    const isPublicOrExternal = /\b(public|external)\b/.test(line);
    if (!isPublicOrExternal) continue;

    const isOverride = /\boverride\b/.test(line);
    if (isOverride) continue;

    let hasNatSpec = false;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const prevLine = lines[j].trim();
      if (prevLine.startsWith('///') || prevLine.startsWith('/**') || prevLine.startsWith('*')) {
        hasNatSpec = true;
        break;
      }
      if (prevLine === '' || prevLine === '}' || prevLine === '{') continue;
      break;
    }

    if (!hasNatSpec) {
      const funcMatch = line.match(/function\s+(\w+)/);
      const funcName = funcMatch ? funcMatch[1] : 'unknown';
      missing.push(`Line ${i + 1}: ${funcName}() missing NatSpec`);
    }
  }

  return missing;
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

  const missing = checkNatSpec(filePath);

  if (missing.length > 0) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `NATSPEC: ${missing.length} public/external function(s) missing documentation:\n\n${missing.join('\n')}\n\nAdd /// @notice, @param, @return for each.`
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
