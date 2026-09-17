import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  NOTIFICATION_TAG_NAMESPACE,
  STORAGE_NAMESPACE,
  storageKey,
} from './storageNamespace';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the shared-origin storage namespace', () => {
  it('builds every key under AutoLL-3', () => {
    expect(storageKey('example')).toBe('autoll3.example');
    expect(STORAGE_NAMESPACE).toBe('autoll3.');
    expect(NOTIFICATION_TAG_NAMESPACE).toBe('autoll3-');
  });

  it('has no handwritten namespaced key bypassing the helper', () => {
    const root = join(process.cwd(), 'src');
    const offenders = sourceFiles(root)
      .filter(path => !path.endsWith('storageNamespace.ts'))
      .filter(path => !path.includes('.test.'))
      .flatMap(path => {
        const source = readFileSync(path, 'utf8');
        return /['"`]autoll3\./.test(source)
          ? [path.slice(root.length + 1)]
          : [];
      });
    expect(offenders).toEqual([]);
  });

  it('keeps direct storage access behind the typed storage boundary', () => {
    const root = join(process.cwd(), 'src');
    // Login removes Disney's own guest-session key; it is deliberately not an
    // AutoLL value and therefore cannot go through the namespaced kvdb API.
    const allowed = new Set(['kvdb.ts', 'components/LoginForm.tsx']);
    const offenders = sourceFiles(root)
      .filter(path => !path.includes('.test.'))
      .flatMap(path => {
        const relative = path.slice(root.length + 1);
        if (allowed.has(relative)) return [];
        const source = readFileSync(path, 'utf8');
        return /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)/.test(
          source
        )
          ? [relative]
          : [];
      });
    expect(offenders).toEqual([]);
  });
});
