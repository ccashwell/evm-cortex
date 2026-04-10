/**
 * Tests for hooks/src/shared/plugin-check.ts
 *
 * The module hardcodes CONFIG_FILE using os.homedir() and has a module-level
 * cache (cachedConfig). We use vi.resetModules() + dynamic import to get a
 * fresh module for each test, and vi.mock('fs') at the top level with
 * vi.mocked() to control the mock per test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('plugin-check', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  async function freshModule() {
    // Dynamic import after resetModules gives us a fresh cachedConfig
    return await import('../shared/plugin-check.js');
  }

  describe('isHookEnabled', () => {
    it('returns true when config file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      const { isHookEnabled } = await freshModule();
      expect(isHookEnabled('any-hook')).toBe(true);
    });

    it('returns false when hook is explicitly disabled', async () => {
      const config = { hooks: { 'my-hook': { enabled: false } }, skills: {} };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const { isHookEnabled } = await freshModule();
      expect(isHookEnabled('my-hook')).toBe(false);
    });

    it('returns true when hook is not in config', async () => {
      const config = { hooks: { 'other-hook': { enabled: false } }, skills: {} };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const { isHookEnabled } = await freshModule();
      expect(isHookEnabled('nonexistent-hook')).toBe(true);
    });

    it('returns true when hook entry has enabled: true', async () => {
      const config = { hooks: { 'my-hook': { enabled: true } }, skills: {} };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const { isHookEnabled } = await freshModule();
      expect(isHookEnabled('my-hook')).toBe(true);
    });

    it('returns true when config JSON is corrupt', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{invalid json!!!');

      const { isHookEnabled } = await freshModule();
      expect(isHookEnabled('my-hook')).toBe(true);
    });
  });

  describe('isSkillEnabled', () => {
    it('returns false when skill is explicitly disabled', async () => {
      const config = { hooks: {}, skills: { 'my-skill': { enabled: false } } };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const { isSkillEnabled } = await freshModule();
      expect(isSkillEnabled('my-skill')).toBe(false);
    });

    it('returns true when skill is not in config', async () => {
      const config = { hooks: {}, skills: {} };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const { isSkillEnabled } = await freshModule();
      expect(isSkillEnabled('unknown-skill')).toBe(true);
    });

    it('returns true when config file is missing (default)', async () => {
      mockExistsSync.mockReturnValue(false);

      const { isSkillEnabled } = await freshModule();
      expect(isSkillEnabled('any-skill')).toBe(true);
    });
  });

  describe('caching behavior', () => {
    it('reads config file only once, subsequent calls use cache', async () => {
      const config = { hooks: { h1: { enabled: false } }, skills: {} };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(config));

      const { isHookEnabled } = await freshModule();

      isHookEnabled('h1');
      isHookEnabled('h1');
      isHookEnabled('h1');

      // existsSync and readFileSync called only once (first loadConfig)
      expect(mockExistsSync).toHaveBeenCalledTimes(1);
      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
