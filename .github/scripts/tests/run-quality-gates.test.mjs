import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findExistingComment } from '../run-quality-gates.mjs';

test('findExistingComment: only updates comments from the configured review app', async () => {
  const comments = [
    { id: 0, user: { login: 'repository-review', type: 'User' }, body: '— commitperclip' },
    { id: 1, user: { login: 'unrelated[bot]' }, body: '— commitperclip' },
    { id: 2, user: { login: 'commitperclip[bot]' }, body: '— commitperclip' },
    { id: 3, user: { login: 'repository-review[bot]' }, body: '— commitperclip' },
  ];
  for (const login of ['repository-review', 'repository-review[bot]']) {
    const comment = await findExistingComment(async () => comments, 'token', 'owner/repo', 3, login);
    assert.equal(comment.id, 3);
  }
});

test('findExistingComment: rejects an invalid bot login before using the API', async () => {
  await assert.rejects(findExistingComment(async () => {
    assert.fail('must validate before making a request');
  }, 'token', 'owner/repo', 3, 'invalid/login'), /GitHub App bot login/);
});

test('findExistingComment: paginates until it finds the commitperclip comment', async () => {
  const seenPaths = [];
  const comment = await findExistingComment(async (path) => {
    seenPaths.push(path);
    if (path.endsWith('page=1')) {
      return Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        user: { login: 'someone-else' },
        body: 'unrelated',
      }));
    }
    if (path.endsWith('page=2')) {
      return [{
        id: 200,
        user: { login: 'commitperclip[bot]' },
        body: 'Looks good.\n\n— commitperclip',
      }];
    }
    return [];
  }, 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment.id, 200);
  assert.deepEqual(seenPaths, [
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=1',
    '/repos/paperclipai/paperclip/issues/6469/comments?per_page=100&page=2',
  ]);
});

test('findExistingComment: returns null when no signed comment exists', async () => {
  const comment = await findExistingComment(async () => ([
    {
      id: 1,
      user: { login: 'commitperclip[bot]' },
      body: 'Unsigned status update',
    },
  ]), 'token', 'paperclipai/paperclip', 6469);

  assert.equal(comment, null);
});
