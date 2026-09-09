import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { generateJWT, resolveAppId, resolveInstallationId } from '../get-bot-token.mjs';

test('resolveAppId: preserves upstream defaults and validates a repository-owned app ID', () => {
  assert.equal(resolveAppId(''), '3718661');
  assert.equal(resolveAppId(' 12345 '), '12345');
  for (const value of ['0', '-1', '1.5', 'app-name', '1e5', '123\n456']) {
    assert.throws(() => resolveAppId(value), /positive numeric GitHub App ID/);
  }
});

test('generateJWT: signs the configured app identity with the supplied key and a short expiry', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = generateJWT(privateKey, '12345');
  const [header, body, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(payload.iss, '12345');
  assert.equal(payload.exp - payload.iat, 70);
  assert.ok(verify('RSA-SHA256', Buffer.from(`${header}.${body}`), publicKey, Buffer.from(signature, 'base64url')));
  assert.throws(() => generateJWT(privateKey, 'not-an-id'), /positive numeric GitHub App ID/);
});

test('resolveInstallationId: uses the repo installation endpoint when repo context is available', async () => {
  const seenPaths = [];
  const installationId = await resolveInstallationId(async (path) => {
    seenPaths.push(path);
    return { id: 42 };
  }, 'jwt', 'paperclipai/paperclip', 'paperclipai');

  assert.equal(installationId, 42);
  assert.deepEqual(seenPaths, ['/repos/paperclipai/paperclip/installation']);
});

test('resolveInstallationId: falls back to the matching owner installation', async () => {
  const installationId = await resolveInstallationId(async () => ([
    { id: 1, account: { login: 'someone-else' } },
    { id: 7, account: { login: 'PaperclipAI' } },
  ]), 'jwt', undefined, 'paperclipai');

  assert.equal(installationId, 7);
});

test('resolveInstallationId: rejects ambiguous installations without repo or owner context', async () => {
  await assert.rejects(
    resolveInstallationId(async () => ([
      { id: 1, account: { login: 'org-one' } },
      { id: 2, account: { login: 'org-two' } },
    ]), 'jwt'),
    /Multiple commitperclip installations found/
  );
});
