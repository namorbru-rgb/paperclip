import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const source = JSON.parse(readFileSync(join(here, 'source.json'), 'utf8'));

export function git(cwd, args, input, trim = true) {
  const result = spawnSync('git', args, { cwd, input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return trim ? result.stdout.trim() : result.stdout;
}

export function applyFeature(cwd, definition = source) {
  for (const key of ['releaseCommit', 'featureBase', 'featureCommit']) {
    assert.match(definition[key], /^[a-f0-9]{40}$/);
  }
  assert.equal(git(cwd, ['rev-parse', 'HEAD']), definition.releaseCommit, 'Unexpected release source');
  assert.equal(git(cwd, ['status', '--porcelain']), '', 'Source must be clean');
  const paths = git(cwd, ['diff', '--name-only', '--no-renames', definition.featureBase, definition.featureCommit]).split('\n');
  assert.deepEqual(paths.sort(), [...definition.paths].sort(), 'Feature paths differ from reviewed scope');
  assert.ok(paths.every(path => path.startsWith('ui/src/') || path === 'doc/plans/2026-09-08-operational-dashboard.md'));
  const patch = git(cwd, ['diff', '--binary', '--no-renames', definition.featureBase, definition.featureCommit], undefined, false);
  git(cwd, ['apply', '--3way', '--index'], patch);
  git(cwd, ['diff', '--cached', '--check']);
  assert.deepEqual(git(cwd, ['diff', '--cached', '--name-only']).split('\n').sort(), [...definition.paths].sort());
  return createHash('sha256').update(patch).digest('hex');
}

export function prepare(cwd) {
  mkdirSync(cwd, { recursive: true });
  assert.equal(readdirSync(cwd).length, 0, 'Destination must be empty');
  git(cwd, ['init', '--quiet']);
  git(cwd, ['config', 'core.autocrlf', 'false']);
  git(cwd, ['remote', 'add', 'origin', source.repository]);
  git(cwd, ['fetch', '--depth=1', 'origin', source.releaseCommit, source.featureBase, source.featureCommit]);
  git(cwd, ['checkout', '--detach', source.releaseCommit]);
  return applyFeature(cwd);
}

export function verifyPackage(cwd, revision, packageDirectory = here) {
  assert.match(revision, /^[a-f0-9]{40}$/, 'Package revision must be an exact Git commit');
  const files = readdirSync(packageDirectory).sort();
  const committed = git(cwd, ['ls-tree', '-r', '--name-only', revision, '--', 'docker/klar-ui/']).split('\n');
  assert.deepEqual(committed.sort(), files.map(file => `docker/klar-ui/${file}`), 'Package file list does not match its Git revision');
  const hashes = {};
  for (const file of files) {
    const actual = readFileSync(join(packageDirectory, file), 'utf8');
    const expected = git(cwd, ['show', `${revision}:docker/klar-ui/${file}`], undefined, false);
    assert.equal(actual, expected, `Package content differs from its Git revision: ${file}`);
    hashes[file] = createHash('sha256').update(actual).digest('hex');
  }
  return hashes;
}

export function stamp(cwd, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/, 'Package revision must be an exact Git commit');
  assert.equal(git(cwd, ['rev-parse', 'HEAD']), source.releaseCommit);
  git(cwd, ['fetch', '--depth=1', 'origin', revision]);
  const packageFilesSha256 = verifyPackage(cwd, revision);
  const dist = join(cwd, 'ui', 'dist');
  const index = readFileSync(join(dist, 'index.html'));
  const manifest = {
    schemaVersion: 1, feature: 'Paperclip Klar', packageCommit: revision,
    releaseCommit: source.releaseCommit, featureCommit: source.featureCommit,
    packageFilesSha256,
    indexSha256: createHash('sha256').update(index).digest('hex'),
  };
  writeFileSync(join(dist, 'paperclip-ui-build.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, cwd, revision] = process.argv.slice(2);
  if (command === 'prepare') console.log(JSON.stringify({ patchSha256: prepare(resolve(cwd)) }));
  else if (command === 'stamp') console.log(JSON.stringify(stamp(resolve(cwd), revision)));
  else throw new Error('Usage: prepare.mjs prepare <empty-directory> | stamp <source-directory> <package-commit>');
}
