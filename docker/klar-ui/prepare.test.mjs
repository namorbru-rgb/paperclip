import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyFeature, git, prepare, stamp } from './prepare.mjs';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'klar-source-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  git(cwd, ['init', '--quiet']);
  git(cwd, ['config', 'core.autocrlf', 'false']);
  git(cwd, ['config', 'user.email', 'test@example.invalid']);
  git(cwd, ['config', 'user.name', 'Source Test']);
  mkdirSync(join(cwd, 'ui/src'), { recursive: true });
  writeFileSync(join(cwd, 'ui/src/view.txt'), 'existing UI\n');
  writeFileSync(join(cwd, 'server.txt'), 'old server\n');
  const commit = () => { git(cwd, ['add', '.']); git(cwd, ['commit', '--quiet', '-m', 'fixture']); return git(cwd, ['rev-parse', 'HEAD']); };
  const featureBase = commit();
  writeFileSync(join(cwd, 'ui/src/view.txt'), 'existing UI\nKlar\n');
  const featureCommit = commit();
  git(cwd, ['checkout', '--detach', featureBase]);
  writeFileSync(join(cwd, 'server.txt'), 'new production server\n');
  const releaseCommit = commit();
  return { cwd, definition: { featureBase, featureCommit, releaseCommit, paths: ['ui/src/view.txt'] } };
}

test('applies the reviewed UI patch without reverting a newer server', t => {
  const { cwd, definition } = fixture(t);
  assert.match(applyFeature(cwd, definition), /^[a-f0-9]{64}$/);
  assert.equal(readFileSync(join(cwd, 'server.txt'), 'utf8'), 'new production server\n');
  assert.equal(readFileSync(join(cwd, 'ui/src/view.txt'), 'utf8'), 'existing UI\nKlar\n');
  assert.equal(git(cwd, ['rev-parse', 'HEAD']), definition.releaseCommit);
});

test('rejects an unexpected source commit before applying a patch', t => {
  const { cwd, definition } = fixture(t);
  assert.throws(() => applyFeature(cwd, { ...definition, releaseCommit: definition.featureBase }), /Unexpected release/);
  assert.equal(git(cwd, ['status', '--porcelain']), '');
});

test('rejects a feature diff that does not match the reviewed paths', t => {
  const { cwd, definition } = fixture(t);
  assert.throws(() => applyFeature(cwd, { ...definition, paths: ['server.txt'] }), /reviewed scope/);
  assert.equal(git(cwd, ['status', '--porcelain']), '');
});

test('rejects dirty sources and leaves existing files untouched', t => {
  const { cwd, definition } = fixture(t);
  writeFileSync(join(cwd, 'server.txt'), 'local change\n');
  assert.throws(() => applyFeature(cwd, definition), /must be clean/);
  assert.equal(readFileSync(join(cwd, 'server.txt'), 'utf8'), 'local change\n');
  assert.throws(() => prepare(cwd), /must be empty/);
});

test('cannot label a UI build with a branch or an absent revision', t => {
  const { cwd } = fixture(t);
  assert.throws(() => stamp(cwd, 'master'), /exact Git commit/);
  assert.throws(() => stamp(cwd, ''), /exact Git commit/);
});
