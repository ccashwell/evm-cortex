/**
 * Statusline utilities - format helpers for terminal HUD.
 *
 * Writes session state to ~/.claude/statusline.json
 * for consumption by Claude Code's native statusLine config.
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATUSLINE_PATH = join(homedir(), '.claude', 'statusline.json');

export interface StatuslineData {
  session: string;
  profile: string;
  agents: {
    running: number;
    completed: number;
    errors: number;
  };
  tools: number;
  duration: string;
  lastAgent: string;
  intent: string;
  updated: string;
}

export function readStatusline(): StatuslineData {
  try {
    if (existsSync(STATUSLINE_PATH)) {
      return JSON.parse(readFileSync(STATUSLINE_PATH, 'utf-8'));
    }
  } catch { /* corrupt or missing */ }
  return {
    session: '',
    profile: 'all',
    agents: { running: 0, completed: 0, errors: 0 },
    tools: 0,
    duration: '0s',
    lastAgent: '',
    intent: '',
    updated: new Date().toISOString(),
  };
}

export function writeStatusline(data: StatuslineData): void {
  try {
    writeFileSync(STATUSLINE_PATH, JSON.stringify(data), { encoding: 'utf-8' });
  } catch { /* ignore write errors */ }
}

export function formatDuration(startMs: number): string {
  const elapsed = Math.floor((Date.now() - startMs) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  return `${Math.floor(elapsed / 3600)}h${Math.floor((elapsed % 3600) / 60)}m`;
}
