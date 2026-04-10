/**
 * Session Analytics - Stop hook
 * Session sonunda agent-events, hook-perf ve error-ledger verilerini
 * birlestirerek session ozeti uretir.
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface EventLog {
  ts: string;
  session: string;
  event: string;
  tool: string;
  agent_id?: string;
  agent_type?: string;
  detail: string;
}

interface PerfEntry {
  ts: string;
  hook: string;
  event: string;
  duration_ms: number;
  session: string;
}

interface ErrorEntry {
  ts: string;
  session: string;
  agent_id: string;
  agent_type: string;
  error_type: string;
  error_pattern: string;
  detail: string;
  file: string;
  lesson: string;
}

interface SessionAnalytics {
  ts: string;
  session_id: string;
  duration_ms: number;
  tool_counts: Record<string, number>;
  agent_spawns: number;
  errors: number;
  hook_total_ms: number;
  hook_slowest: { name: string; ms: number } | null;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim());
  const results: T[] = [];
  for (const line of lines) {
    try { results.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return results;
}

function main() {
  // stdin oku (Stop hook formati)
  let raw = '';
  try { raw = readFileSync(0, 'utf-8'); } catch { /* ok */ }

  let sessionId = 'unknown';
  if (raw) {
    try {
      const input = JSON.parse(raw);
      sessionId = input.session_id?.slice(0, 8) || 'unknown';
    } catch { /* ok */ }
  }

  const claudeDir = join(homedir(), '.claude');
  const cacheDir = join(claudeDir, 'cache');
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

  const eventsPath = join(claudeDir, 'agent-events.jsonl');
  const perfPath = join(cacheDir, 'hook-perf.jsonl');
  const ledgerPath = join(claudeDir, 'canavar', 'error-ledger.jsonl');
  const outputPath = join(cacheDir, 'session-analytics.jsonl');

  // Bu session'in verilerini topla
  const allEvents = readJsonl<EventLog>(eventsPath);
  const sessionEvents = allEvents.filter(e => e.session === sessionId);

  const allPerf = readJsonl<PerfEntry>(perfPath);
  const sessionPerf = allPerf.filter(p => p.session === sessionId);

  const allErrors = readJsonl<ErrorEntry>(ledgerPath);
  const sessionErrors = allErrors.filter(e => e.session === sessionId);

  // Tool kullanim sayilari
  const toolCounts: Record<string, number> = {};
  for (const evt of sessionEvents) {
    if (evt.tool) {
      toolCounts[evt.tool] = (toolCounts[evt.tool] || 0) + 1;
    }
  }

  // Agent spawn sayisi
  const agentSpawns = sessionEvents.filter(e => e.event === 'agent_spawn' || e.tool === 'Agent').length;

  // Hook performance
  let hookTotalMs = 0;
  let hookSlowest: { name: string; ms: number } | null = null;
  for (const p of sessionPerf) {
    hookTotalMs += p.duration_ms;
    if (!hookSlowest || p.duration_ms > hookSlowest.ms) {
      hookSlowest = { name: p.hook, ms: p.duration_ms };
    }
  }

  // Session suresi (ilk ve son event arasi)
  let durationMs = 0;
  if (sessionEvents.length > 0) {
    const timestamps = sessionEvents.map(e => new Date(e.ts).getTime()).filter(t => !isNaN(t));
    if (timestamps.length >= 2) {
      durationMs = Math.max(...timestamps) - Math.min(...timestamps);
    }
  }

  const analytics: SessionAnalytics = {
    ts: new Date().toISOString(),
    session_id: sessionId,
    duration_ms: durationMs,
    tool_counts: toolCounts,
    agent_spawns: agentSpawns,
    errors: sessionErrors.length,
    hook_total_ms: Math.round(hookTotalMs * 100) / 100,
    hook_slowest: hookSlowest ? { name: hookSlowest.name, ms: Math.round(hookSlowest.ms * 100) / 100 } : null,
  };

  // Analytics'i yaz
  try {
    appendFileSync(outputPath, JSON.stringify(analytics) + '\n');
  } catch { /* skip */ }

  console.log(JSON.stringify({
    result: `Analytics: ${Object.values(toolCounts).reduce((a, b) => a + b, 0)} tool calls, ${agentSpawns} agents, ${sessionErrors.length} errors, ${Math.round(hookTotalMs)}ms hook overhead`,
  }));
}

main();
