import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { parseTranscript, generateAutoHandoff } from './transcript-parser.js';
import { startTimer, endTimer } from './shared/hook-profiler.js';

interface PreCompactInput {
  trigger: 'manual' | 'auto';
  session_id: string;
  transcript_path: string;
  custom_instructions?: string;
}

interface HookOutput {
  continue?: boolean;
  systemMessage?: string;
}

async function main() {
  const _perfStart = startTimer();
  const input: PreCompactInput = JSON.parse(await readStdin());
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  // Find existing ledger files
  const ledgerDir = path.join(projectDir, 'thoughts', 'ledgers');
  if (!fs.existsSync(ledgerDir)) {
    const output: HookOutput = {
      continue: true,
      systemMessage: '[PreCompact] No ledger directory found.'
    };
    endTimer(_perfStart, 'pre-compact-continuity', 'PreCompact');
    console.log(JSON.stringify(output));
    return;
  }
  const ledgerFiles = fs.readdirSync(ledgerDir)
    .filter(f => f.startsWith('CONTINUITY_CLAUDE-') && f.endsWith('.md'));

  if (ledgerFiles.length === 0) {
    // No ledger - just remind to create one
    const output: HookOutput = {
      continue: true,
      systemMessage: '[PreCompact] No ledger found. Create one? /continuity_ledger'
    };
    endTimer(_perfStart, 'pre-compact-continuity', 'PreCompact');
    console.log(JSON.stringify(output));
    return;
  }

  // Get most recent ledger
  const mostRecent = ledgerFiles.sort((a, b) => {
    const statA = fs.statSync(path.join(ledgerDir, a));
    const statB = fs.statSync(path.join(ledgerDir, b));
    return statB.mtime.getTime() - statA.mtime.getTime();
  })[0];

  const ledgerPath = path.join(ledgerDir, mostRecent);

  if (input.trigger === 'auto') {
    // Auto-compact: Use transcript parser to generate full handoff
    const sessionName = mostRecent.replace('CONTINUITY_CLAUDE-', '').replace('.md', '');
    let handoffFile = '';

    if (input.transcript_path && fs.existsSync(input.transcript_path)) {
      // Parse transcript and generate handoff
      const summary = parseTranscript(input.transcript_path);
      const handoffContent = generateAutoHandoff(summary, sessionName);

      // Ensure handoff directory exists (thoughts/shared/handoffs is tracked in git)
      const handoffDir = path.join(projectDir, 'thoughts', 'shared', 'handoffs', sessionName);
      fs.mkdirSync(handoffDir, { recursive: true });

      // Write handoff with timestamp (YAML format for session-start injection)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      handoffFile = `auto-handoff-${timestamp}.yaml`;
      const handoffPath = path.join(handoffDir, handoffFile);
      fs.writeFileSync(handoffPath, handoffContent);

      // Also append brief summary to ledger for visibility
      const briefSummary = generateAutoSummary(projectDir, input.session_id);
      if (briefSummary) {
        appendToLedger(ledgerPath, briefSummary);
      }
    } else {
      // Fallback: no transcript, use legacy summary
      const briefSummary = generateAutoSummary(projectDir, input.session_id);
      if (briefSummary) {
        appendToLedger(ledgerPath, briefSummary);
      }
    }

    const message = handoffFile
      ? `[PreCompact:auto] Created YAML handoff: thoughts/shared/handoffs/${sessionName}/${handoffFile}`
      : `[PreCompact:auto] Session summary auto-appended to ${mostRecent}`;

    const output: HookOutput = {
      continue: true,
      systemMessage: message
    };
    endTimer(_perfStart, 'pre-compact-continuity', 'PreCompact');
    console.log(JSON.stringify(output));
  } else {
    // Manual compact: warn user (cannot block, just inform)
    const output: HookOutput = {
      continue: true,
      systemMessage: `[PreCompact] Consider updating ledger before compacting: /continuity_ledger\nLedger: ${mostRecent}`
    };
    endTimer(_perfStart, 'pre-compact-continuity', 'PreCompact');
    console.log(JSON.stringify(output));
  }
}

