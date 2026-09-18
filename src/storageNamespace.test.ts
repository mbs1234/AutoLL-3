import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { APP_SLUG } from './appIdentity';
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
  // What this build's slug actually spells is `appIdentity.test.ts`'s
  // question, and the one thing a sibling build is expected to change. The
  // assertions here are the ones that must hold whatever it says, so that this
  // file does not have to differ between builds that are otherwise identical.
  it('builds every key under the slug this build owns', () => {
    expect(APP_SLUG).not.toBe('');
    expect(STORAGE_NAMESPACE).toBe(`${APP_SLUG}.`);
    expect(NOTIFICATION_TAG_NAMESPACE).toBe(`${APP_SLUG}-`);
    expect(storageKey('example')).toBe(`${STORAGE_NAMESPACE}example`);
  });

  it('has no handwritten namespaced key bypassing the helper', () => {
    const root = join(process.cwd(), 'src');
    // Built from the namespaces rather than spelled out, so the guard keeps
    // working in a build whose slug is something else. Every metacharacter is
    // escaped because the namespaces end in `.` and `-`, and an unescaped `.`
    // would match any character and report a file that merely mentions the
    // bare slug.
    //
    // Both namespaces, not just the storage one. Guarding the dotted prefix
    // alone is how six handwritten notification tags sat in
    // AutopilotProvider.tsx bypassing NOTIFICATION_TAG_NAMESPACE without this
    // suite ever objecting. Neither prefix is spelled out anywhere in this
    // file, deliberately -- the guard reads quoted occurrences of them, so
    // writing one in a comment here would report this file as its own
    // offender.
    const escape = (value: string): string =>
      value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const handwritten = new RegExp(
      `['"\`](?:${escape(STORAGE_NAMESPACE)}|${escape(
        NOTIFICATION_TAG_NAMESPACE
      )})`
    );
    const offenders = sourceFiles(root)
      // Test files are included. They are merged between AutoLL-3 and
      // AutoLL-4 exactly as source files are, so a namespace spelled out in a
      // test diverges just as expensively -- and excluding them is how the
      // literals in `alert.test.ts` and `Today.test.tsx` went unnoticed.
      .filter(path => !path.endsWith('storageNamespace.ts'))
      .flatMap(path => {
        const source = readFileSync(path, 'utf8');
        return handwritten.test(source) ? [path.slice(root.length + 1)] : [];
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
