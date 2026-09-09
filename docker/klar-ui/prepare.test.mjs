import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { applyFeature, applyLocale, applyRedesign, git, prepare, stamp, verifyPackage } from './prepare.mjs';

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

test('binds the package to committed file contents and rejects false labels', t => {
  const { cwd, definition } = fixture(t);
  const packageDirectory = join(cwd, 'docker/klar-ui');
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, 'prepare.mjs'), 'reviewed package\n');
  git(cwd, ['add', 'docker/klar-ui']);
  git(cwd, ['commit', '--quiet', '-m', 'package fixture']);
  const revision = git(cwd, ['rev-parse', 'HEAD']);
  assert.match(verifyPackage(cwd, revision, packageDirectory)['prepare.mjs'], /^[a-f0-9]{64}$/);
  assert.throws(() => verifyPackage(cwd, definition.releaseCommit, packageDirectory), /file list/);
  writeFileSync(join(packageDirectory, 'prepare.mjs'), 'unreviewed change\n');
  assert.throws(() => verifyPackage(cwd, revision, packageDirectory), /content differs/);
});

test('locale overlay preserves the server and rejects wrong bases, tampering and non-UI scope', t => {
  const { cwd, definition } = fixture(t);
  applyFeature(cwd, definition);
  const baseTree = git(cwd, ['write-tree']);
  writeFileSync(join(cwd, 'ui/src/view.txt'), 'existing UI\nKlar\nNeuer Auftrag\n');
  git(cwd, ['add', 'ui/src/view.txt']);
  const resultTree = git(cwd, ['write-tree']);
  const patch = git(cwd, ['diff', '--cached', baseTree], undefined, false);
  const patchPath = join(cwd, 'locale.patch');
  writeFileSync(patchPath, patch);
  git(cwd, ['read-tree', baseTree]);
  writeFileSync(join(cwd, 'ui/src/view.txt'), 'existing UI\nKlar\n');
  git(cwd, ['add', 'ui/src/view.txt']);
  const locale = { baseTree, resultTree, sha256: createHash('sha256').update(patch).digest('hex'), paths: ['ui/src/view.txt'] };
  assert.throws(() => applyLocale(cwd, { ...locale, baseTree: resultTree }, patchPath), /Unexpected UI source before/);
  assert.throws(() => applyLocale(cwd, { ...locale, sha256: '0'.repeat(64) }, patchPath), /hash differs/);
  assert.throws(() => applyLocale(cwd, { ...locale, paths: ['server.txt'] }, patchPath), /reviewed scope/);
  const unsafePatch = patch.replaceAll('ui/src/view.txt', 'server.txt');
  writeFileSync(patchPath, unsafePatch);
  assert.throws(() => applyLocale(cwd, { ...locale, sha256: createHash('sha256').update(unsafePatch).digest('hex'), paths: ['server.txt'] }, patchPath), /only change UI source/);
  writeFileSync(patchPath, patch);
  applyLocale(cwd, locale, patchPath);
  assert.equal(git(cwd, ['write-tree']), resultTree);
  assert.equal(readFileSync(join(cwd, 'server.txt'), 'utf8'), 'new production server\n');
});

test('redesign preserves added regression tests, reviewed UI/story paths and the server', t => {
  const { cwd, definition } = fixture(t);
  applyFeature(cwd, definition);
  const baseTree = git(cwd, ['write-tree']);
  mkdirSync(join(cwd, 'ui/storybook/stories'), { recursive: true });
  writeFileSync(join(cwd, 'ui/src/view.txt'), 'Guided task input\n');
  const regression = 'import { expect, test } from "vitest";\ntest("stable translated status", () => expect(true).toBe(true));\n';
  writeFileSync(join(cwd, 'ui/src/view.test.ts'), regression);
  writeFileSync(join(cwd, 'ui/storybook/stories/klar.stories.tsx'), 'export const Preview = {};\n');
  git(cwd, ['add', 'ui']);
  const resultTree = git(cwd, ['write-tree']);
  const patch = git(cwd, ['diff', '--cached', baseTree], undefined, false);
  const patchPath = join(cwd, 'redesign.patch');
  writeFileSync(patchPath, patch);
  git(cwd, ['restore', '--source', baseTree, '--staged', '--worktree', '--', 'ui']);
  const design = { baseTree, resultTree, sha256: createHash('sha256').update(patch).digest('hex'), paths: ['ui/src/view.test.ts', 'ui/src/view.txt', 'ui/storybook/stories/klar.stories.tsx'] };
  assert.throws(() => applyLocale(cwd, design, patchPath), /only change UI source/);
  assert.throws(() => applyRedesign(cwd, { ...design, paths: ['server.txt'] }, patchPath), /reviewed scope/);
  assert.throws(() => applyRedesign(cwd, { ...design, paths: design.paths.filter(path => !path.endsWith('.test.ts')) }, patchPath), /reviewed scope/);
  applyRedesign(cwd, design, patchPath);
  assert.equal(git(cwd, ['write-tree']), resultTree);
  assert.equal(readFileSync(join(cwd, 'ui/src/view.test.ts'), 'utf8'), regression);
  assert.equal(readFileSync(join(cwd, 'server.txt'), 'utf8'), 'new production server\n');
});