function extractStrategicContext(sessionId: string): string[] {
  const lines: string[] = [];
  const claudeDir = path.join(homedir(), '.claude');

  // 1. Bu session'in hatalari → "Basarisiz yaklasimlar"
  const ledgerPath = path.join(claudeDir, 'canavar', 'error-ledger.jsonl');
  if (fs.existsSync(ledgerPath)) {
    try {
      const allErrors = fs.readFileSync(ledgerPath, 'utf-8').split('\n').filter(l => l.trim());
      const sessionErrors = allErrors
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(e => e && e.session === sessionId?.slice(0, 8));

      if (sessionErrors.length > 0) {
        const patterns = [...new Set(sessionErrors.map((e: any) => e.error_pattern))];
        lines.push(`- Basarisiz yaklasimlar: ${patterns.slice(0, 5).join(', ')}`);
      }
    } catch { /* skip */ }
  }

  // 2. current-intent.json → "Kullanici hedefi"
  const intentPath = path.join(claudeDir, 'cache', 'current-intent.json');
  if (fs.existsSync(intentPath)) {
    try {
      const intent = JSON.parse(fs.readFileSync(intentPath, 'utf-8'));
      if (intent.task_type && intent.task_type !== 'conversational') {
        lines.push(`- Kullanici hedefi: ${intent.task_type} (domain: ${intent.domain?.join(', ') || 'genel'})`);
      }
    } catch { /* skip */ }
  }

  // 3. Instinct'ler → "Gozlemlenen pattern'lar"
  const maturePath = path.join(claudeDir, 'mature-instincts.json');
  if (fs.existsSync(maturePath)) {
    try {
      const instincts = JSON.parse(fs.readFileSync(maturePath, 'utf-8'));
      const recent = instincts
        .filter((i: any) => i.confidence >= 5)
        .slice(0, 3)
        .map((i: any) => `${i.pattern}(${i.confidence}x)`);
      if (recent.length > 0) {
        lines.push(`- Gozlemlenen pattern'lar: ${recent.join(', ')}`);
      }
    } catch { /* skip */ }
  }

  return lines;
}

function generateAutoSummary(projectDir: string, sessionId: string): string | null {
  const timestamp = new Date().toISOString();
  const lines: string[] = [];

  // Read edited files from PostToolUse cache
  const cacheDir = path.join(projectDir, '.claude', 'tsc-cache', sessionId || 'default');
  const editedFilesPath = path.join(cacheDir, 'edited-files.log');

  let editedFiles: string[] = [];
  if (fs.existsSync(editedFilesPath)) {
    const content = fs.readFileSync(editedFilesPath, 'utf-8');
    // Format: timestamp:filepath:repo per line
    editedFiles = [...new Set(
      content.split('\n')
        .filter(line => line.trim())
        .map(line => {
          const parts = line.split(':');
          // filepath is second part, remove project dir prefix
          return parts[1]?.replace(projectDir + '/', '') || '';
        })
        .filter(f => f)
    )];
  }

  // Read build attempts from .git/claude
  const gitClaudeDir = path.join(projectDir, '.git', 'claude', 'branches');
  let buildAttempts = { passed: 0, failed: 0 };

  if (fs.existsSync(gitClaudeDir)) {
    try {
      const branches = fs.readdirSync(gitClaudeDir);
      for (const branch of branches) {
        const attemptsFile = path.join(gitClaudeDir, branch, 'attempts.jsonl');
        if (fs.existsSync(attemptsFile)) {
          const content = fs.readFileSync(attemptsFile, 'utf-8');
          content.split('\n').filter(l => l.trim()).forEach(line => {
            try {
              const attempt = JSON.parse(line);
              if (attempt.type === 'build_pass') buildAttempts.passed++;
              if (attempt.type === 'build_fail') buildAttempts.failed++;
            } catch {}
          });
        }
      }
    } catch {}
  }

  // Stratejik context ekle
  const strategicLines = extractStrategicContext(sessionId);

  // Only generate summary if we have something to report
  if (editedFiles.length === 0 && buildAttempts.passed === 0 && buildAttempts.failed === 0 && strategicLines.length === 0) {
    return null;
  }

  lines.push(`\n## Session Auto-Summary (${timestamp})`);

  if (editedFiles.length > 0) {
    lines.push(`- Files changed: ${editedFiles.slice(0, 10).join(', ')}${editedFiles.length > 10 ? ` (+${editedFiles.length - 10} more)` : ''}`);
  }

  if (buildAttempts.passed > 0 || buildAttempts.failed > 0) {
    lines.push(`- Build/test: ${buildAttempts.passed} passed, ${buildAttempts.failed} failed`);
  }

  if (strategicLines.length > 0) {
    lines.push('- Stratejik context:');
    for (const sl of strategicLines) {
      lines.push(`  ${sl}`);
    }
  }

  return lines.join('\n');
}

function appendToLedger(ledgerPath: string, summary: string): void {
  try {
    let content = fs.readFileSync(ledgerPath, 'utf-8');

    // Find the "## State" section and append after "Done:" items
    const stateMatch = content.match(/## State\n/);
    if (stateMatch) {
      // Find end of Done section (before "- Now:" or "- Next:")
      const nowMatch = content.match(/(\n-\s*Now:)/);
      if (nowMatch && nowMatch.index) {
        // Insert summary before "Now:"
        content = content.slice(0, nowMatch.index) + summary + content.slice(nowMatch.index);
      } else {
        // Just append to end of State section
        const nextSection = content.indexOf('\n## ', content.indexOf('## State') + 1);
        if (nextSection > 0) {
          content = content.slice(0, nextSection) + summary + '\n' + content.slice(nextSection);
        } else {
          content += summary;
        }
      }
    } else {
      // No State section, append to end
      content += summary;
    }

    fs.writeFileSync(ledgerPath, content);
  } catch (err) {
    // Silently fail - don't break compact
  }
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

main().catch(console.error);
