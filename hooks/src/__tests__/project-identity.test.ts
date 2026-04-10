/**
 * Tests for hooks/src/shared/project-identity.ts
 *
 * Creates temp directories with various config files (package.json, go.mod, etc.)
 * to test detectProjectName. Uses CLAUDE_PROJECT_DIR env var to skip git detection.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { tmpdir } from 'os';
import { createHash } from 'crypto';

import {
  getProjectIdentity,
  resetProjectCache,
  type ProjectIdentity,
} from '../shared/project-identity.js';

describe('project-identity', () => {
  let originalProjectDir: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    originalProjectDir = process.env.CLAUDE_PROJECT_DIR;
    // Each test gets a fresh temp directory
    tmpDir = mkdtempSync(join(tmpdir(), 'proj-identity-test-'));
    resetProjectCache();
  });

  afterEach(() => {
    if (originalProjectDir !== undefined) {
      process.env.CLAUDE_PROJECT_DIR = originalProjectDir;
    } else {
      delete process.env.CLAUDE_PROJECT_DIR;
    }
    resetProjectCache();
  });

  describe('getProjectIdentity with CLAUDE_PROJECT_DIR', () => {
    it('returns identity using CLAUDE_PROJECT_DIR path', () => {
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity).not.toBeNull();
      expect(identity!.path).toBe(tmpDir);
    });

    it('produces MD5 hash of first 12 hex chars', () => {
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      const expectedHash = createHash('md5').update(tmpDir).digest('hex').slice(0, 12);

      expect(identity).not.toBeNull();
      expect(identity!.hash).toBe(expectedHash);
      expect(identity!.hash).toHaveLength(12);
      expect(identity!.hash).toMatch(/^[0-9a-f]{12}$/);
    });
  });

  describe('resetProjectCache', () => {
    it('clears cache so next call re-detects', () => {
      // First identity with tmpDir
      const dir1 = mkdtempSync(join(tmpdir(), 'proj-cache-1-'));
      process.env.CLAUDE_PROJECT_DIR = dir1;
      const identity1 = getProjectIdentity();

      // Reset cache and change project dir
      resetProjectCache();
      const dir2 = mkdtempSync(join(tmpdir(), 'proj-cache-2-'));
      process.env.CLAUDE_PROJECT_DIR = dir2;
      const identity2 = getProjectIdentity();

      expect(identity1!.path).toBe(dir1);
      expect(identity2!.path).toBe(dir2);
      expect(identity1!.hash).not.toBe(identity2!.hash);
    });

    it('without reset, cached identity is returned even if env changes', () => {
      const dir1 = mkdtempSync(join(tmpdir(), 'proj-noclear-1-'));
      process.env.CLAUDE_PROJECT_DIR = dir1;
      const identity1 = getProjectIdentity();

      // Change dir WITHOUT resetting cache
      const dir2 = mkdtempSync(join(tmpdir(), 'proj-noclear-2-'));
      process.env.CLAUDE_PROJECT_DIR = dir2;
      const identity2 = getProjectIdentity();

      // Should still return cached (dir1) identity
      expect(identity2!.path).toBe(dir1);
    });
  });

  describe('detectProjectName via package.json', () => {
    it('reads name from package.json', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'my-cool-project', version: '1.0.0' }),
      );
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('my-cool-project');
    });

    it('handles scoped package names', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ name: '@scope/pkg-name' }),
      );
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('@scope/pkg-name');
    });
  });

  describe('detectProjectName via go.mod', () => {
    it('extracts last segment of module path', () => {
      writeFileSync(
        join(tmpDir, 'go.mod'),
        'module github.com/user/my-go-repo\n\ngo 1.21\n',
      );
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('my-go-repo');
    });

    it('handles single-segment module names', () => {
      writeFileSync(join(tmpDir, 'go.mod'), 'module mymodule\n\ngo 1.21\n');
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('mymodule');
    });
  });

  describe('detectProjectName via pyproject.toml', () => {
    it('reads name from [project] section', () => {
      const content = [
        '[build-system]',
        'requires = ["setuptools"]',
        '',
        '[project]',
        'name = "my-py-project"',
        'version = "0.1.0"',
      ].join('\n');
      writeFileSync(join(tmpDir, 'pyproject.toml'), content);
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('my-py-project');
    });
  });

  describe('detectProjectName via Cargo.toml', () => {
    it('reads name from [package] section', () => {
      const content = [
        '[package]',
        'name = "my-rust-crate"',
        'version = "0.1.0"',
        'edition = "2021"',
      ].join('\n');
      writeFileSync(join(tmpDir, 'Cargo.toml'), content);
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('my-rust-crate');
    });
  });

  describe('detectProjectName fallback', () => {
    it('uses directory basename when no config files exist', () => {
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe(basename(tmpDir));
    });
  });

  describe('detectProjectName priority', () => {
    it('prefers package.json over go.mod', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'from-package-json' }),
      );
      writeFileSync(join(tmpDir, 'go.mod'), 'module github.com/user/from-go-mod\n');
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('from-package-json');
    });

    it('prefers go.mod over pyproject.toml when no package.json', () => {
      writeFileSync(join(tmpDir, 'go.mod'), 'module github.com/user/from-go-mod\n');
      const pyContent = '[project]\nname = "from-pyproject"\n';
      writeFileSync(join(tmpDir, 'pyproject.toml'), pyContent);
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      expect(identity!.name).toBe('from-go-mod');
    });
  });

  describe('edge cases', () => {
    it('handles corrupt package.json gracefully', () => {
      writeFileSync(join(tmpDir, 'package.json'), '{not valid json!!!');
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      // Falls through to directory basename since JSON parse fails
      expect(identity!.name).toBe(basename(tmpDir));
    });

    it('handles package.json without name field', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ version: '1.0.0', description: 'no name' }),
      );
      process.env.CLAUDE_PROJECT_DIR = tmpDir;

      const identity = getProjectIdentity();
      // Falls through to directory basename
      expect(identity!.name).toBe(basename(tmpDir));
    });
  });
});
