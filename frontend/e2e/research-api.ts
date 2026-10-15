import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type { api as client } from '../src/shared/api/client';

test('автоматическое исследование: реальные байты, наблюдение, независимая проверка и ZIP', async ({
  page,
}) => {
  const paths = [
    'research/01_configuration.pcap',
    'research/02_variations.pcapng',
    'research/03_combined_messages.pcap',
    'additional/04_new_observations.pcapng',
  ];
  const files = await Promise.all(
    paths.map(async (path) => ({
      name: path.split('/').at(-1)!,
      bytes: [...(await readFile('../testdata/sample_protocol/' + path))],
    })),
  );
  const journal = await readFile('../testdata/sample_protocol/action_journal.csv', 'utf8');
  const gateway = process.env.MADRIGAL_GATEWAY_URL!;
  await page.goto('/projects');
  const data = await page.evaluate(
    async ({ files, journal, gateway }) => {
      const modulePath = '/src/shared/api/client.ts';
      const { api } = (await import(/* @vite-ignore */ modulePath)) as { api: typeof client };
      const key = () => ({ idempotencyKey: crypto.randomUUID() });
      const assert = (value: unknown, message: string) => {
        if (!value) throw new Error(message);
      };
      const wait = async (projectId: string, jobId: string) => {
        for (let i = 0; i < 300; i++) {
          const job = await api.job(projectId, jobId);
          if (['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status)) {
            assert(job.status === 'COMPLETED', JSON.stringify(job));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Research job timeout');
      };
      try {
        const project = await api.createProject(
          {
            name: 'Автоматическое исследование ' + crypto.randomUUID(),
            description: 'Независимая проверка на дополнительной записи',
          },
          key(),
        );
        const projectId = project.projectId,
          captures: string[] = [];
        for (const file of files) {
          const upload = await api.uploadCapture(
            { projectId },
            { ...key(), file: new File([Uint8Array.from(file.bytes)], file.name) },
          );
          await wait(projectId, upload.job.jobId);
          const capture = (await api.captures({ projectId })).items.find(
            (item) => item.name === file.name,
          );
          assert(capture, 'Imported capture missing');
          captures.push(capture!.captureId);
        }
        const csv = await api.importActions(
          { projectId },
          { ...key(), file: new File([journal], 'action_journal.csv') },
        );
        assert('job' in csv, 'Import job missing');
        if ('job' in csv) await wait(projectId, csv.job.jobId);
        const started = performance.now();
        const discovery = await api.discover({
          projectId,
          captures: captures.slice(0, 3).map((captureId) => ({ captureId })),
        });
        assert(discovery.rows.length > 20, 'No automatic message examples');
        const candidate = discovery.candidates.find(
          (item) =>
            item.parameter === 'params.threshold_c' &&
            item.encoding === 'int16be' &&
            item.divisor === 100,
        );
        assert(
          candidate && candidate.matches >= 3,
          'Signed scaled threshold not found: ' +
            JSON.stringify(
              discovery.candidates.map((item) => [
                item.parameter,
                item.encoding,
                item.divisor,
                item.matches,
              ]),
            ),
        );
        const c = candidate!;
        assert(c.examples.length >= 2 && c.schemaJson, 'Candidate has no proof or specification');
        const input = {
          projectId,
          text: c.statement,
          basis: c.basis,
          generation: {
            engineVersion: discovery.engineVersion,
            fingerprint: discovery.fingerprint,
            candidateId: c.id,
            kind: c.kind,
            parameter: c.parameter,
            matches: c.matches,
            total: c.total,
          },
          examples: c.examples,
        };
        const idempotency = key();
        const observation = await api.saveAutomaticObservation(input, idempotency);
        assert(
          observation.type === 'observation' && observation.status === 'open',
          'Generated observation must remain open',
        );
        assert(
          observation.generation?.fingerprint === discovery.fingerprint,
          'Generation provenance missing',
        );
        assert(
          (await api.saveAutomaticObservation(input, idempotency)).hypothesisId ===
            observation.hypothesisId,
          'Automatic retry duplicated observation',
        );
        const before = (await api.evidence({ projectId, limit: 100 })).items.length;
        const invalid = {
          ...input,
          generation: { ...input.generation, candidateId: 'rollback' },
          examples: input.examples.map((example, index) =>
            index === 1 ? { ...example, actionId: 'missing-action' } : example,
          ),
        };
        let rejected = false;
        try {
          await api.saveAutomaticObservation(invalid, key());
        } catch {
          rejected = true;
        }
        assert(rejected, 'Invalid linked action accepted');
        assert(
          (await api.evidence({ projectId, limit: 100 })).items.length === before,
          'Failed automatic save left orphan source links',
        );
        const model = await api.createInterpretation(
          { projectId, name: 'Порог из кандидата', json: c.schemaJson },
          key(),
        );
        const revision = model.revisions.at(-1)!;
        assert(revision.json === c.schemaJson, 'Candidate schema changed');
        const assemblies = await (
          await fetch(`${gateway}/api/v1/projects/${projectId}/captures/${captures[3]}/assemblies`)
        ).json();
        const assembly = assemblies.items
          .filter((item: { status: string }) => item.status === 'READY')
          .at(-1);
        const created = await api.createRun(
          {
            projectId,
            interpretationId: model.interpretationId,
            revisionId: revision.revisionId,
            settingsVersion: project.settingsVersion,
            corpus: [{ captureId: captures[3], assemblyId: assembly.assemblyId }],
          },
          key(),
        );
        await wait(projectId, created.job.jobId);
        const run = await api.run(projectId, created.run!.runId);
        assert(
          BigInt(run.summary.rules.PASS) > 0n,
          'Independent action checks did not pass: ' + JSON.stringify(run.summary),
        );
        assert(
          BigInt(run.summary.rules.FAIL) === 0n,
          'Independent checks failed: ' + JSON.stringify(run.summary),
        );
        assert(
          BigInt(run.summary.messageStatuses!.NOT_APPLICABLE) > 0n,
          'Uncovered messages missing from summary',
        );
        assert(
          Object.values(run.summary.messageStatuses!).reduce(
            (sum, value) => sum + BigInt(value),
            0n,
          ) === BigInt(run.summary.messages),
          'Message summary does not cover the entire corpus',
        );
        assert(run.manifest.engineVersion === 'analysis-0.3', 'Wrong analysis engine pinned');
        const rawRun = await (
          await fetch(`${gateway}/api/v1/projects/${projectId}/runs/${run.runId}`)
        ).json();
        assert(JSON.stringify(rawRun).includes('actionSnapshot'), 'Journal snapshot not pinned');
        assert(
          (await api.results({ projectId, runId: run.runId, status: 'PASS' })).items.length > 0,
          'No verified messages',
        );
        const exported = await api.exportProject(projectId, key());
        await wait(projectId, exported.job.jobId);
        const artifacts = await api.artifacts({ projectId });
        const bundle = artifacts.items.find((item) => item.jobId === exported.job.jobId)!;
        const zip = await (await fetch(bundle.downloadUrl!)).blob();
        const imported = await api.importProject(
          {},
          { ...key(), file: new File([zip], 'automatic-research.zip') },
        );
        await wait(imported.job.projectId, imported.job.jobId);
        const restoredId = imported.job.projectId;
        const restored = (await api.hypotheses({ projectId: restoredId })).items[0]!;
        assert(
          restored.generation?.fingerprint === observation.generation?.fingerprint,
          'Automatic provenance lost on ZIP restore',
        );
        assert(
          restored.evidence.length === observation.evidence.length &&
            restored.evidence.every((item) => item.location.projectId === restoredId),
          'Automatic sources not remapped',
        );
        assert(
          (await api.sources(restored.evidence[0]!.location)).length > 0,
          'Restored automatic SourceMap missing',
        );
        const restoredRun = (await api.runs({ projectId: restoredId })).items[0]!;
        assert(
          restoredRun.summary.rules.PASS === run.summary.rules.PASS,
          'Restored verification changed',
        );
        const report = await api.createReport(projectId, run.runId, key());
        await wait(projectId, report.job.jobId);
        const reportFile = (await api.artifacts({ projectId })).items.find(
          (item) => item.jobId === report.job.jobId,
        )!;
        const markdown = await (await fetch(reportFile.downloadUrl!)).text();
        for (const text of [
          observation.hypothesisId,
          c.basis,
          discovery.fingerprint,
          c.examples[0]!.captureSha256!,
          'Пакет ',
        ])
          assert(markdown.includes(text), 'Automatic provenance missing from report: ' + text);
        const wrongSchema = JSON.parse(c.schemaJson!);
        wrongSchema.fields[0].offset++;
        const wrongRevision = await api.saveRevision(
          {
            projectId,
            interpretationId: model.interpretationId,
            parentRevisionId: revision.revisionId,
            json: JSON.stringify(wrongSchema),
            label: 'Проверка ошибочного смещения',
          },
          key(),
        );
        assert(
          (await api.run(projectId, run.runId)).historical,
          'Old revision not marked historical',
        );
        const verify = async (revisionId: string) => {
          const request = await api.createRun(
            {
              projectId,
              revisionId,
              settingsVersion: project.settingsVersion,
              corpus: [{ captureId: captures[3], assemblyId: assembly.assemblyId }],
            },
            key(),
          );
          await wait(projectId, request.job.jobId);
          return api.run(projectId, request.run!.runId);
        };
        const failed = await verify(wrongRevision.revisionId);
        assert(
          BigInt(failed.summary.rules.FAIL) > 0n,
          'Wrong interpretation did not produce counterexamples',
        );
        const corrected = await api.saveRevision(
          {
            projectId,
            interpretationId: model.interpretationId,
            parentRevisionId: wrongRevision.revisionId,
            json: c.schemaJson,
            label: 'Возвращено проверяемое смещение',
          },
          key(),
        );
        const rechecked = await verify(corrected.revisionId);
        assert(
          BigInt(rechecked.summary.rules.FAIL) === 0n && BigInt(rechecked.summary.rules.PASS) > 0n,
          'Corrected interpretation failed',
        );
        return {
          projectId,
          restoredId,
          runId: run.runId,
          observationId: observation.hypothesisId,
          groupId: c.groupId,
          parameter: c.parameter,
          candidateId: c.id,
          source: observation.evidence[0]!.location,
          rows: discovery.rows.length,
          matches: c.matches,
          total: c.total,
          passed: run.summary.rules.PASS,
          counterexamples: failed.summary.rules.FAIL,
          correctedRevisionId: corrected.revisionId,
          additionalCaptureId: captures[3],
          seconds: (performance.now() - started) / 1000,
        };
      } catch (error) {
        const failure = error as Error & { code?: string; details?: unknown };
        throw new Error(
          `${failure.code ?? ''}: ${failure.message}; ${JSON.stringify(failure.details ?? '')}`,
          { cause: error },
        );
      }
    },
    { files, journal, gateway },
  );
  console.log('AUTOMATIC RESEARCH', JSON.stringify(data));
  await page.goto(`${gateway}/projects/${data.projectId}/compare`);
  await expect(page.getByRole('heading', { name: 'Кандидаты и наблюдения' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel('Группа примеров').selectOption(data.groupId);
  await page.getByLabel('Сопоставить со значением журнала').selectOption(data.parameter);
  await expect(page.locator('.research-matrix [data-candidate="true"]').first()).toBeVisible();
  await page
    .locator('.research-candidate')
    .first()
    .getByRole('button', { name: 'Создать наблюдение', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Наблюдение из данных' });
  await expect(dialog.getByLabel('Автоматическая формулировка')).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Сохранить наблюдение с источниками' }).click();
  await expect(dialog.getByText(/Запись сохранена с/)).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть диалог' }).click();
  await page.screenshot({ path: 'test-results/research/compare.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/research/compare-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Переключить тему' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/research/compare-dark.png', fullPage: true });
  await page.getByRole('button', { name: 'Создать схему из кандидата', exact: true }).click();
  await page.getByRole('link', { name: 'Открыть спецификацию →' }).click();
  await expect(page).toHaveURL(/source=/);
  const previewResponse = page.waitForResponse(
    (response) => response.url().endsWith('/previews') && response.request().method() === 'POST',
    { timeout: 15000 },
  );
  await page.getByRole('button', { name: 'Выполнить preview', exact: true }).click();
  const preview = await (await previewResponse).json();
  expect(preview.messages.some((message: { fields: unknown[] }) => message.fields.length > 0)).toBe(
    true,
  );
  await page.goto(
    `${gateway}/projects/${data.projectId}/traffic?` + new URLSearchParams(data.source),
  );
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'Подсветить кандидаты в поля' }).click();
  await expect(page.locator('.hex-byte[data-candidate="true"]').first()).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Создать наблюдение из выделения' }).click();
  await expect(dialog.getByLabel('Автоматическая формулировка')).toHaveValue(/известны .* байт/);
  await page.getByRole('button', { name: 'Закрыть диалог' }).click();
  await mkdir('test-results/research', { recursive: true });
  await writeFile('test-results/research/last-run.json', JSON.stringify(data, null, 2));
});
