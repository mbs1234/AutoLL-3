import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { STORAGE_NAMESPACE, storageKey } from './storageNamespace';

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
  });

  it('has no production key bypassing the namespace helper', () => {
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
});
