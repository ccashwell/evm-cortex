/**
 * Project Identity - Proje bazli tanimlama
 *
 * Git root path'inden MD5 hash uretir, proje ismini tespit eder.
 * Cross-project learning icin her projeye benzersiz kimlik verir.
 *
 * Cache: per-process. Claude Code her hook icin yeni process olusturur,
 * bu yuzden module-level cache guvenlidir. Daemon veya test icin resetProjectCache() kullan.
 */
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, basename, resolve } from 'path';

export interface ProjectIdentity {
  hash: string;   // MD5 ilk 12 char
  name: string;   // okunabilir proje ismi
  path: string;   // absolute path
}

let cachedIdentity: ProjectIdentity | null = null;

/**
 * Mevcut projenin kimligini dondurur.
 * Sonuc cache'lenir (ayni process icinde).
 */
export function getProjectIdentity(): ProjectIdentity | null {
  if (cachedIdentity) return cachedIdentity;

  const projectPath = getGitRoot();
  if (!projectPath) return null;

  const hash = createHash('md5').update(projectPath).digest('hex').slice(0, 12);
  const name = detectProjectName(projectPath);

  cachedIdentity = { hash, name, path: projectPath };
  return cachedIdentity;
}

/** Cache temizle - testler ve daemon mode icin. */
export function resetProjectCache(): void {
  cachedIdentity = null;
}

/**
 * Git root dizinini bulur.
 * CLAUDE_PROJECT_DIR varsa oncelikli kullanir (execSync'den hizli).
 */
function getGitRoot(): string | null {
  // Fast path: Claude Code bunu set eder
  if (process.env.CLAUDE_PROJECT_DIR) {
    return resolve(process.env.CLAUDE_PROJECT_DIR);
  }

  try {
    const root = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      timeout: 500,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

/**
 * Proje ismini tespit eder.
 * Oncelik: package.json name > go.mod module > pyproject.toml [project].name > Cargo.toml [package].name > dirname
 */
function detectProjectName(projectPath: string): string {
  // package.json
  const pkgPath = join(projectPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.name && typeof pkg.name === 'string') return pkg.name;
    } catch { /* skip */ }
  }

  // go.mod
  const goModPath = join(projectPath, 'go.mod');
  if (existsSync(goModPath)) {
    try {
      const content = readFileSync(goModPath, 'utf-8');
      const match = /^module\s+(\S+)/m.exec(content);
      if (match) {
        const parts = match[1].trim().split('/');
        return parts[parts.length - 1];
      }
    } catch { /* skip */ }
  }

  // pyproject.toml - [project] section'dan name al
  const pyPath = join(projectPath, 'pyproject.toml');
  if (existsSync(pyPath)) {
    try {
      const content = readFileSync(pyPath, 'utf-8');
      const section = content.match(/\[project\]\s*\n([\s\S]*?)(?:\n\[|$)/);
      if (section) {
        const nameMatch = /^name\s*=\s*"(.+?)"/m.exec(section[1]);
        if (nameMatch) return nameMatch[1];
      }
    } catch { /* skip */ }
  }

  // Cargo.toml - [package] section'dan name al
  const cargoPath = join(projectPath, 'Cargo.toml');
  if (existsSync(cargoPath)) {
    try {
      const content = readFileSync(cargoPath, 'utf-8');
      const section = content.match(/\[package\]\s*\n([\s\S]*?)(?:\n\[|$)/);
      if (section) {
        const nameMatch = /^name\s*=\s*"(.+?)"/m.exec(section[1]);
        if (nameMatch) return nameMatch[1];
      }
    } catch { /* skip */ }
  }

  // Fallback: dizin ismi
  return basename(projectPath);
}
