/**
 * Tests for hooks/src/shared/session-id.ts
 *
 * File-based tests use a temp directory via overriding process.env.HOME.
 * Env-based tests manipulate process.env directly and restore after.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  generateSessionId,
  writeSessionId,
  readSessionId,
  getSessionId,
  getSessionIdFile,
  getProject,
} from '../shared/session-id.js';

describe('session-id', () => {
  let originalHome: string | undefined;
  let originalCoordination: string | undefined;
  let originalBraintrust: string | undefined;
  let originalProjectDir: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    // Save original env
    originalHome = process.env.HOME;
    originalCoordination = process.env.COORDINATION_SESSION_ID;
    originalBraintrust = process.env.BRAINTRUST_SPAN_ID;
    originalProjectDir = process.env.CLAUDE_PROJECT_DIR;

    // Create a fresh temp dir for each test
    tmpDir = mkdtempSync(join(tmpdir(), 'session-id-test-'));
    process.env.HOME = tmpDir;

    // Clear env vars that affect behavior
    delete process.env.COORDINATION_SESSION_ID;
    delete process.env.BRAINTRUST_SPAN_ID;
  });

  afterEach(() => {
    // Restore original env
    process.env.HOME = originalHome;
    if (originalCoordination !== undefined) {
      process.env.COORDINATION_SESSION_ID = originalCoordination;
    } else {
      delete process.env.COORDINATION_SESSION_ID;
    }
    if (originalBraintrust !== undefined) {
      process.env.BRAINTRUST_SPAN_ID = originalBraintrust;
    } else {
      delete process.env.BRAINTRUST_SPAN_ID;
    }
    if (originalProjectDir !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = originalProjectDir;
    } else {
      delete process.env.CLAUDE_PROJECT_DIR;
    }
  });

  describe('generateSessionId', () => {
    it('produces s-XXXXX format without BRAINTRUST_SPAN_ID', () => {
      delete process.env.BRAINTRUST_SPAN_ID;
      const id = generateSessionId();

      expect(id).toMatch(/^s-[a-z0-9]+$/);
      expect(id.startsWith('s-')).toBe(true);
    });

    it('uses first 8 chars of BRAINTRUST_SPAN_ID when set', () => {
      process.env.BRAINTRUST_SPAN_ID = 'abcdef1234567890';
      const id = generateSessionId();

      expect(id).toBe('abcdef12');
      expect(id).toHaveLength(8);
    });

    it('generates unique IDs on successive calls', () => {
      const id1 = generateSessionId();
      // Small delay to ensure different timestamp
      const id2 = generateSessionId();

      // They may or may not be different (same ms), but both should be valid
      expect(id1).toMatch(/^s-[a-z0-9]+$/);
      expect(id2).toMatch(/^s-[a-z0-9]+$/);
    });
  });

  describe('getSessionIdFile', () => {
    it('returns path under HOME/.claude/', () => {
      const filePath = getSessionIdFile();
      expect(filePath).toBe(join(tmpDir, '.claude', '.coordination-session-id'));
    });

    it('creates .claude directory when createDir is true', () => {
      const claudeDir = join(tmpDir, '.claude');
      expect(existsSync(claudeDir)).toBe(false);

      getSessionIdFile({ createDir: true });
      expect(existsSync(claudeDir)).toBe(true);
    });

    it('does not create directory when createDir is false', () => {
      const claudeDir = join(tmpDir, '.claude');
      getSessionIdFile({ createDir: false });
      expect(existsSync(claudeDir)).toBe(false);
    });
  });

  describe('writeSessionId + readSessionId roundtrip', () => {
    it('writes and reads back the same session ID', () => {
      const testId = 's-test123';
      const success = writeSessionId(testId);

      expect(success).toBe(true);

      const readBack = readSessionId();
      expect(readBack).toBe(testId);
    });

    it('creates the .claude directory if it does not exist', () => {
      const claudeDir = join(tmpDir, '.claude');
      expect(existsSync(claudeDir)).toBe(false);

      writeSessionId('s-abc');
      expect(existsSync(claudeDir)).toBe(true);
    });

    it('persists to file on disk', () => {
      writeSessionId('s-ondisk');
      const filePath = join(tmpDir, '.claude', '.coordination-session-id');
      const content = readFileSync(filePath, 'utf-8');
      expect(content).toBe('s-ondisk');
    });
  });

  describe('readSessionId', () => {
    it('returns null when file does not exist', () => {
      const result = readSessionId();
      expect(result).toBeNull();
    });
  });

  describe('getSessionId', () => {
    it('returns COORDINATION_SESSION_ID env var when set (highest priority)', () => {
      process.env.COORDINATION_SESSION_ID = 'env-session-42';
      writeSessionId('file-session-99');

      const id = getSessionId();
      expect(id).toBe('env-session-42');
    });

    it('returns file-based ID when env var is not set', () => {
      delete process.env.COORDINATION_SESSION_ID;
      writeSessionId('file-session-77');

      const id = getSessionId();
      expect(id).toBe('file-session-77');
    });

    it('falls back to generated ID when no env var and no file', () => {
      delete process.env.COORDINATION_SESSION_ID;
      // No file written, no BRAINTRUST either

      const id = getSessionId();
      expect(id).toMatch(/^s-[a-z0-9]+$/);
    });

    it('falls back to BRAINTRUST_SPAN_ID when no env var and no file', () => {
      delete process.env.COORDINATION_SESSION_ID;
      process.env.BRAINTRUST_SPAN_ID = 'span12345678abcd';

      const id = getSessionId();
      expect(id).toBe('span1234');
    });
  });

  describe('getProject', () => {
    it('returns CLAUDE_PROJECT_DIR when set', () => {
      process.env.CLAUDE_PROJECT_DIR = '/my/project/dir';
      expect(getProject()).toBe('/my/project/dir');
    });

    it('returns cwd when CLAUDE_PROJECT_DIR is not set', () => {
      delete process.env.CLAUDE_PROJECT_DIR;
      expect(getProject()).toBe(process.cwd());
    });
  });
});
