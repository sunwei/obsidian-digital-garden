import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, '../../static/access.js'), 'utf8');

function loadAccess(hosting) {
  const store = new Map();
  const sessionStore = new Map();
  const memory = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    sessionStorage: {
      getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: (k) => sessionStore.delete(k),
    },
  };
  const el = {
    id: 'mdf-encrypt-content',
    getAttribute: (k) =>
      ({
        'data-format': '2',
        'data-project': 'p_' + 'a'.repeat(32),
        'data-hosting': hosting,
        'data-resource': 'r1',
        'data-key': 'k1',
        'data-encrypted': '',
        'data-api': 'https://api.example',
      })[k] || null,
  };
  const ids = {
    'mdf-encrypt-content': el,
    'mdf-access-card': { hidden: true },
    'mdf-access-status': { textContent: '', hidden: true, classList: { toggle() {} } },
    'mdf-access-unlock-card': { classList: { toggle() {} } },
    'mdf-access-key-input': { value: '', addEventListener() {}, classList: { toggle() {} }, focus() {} },
    'mdf-access-unlock-btn': { addEventListener() {} },
    'mdf-access-signout': { addEventListener() {} },
    'mdf-access-another': { hidden: true, addEventListener() {} },
  };
  const document = {
    readyState: 'complete',
    getElementById: (id) => ids[id] || null,
    addEventListener() {},
    body: { classList: { add() {}, remove() {} } },
    dispatchEvent() {},
  };
  const ctx = createContext({
    document,
    localStorage: memory.localStorage,
    sessionStorage: memory.sessionStorage,
    location: { hash: '', pathname: '/p', search: '', href: 'https://share.example/s/abc/p/' },
    history: { replaceState() {} },
    console,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    fetch: async () => ({ ok: false }),
    CustomEvent: class CustomEvent { constructor(n) { this.type = n; } },
    Event,
  });
  runInContext(src, ctx);
  return { store, sessionStore, ctx };
}

describe('access.js share hosting storage', () => {
  it('defines share-aware helpers without throwing at boot when metadata is incomplete', () => {
    const share = loadAccess('share');
    const custom = loadAccess('custom');
    assert.ok(share.store);
    assert.ok(custom.store);
  });
});
