import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(dir, '../../static/caps/commerce/commerce.js'), 'utf8');

function load(location = { href: 'https://example.com/note.html', pathname: '/note.html', search: '' }) {
  const document = {
    readyState: 'complete',
    documentElement: { lang: 'en-US' },
    getElementById: () => null,
    addEventListener: () => {},
  };
  const ctx = createContext({
    document,
    window: {},
    globalThis: {},
    location,
    navigator: { language: 'en-US' },
    console,
    setTimeout,
    URL,
    URLSearchParams,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  runInContext(src, ctx);
  return ctx.mdfCommerce;
}

describe('commerce.js helpers', () => {
  const api = load();

  it('formats money and access keys', () => {
    assert.equal(api.formatAccessKey('K7QM2XPA9RTD4HNBY'), 'K7QM-2XPA-9RTD-4HNB-Y');
    assert.match(api.formatMoney(19900, 'USD', 'en-US'), /\$199\.00/);
  });

  it('validates email and claim query (does not drop the raw search)', () => {
    assert.equal(api.isValidEmail('reader@example.com'), true);
    assert.equal(api.isValidEmail('nope'), false);
    const parsed = api.parseClaimQuery('?ci=ci_1&t=tok&order_id=ord_1');
    assert.equal(parsed.intentId, 'ci_1');
    assert.equal(parsed.token, 'tok');
  });

  it('fills privacy placeholders', () => {
    assert.equal(
      api.fillTemplate('Contact {contactEmail}', { contactEmail: 'hi@example.com' }),
      'Contact hi@example.com',
    );
  });

  it('maps /purchase/ to a Foundry leaf href, keeping the share prefix', () => {
    const share = load({
      href: 'https://share.fsky.top/s/abc123/secret.html',
      pathname: '/s/abc123/secret.html',
      search: '',
    });
    assert.equal(share.commercePageHref('/privacy/', 'privacy.html'), '/s/abc123/privacy.html');
    assert.equal(share.commercePageHref('/purchase/', 'purchase.html'), '/s/abc123/purchase.html');
    const custom = load({
      href: 'https://garden.example.com/note.html',
      pathname: '/note.html',
      search: '',
    });
    assert.equal(custom.commercePageHref('/privacy/', 'privacy.html'), '/privacy.html');
  });
});
