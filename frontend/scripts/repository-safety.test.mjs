import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'madrigal-repository-safety-'));
const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
};

after(() => {
  const location = relative(tmpdir(), directory);
  assert.ok(!isAbsolute(location) && !location.startsWith('..'));
  assert.ok(basename(directory).startsWith('madrigal-repository-safety-'));
  rmSync(directory, { recursive: true, force: true });
});

const init = spawnSync('git', ['init', '--quiet', directory], { env, encoding: 'utf8' });
assert.equal(init.status, 0, init.stderr || init.error?.message);
copyFileSync(join(frontend, '.gitignore'), join(directory, '.gitignore'));

function ignored(paths) {
  const result = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
    cwd: directory,
    env,
    input: `${paths.join('\n')}\n`,
    encoding: 'utf8',
  });
  assert.ok([0, 1].includes(result.status), result.stderr || result.error?.message);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

test('секреты, реальные captures и локальные результаты исключены из Git', () => {
  const paths = [
    '.env',
    '.env.local',
    '.env.production',
    '.env.api.local',
    '.env.mock.local',
    'nested/.env.production.local',
    '.npmrc',
    '.netrc',
    '.git-credentials',
    '.aws/credentials',
    '.ssh/config',
    '.azure/profile.json',
    '.kube/config',
    'private.pem',
    'private.key',
    'certificate.p12',
    'certificate.pfx',
    'keystore.jks',
    'id_rsa',
    'nested/id_ed25519',
    'credentials.json',
    'secrets.production.json',
    'terraform.tfstate.backup',
    'private.pcap',
    'private.pcapng',
    'node_modules/package/index.js',
    'dist/index.html',
    '.tools/diagnostic.json',
    'test-results/trace.zip',
    'playwright-report/index.html',
    'playwright-report-browsers/index.html',
    'playwright-report-api/index.html',
    'playwright-report-production/index.html',
    'coverage/lcov.info',
    'docs/frontend/completion-2026-10-13/verify-final.log',
    'docs/frontend/completion-2026-10-13/screenshots/view.png',
    'docs/frontend/completion-2026-10-13/word-tz.txt',
    'docs/frontend/audit-2026-10-12/baseline-manifest.json',
    'docs/frontend/audit-2026-10-12/change-manifest.json',
    'docs/frontend/metrics.json',
  ];
  assert.deepEqual(ignored(paths), paths);
});

test('исходники, тесты, документация и безопасные шаблоны остаются в Git', () => {
  assert.deepEqual(
    ignored([
      '.env.api',
      '.env.mock',
      '.env.example',
      '.env.api.example',
      'package-lock.json',
      'src/app/App.tsx',
      'src/shared/api/client.test.ts',
      'e2e/completion.spec.ts',
      'public/demo-project.zip',
      'public/mockServiceWorker.js',
      'docs/frontend/requirements.md',
      'docs/frontend/verification.md',
      'scripts/repository-safety.test.mjs',
    ]),
    [],
  );
});

test('локальные ссылки в документации ведут к существующим файлам проекта', () => {
  function documents(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return documents(path);
      return entry.name.endsWith('.md') ? [path] : [];
    });
  }

  for (const document of [join(frontend, 'README.md'), ...documents(join(frontend, 'docs'))]) {
    const content = readFileSync(document, 'utf8').replace(/```[\s\S]*?```/g, '');
    for (const match of content.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
      const path = resolve(dirname(document), decodeURIComponent(target.split('#')[0]));
      const location = relative(frontend, path);
      assert.ok(!isAbsolute(location) && !location.startsWith('..'), target);
      assert.ok(existsSync(path), `${relative(frontend, document)}: ${target}`);
    }
  }
});

test('загружаемые env-файлы содержат только настройки публичного frontend', () => {
  for (const mode of ['api', 'mock']) {
    const content = readFileSync(join(frontend, `.env.${mode}`), 'utf8');
    const entries = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    assert.equal(entries.length, 2);
    assert.ok(entries.includes(`VITE_DATA_MODE=${mode}`));
    const base = entries.find((line) => line.startsWith('VITE_API_BASE_URL='));
    assert.ok(base);
    const url = new URL(base.slice('VITE_API_BASE_URL='.length), 'http://localhost');
    assert.ok(['http:', 'https:'].includes(url.protocol));
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
});
