import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import type { api as client } from '../src/shared/api/client';

test('все операции клиента используют реальные сервисы; ZIP сохраняет происхождение', async ({
  page,
}) => {
  const fixture = [
    ...(await readFile('../testdata/sample_protocol/research/01_configuration.pcap')),
  ];
  const additional = [
    ...(await readFile('../testdata/sample_protocol/research/02_variations.pcapng')),
  ];
  await page.goto('/projects');
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  const data = await page.evaluate(
    async ({ fixture, additional }) => {
      const modulePath = '/src/shared/api/client.ts';
      const { api } = (await import(/* @vite-ignore */ modulePath)) as { api: typeof client };
      const key = () => ({ idempotencyKey: crypto.randomUUID() });
      const wait = async (projectId: string, jobId: string) => {
        for (let attempt = 0; attempt < 200; attempt++) {
          const job = await api.job(projectId, jobId);
          if (['COMPLETED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.status)) {
            if (job.status !== 'COMPLETED') throw new Error(JSON.stringify(job));
            return job;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Job timeout');
      };
      const assert = (value: unknown, message: string) => {
        if (!value) throw new Error(message);
      };
      try {
        const projectKey = key();
        const project = await api.createProject(
          {
            name: 'Реальная интеграция ' + crypto.randomUUID(),
            description: 'Сохранить описание и связи',
          },
          projectKey,
        );
        assert(
          (
            await api.createProject(
              { name: project.name, description: project.description },
              projectKey,
            )
          ).projectId === project.projectId,
          'Project retry',
        );
        const projectId = project.projectId;
        assert(
          (await api.projects({ q: project.name })).items.some(
            (item) => item.projectId === projectId,
          ),
          'Project search',
        );
        const settings = await api.saveSettings(
          projectId,
          {
            timeZone: 'Europe/Moscow',
            offsetNanoseconds: '-125',
            checksum: 'warn',
            overlap: 'preserve-alternatives',
          },
          key(),
        );
        assert(
          (await api.settings(projectId, settings.settingsVersion))[0]?.checksum === 'warn',
          'Settings round trip',
        );
        const upload = await api.uploadCapture(
          { projectId },
          { ...key(), file: new File([new Uint8Array(fixture)], 'configuration.pcap') },
        );
        await wait(projectId, upload.job.jobId);
        const capture = (await api.captures({ projectId })).items[0]!;
        assert((await api.project(projectId)).captures === 1, 'Capture count');
        const sessions = await api.sessions({ projectId, captureId: capture.captureId });
        const selected = sessions.items[0]!;
        const assemblies = await api.assemblies({
          projectId,
          captureId: capture.captureId,
          sessionId: selected.sessionId,
        });
        assert(assemblies.items.length === 2, 'Both directions must be selectable');
        const assembly = assemblies.items.find((item) => item.direction === 'A_TO_B')!;
        const location = {
          projectId,
          captureId: capture.captureId,
          sessionId: selected.sessionId,
          assemblyId: assembly.assemblyId,
          streamId: assembly.streamId,
          direction: assembly.direction,
          start: '0',
          length: '4',
        } as Parameters<typeof api.bytes>[0];
        assert((await api.bytes(location)).segments.length > 0, 'Bytes');
        const sources = await api.sources(location);
        assert(sources.length > 0, 'SourceMap');
        const packet = await api.packet({
          projectId,
          captureId: capture.captureId,
          packetNo: sources[0]!.packetNo,
        });
        assert(packet.bytes.length > 0, 'Packet');
        await api.search({
          ...location,
          mode: 'HEX',
          pattern: packet.bytes
            .slice(Number(sources[0]!.frameOffset), Number(sources[0]!.frameOffset) + 1)
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(''),
        });
        const journalKey = key();
        const csv = new File(
          [
            'timestamp,name,type,parameters\n2026-10-15T08:00:00.000000001Z,Изменение,configuration,"{""value"":18446744073709551615}"\n',
          ],
          'actions.csv',
        );
        const journal = await api.importActions(
          { projectId, timeZone: 'Europe/Moscow', offsetNanoseconds: '-125' },
          { ...journalKey, file: csv },
        );
        assert('job' in journal, 'CSV must return an asynchronous job');
        if (!('job' in journal)) throw new Error('CSV job missing');
        await wait(projectId, journal.job.jobId);
        const repeatedJournal = await api.importActions(
          { projectId, timeZone: 'Europe/Moscow', offsetNanoseconds: '-125' },
          { ...journalKey, file: csv },
        );
        assert(
          'job' in repeatedJournal && repeatedJournal.job.jobId === journal.job.jobId,
          'CSV retry',
        );
        const actions = await api.actions({ projectId, q: 'ИЗМЕНЕНИЕ', type: 'configuration' });
        assert(
          actions.items.length === 1 &&
            actions.items[0]!.parameters.includes('18446744073709551615'),
          'CSV values/search/type',
        );
        const evidenceKey = key();
        const evidenceInput = {
          projectId,
          location,
          kind: 'support',
          status: 'tentative',
          basis: 'Исходные байты',
          actionId: actions.items[0]!.actionId,
        };
        const evidence = await api.saveEvidence(evidenceInput, evidenceKey);
        assert(
          JSON.stringify(evidence.sources) === JSON.stringify(sources),
          'Manual evidence resolves SourceMap',
        );
        assert(
          (await api.saveEvidence(evidenceInput, evidenceKey)).evidenceId === evidence.evidenceId,
          'Manual evidence retry',
        );
        const confirmed = await api.saveEvidence(
          { projectId, ...evidence, status: 'confirmed', basis: 'Проверено по кадру' },
          key(),
        );
        assert(confirmed.evidenceId === evidence.evidenceId, 'Evidence patch');
        assert((await api.evidence({ projectId })).items.length === 1, 'Evidence list');
        const observation = await api.saveHypothesis(
          {
            projectId,
            type: 'hypothesis',
            text: 'Проверяемая гипотеза',
            basis: 'Основание',
            status: 'open',
            evidence: [confirmed],
          },
          key(),
        );
        const edited = await api.saveHypothesis(
          { ...observation, status: 'inconclusive', basis: 'Нужно больше данных' },
          key(),
        );
        assert(
          edited.status === 'inconclusive' && edited.evidence.length === 1,
          'Observation patch',
        );
        assert(
          (await api.hypotheses({ projectId, status: 'inconclusive' })).items.length === 1,
          'Observation status filter',
        );
        const interpretation = await api.createInterpretation({ projectId, name: 'Opcode' }, key());
        const json =
          '{\n  "framing": {"fixedLength": 4},\n  "fields": [{"name":"opcode","type":"uint32le"}],\n  "checks": [{"id":"bound","field":"opcode","op":"range","max":30}]\n}\n';
        const revisionKey = key();
        const revisionInput = {
          projectId,
          interpretationId: interpretation.interpretationId,
          json,
          label: 'Точный JSON и комментарий',
          parentRevisionId: interpretation.revisions[0]!.revisionId,
        };
        const revision = await api.saveRevision(revisionInput, revisionKey);
        assert(
          (await api.saveRevision(revisionInput, revisionKey)).revisionId === revision.revisionId,
          'Revision retry',
        );
        assert(
          revision.json === json && revision.label === revisionInput.label,
          'Revision formatting/comment',
        );
        assert(
          (await api.interpretation(projectId, interpretation.interpretationId)).revisions.at(-1)
            ?.revisionId === revision.revisionId,
          'Revision order',
        );
        assert(
          (await api.interpretations({ projectId })).items.length === 1,
          'Interpretation list',
        );
        const preview = await api.preview({ projectId, revisionId: revision.revisionId, location });
        assert(
          preview.results.length > 0 && preview.results[0]!.fields.length > 0,
          'Preview messages/fields',
        );
        const runKey = key();
        const secondUpload = await api.uploadCapture(
          { projectId },
          { ...key(), file: new File([new Uint8Array(additional)], 'variations.pcapng') },
        );
        await wait(projectId, secondUpload.job.jobId);
        const secondCapture = (await api.captures({ projectId })).items.find(
          (item) => item.captureId !== capture.captureId,
        )!;
        const secondSession = (
          await api.sessions({ projectId, captureId: secondCapture.captureId })
        ).items[0]!;
        const secondAssembly = (
          await api.assemblies({
            projectId,
            captureId: secondCapture.captureId,
            sessionId: secondSession.sessionId,
          })
        ).items[0]!;
        const runInput = {
          projectId,
          revisionId: revision.revisionId,
          settingsVersion: settings.settingsVersion,
          corpus: [
            { captureId: capture.captureId, assemblyId: assembly.assemblyId },
            { captureId: secondCapture.captureId, assemblyId: secondAssembly.assemblyId },
          ],
          filters: 'Все сообщения выбранных сборок',
        };
        const started = await api.createRun(runInput, runKey);
        await wait(projectId, started.job.jobId);
        assert(
          (await api.createRun(runInput, runKey)).run?.runId === started.run?.runId,
          'Run retry',
        );
        const run = await api.run(projectId, started.run!.runId);
        assert(run.summary.complete && BigInt(run.summary.messages) > 0n, 'Run coverage');
        assert(
          run.summary.captures === '2' && run.manifest.corpus.length === 2,
          'Multiple captures pinned',
        );
        assert((await api.runs({ projectId })).items.length === 1, 'Run list');
        const results = await api.results({ projectId, runId: run.runId });
        assert(results.items.length > 0 && results.items[0]!.fields.length > 0, 'Run results');
        assert(
          (
            await api.results({ projectId, runId: run.runId, captureId: secondCapture.captureId })
          ).items.every((item) => item.location.captureId === secondCapture.captureId),
          'Results capture filter',
        );
        await api.saveEvidence(
          { projectId, ...confirmed, runId: run.runId, revisionId: revision.revisionId },
          key(),
        );
        assert(
          (await api.cancelJob(projectId, run.jobId)).status === 'COMPLETED',
          'Terminal cancellation',
        );
        const report = await api.createReport(projectId, run.runId, key());
        await wait(projectId, report.job.jobId);
        const reportArtifact = (await api.artifacts({ projectId })).items.find(
          (item) => item.kind === 'report',
        )!;
        assert(reportArtifact.status === 'READY' && reportArtifact.downloadUrl, 'Report');
        assert((await fetch(reportArtifact.downloadUrl!)).ok, 'Report download');
        const exported = await api.exportProject(projectId, key());
        await wait(projectId, exported.job.jobId);
        const zip = (await api.artifacts({ projectId })).items.find(
          (item) => item.kind === 'project',
        )!;
        const zipResponse = await fetch(zip.downloadUrl!);
        assert(zipResponse.ok, 'ZIP download');
        const archive = new File([await zipResponse.blob()], 'project.zip');
        const importKey = key();
        const imported = await api.importProject({}, { ...importKey, file: archive });
        const restoredId = imported.job.projectId;
        await wait(restoredId, imported.job.jobId);
        assert(
          (await api.importProject({}, { ...importKey, file: archive })).job.jobId ===
            imported.job.jobId,
          'ZIP import retry',
        );
        assert(
          (await api.project(restoredId)).description === project.description,
          'Project description restore',
        );
        const restoredHypothesis = (await api.hypotheses({ projectId: restoredId })).items[0]!;
        const restoredEvidence = restoredHypothesis.evidence[0]!;
        assert(
          restoredEvidence.location.projectId === restoredId &&
            restoredEvidence.location.assemblyId !== location.assemblyId,
          'Restored IDs',
        );
        assert((await api.sources(restoredEvidence.location)).length > 0, 'Restored SourceMap');
        const restoredRun = (await api.runs({ projectId: restoredId })).items[0]!;
        assert(
          restoredEvidence.runId === restoredRun.runId &&
            restoredEvidence.revisionId === restoredRun.manifest.revisionId,
          'Restored evidence analysis references',
        );
        assert(
          restoredRun.runId !== run.runId && restoredRun.status === 'COMPLETED',
          'Restored analysis job/run',
        );
        assert(
          (await api.results({ projectId: restoredId, runId: restoredRun.runId })).items.length > 0,
          'Restored results',
        );
        assert(
          (await api.interpretations({ projectId: restoredId })).items[0]!.revisions.at(-1)
            ?.json === json,
          'Exact schema restore',
        );
        await api.deleteHypothesis(restoredId, restoredHypothesis.hypothesisId, key());
        assert(
          (await api.hypotheses({ projectId: restoredId })).items.length === 0,
          'Observation delete',
        );
        const rebuild = await api.createAssembly(
          { projectId, captureId: capture.captureId, settingsVersion: settings.settingsVersion },
          key(),
        );
        await wait(projectId, rebuild.job.jobId);
        const history = await api.assemblyHistory({ projectId, captureId: capture.captureId });
        assert(
          history.items.length === 2 &&
            history.items.every((item) => item.engineVersion && item.createdAt),
          'Assembly history metadata',
        );
        const individual = await api.checks({
          projectId,
          runId: run.runId,
          rule: 'bound',
          captureId: capture.captureId,
        });
        assert(
          individual.items.length > 0 &&
            individual.items.every(
              (item) => item.rule === 'bound' && item.location?.captureId === capture.captureId,
            ),
          'Individual checks retain source and capture filter',
        );
        assert(
          (await api.checks({ projectId, runId: run.runId, q: 'no-such-check-text' })).items
            .length === 0,
          'Check search before pagination',
        );
        return {
          projectId,
          restoredId,
          runId: run.runId,
          location,
          actionId: actions.items[0]!.actionId,
          messages: run.summary.messages,
          interpretationId: interpretation.interpretationId,
          revisionId: revision.revisionId,
        };
      } catch (error) {
        const failure = error as Error & { details?: unknown; code?: string };
        throw new Error(
          `${failure.code ?? ''}: ${failure.message}; ${JSON.stringify(failure.details ?? '')}`,
          { cause: error },
        );
      }
    },
    { fixture, additional },
  );
  console.log('REAL INTEGRATION', JSON.stringify(data));
  const gateway = process.env.MADRIGAL_GATEWAY_URL!;
  await page.goto(`${gateway}/projects/${data.projectId}/runs/${data.runId}`);
  await expect(page.getByRole('heading', { name: 'Закреплённые входы' })).toBeVisible();
  await page.getByLabel('Показать результаты').selectOption('checks');
  await expect(page.getByRole('columnheader', { name: 'Объяснение', exact: true })).toBeVisible();
  await page.getByLabel('Поиск в результатах').fill('no-such-check-text');
  await expect(page.getByText('Нет результатов по этим условиям', { exact: true })).toBeVisible();
  await page.getByLabel('Поиск в результатах').fill('');
  await expect(page.getByRole('columnheader', { name: 'Объяснение', exact: true })).toBeVisible();
  const exportedResults = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать результаты NDJSON' }).click();
  const ndjson = await exportedResults;
  expect(
    (await readFile((await ndjson.path())!, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .every((item) => item.rule === 'bound'),
  ).toBe(true);
  await page.goto(
    `${gateway}/projects/${data.projectId}/interpretations/${data.interpretationId}?revisionId=${data.revisionId}`,
  );
  await expect(page.getByLabel('Название поля 1')).toBeVisible();
  await page.getByLabel('Как выделять сообщения').selectOption('length');
  await page.getByLabel('Размер заголовка, байт').fill('6');
  await page.getByLabel('Позиция длины в заголовке').fill('3');
  await page.getByLabel('Как выделять сообщения').selectOption('fixed');
  await page.getByLabel('Название поля 1').fill('renamed_opcode');
  await page.getByLabel('Тип поля 1', { exact: true }).selectOption('uint16be');
  await page.getByLabel('Позиция поля 1', { exact: true }).fill('0');
  await page.getByLabel('Масштаб поля 1', { exact: true }).fill('0.');
  await expect(
    page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Масштаб поля 1', { exact: true }).fill('0.01');
  await page.getByRole('button', { name: 'Добавить поле', exact: true }).click();
  await page.getByLabel('Максимум правила 1', { exact: true }).fill('18446744073709551615');
  const revisionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith(`/interpretations/${data.interpretationId}/revisions`),
  );
  await page.getByRole('button', { name: 'Сохранить новую ревизию', exact: true }).click();
  const written = await revisionResponse;
  expect(written.ok()).toBe(true);
  const savedRevision = await written.json();
  expect(savedRevision.schemaJson).toContain('18446744073709551615');
  expect(JSON.parse(savedRevision.schemaJson)).toMatchObject({
    framing: { fixedLength: 4 },
    fields: [
      { name: 'renamed_opcode', type: 'uint16be', offset: 0, scale: 0.01 },
      { type: 'uint8' },
    ],
    checks: [{ field: 'renamed_opcode' }],
  });
  await expect(page.getByText('Сохранённый JSON', { exact: true })).toBeVisible();
  const previewResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/preview'),
  );
  await page.getByRole('button', { name: 'Выполнить preview', exact: true }).click();
  const previewed = await previewResponse;
  expect(previewed.ok()).toBe(true);
  expect(previewed.request().postDataJSON().revisionId).toBe(savedRevision.revisionId);
  await expect(page.locator('.preview-panel .results-table tbody tr').first()).toBeVisible();
  await mkdir('test-results/integration', { recursive: true });
  await page.screenshot({ path: 'test-results/integration/schema-builder.png', fullPage: true });
  const discoveryResponse = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/discoveries'),
  );
  await page.goto(
    `${gateway}/projects/${data.projectId}/compare?revisionId=${savedRevision.revisionId}`,
  );
  const discovered = await discoveryResponse;
  expect(discovered.ok()).toBe(true);
  expect(discovered.request().postDataJSON().revisionId).toBe(savedRevision.revisionId);
  await expect(page.getByLabel('Границы сообщений для автосравнения')).toHaveValue(
    savedRevision.revisionId,
  );
  await page.goto(`${gateway}/projects/${data.projectId}/artifacts?runId=${data.runId}`);
  await expect(page.getByRole('button', { name: 'Копировать команду PowerShell' })).toBeVisible();
  await expect(page.locator('.command-preview')).toContainText('--assembly');
  const source = new URLSearchParams(data.location);
  await page.goto(`${gateway}/projects/${data.projectId}/traffic?${source}`);
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByText('История сборок записи', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть эту сборку', exact: true })).toHaveCount(
    2,
  );
  await page.getByRole('button', { name: 'Открыть эту сборку', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp('assemblyId=' + data.location.assemblyId));
  await expect(page.getByRole('grid')).toBeVisible();
  await page.getByRole('button', { name: 'Исходные пакеты', exact: true }).click();
  await expect(page.locator('.source-packet').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.goto(`${gateway}/projects/${data.projectId}/actions?actionId=${data.actionId}`);
  const basis = 'Ручная связь из формы: изменение температуры';
  await page.getByLabel('Основание связи', { exact: true }).fill(basis);
  const save = page.getByRole('button', { name: 'Сохранить ручную связь', exact: true });
  await expect(save).toBeEnabled();
  const response = page.waitForResponse(
    (item) =>
      item.request().method() === 'POST' &&
      item.url().endsWith(`/projects/${data.projectId}/evidence`),
  );
  await save.click();
  const saved = await response;
  expect(saved.ok()).toBe(true);
  expect(saved.request().postDataJSON().sources.length).toBeGreaterThan(0);
  const evidenceBody = await saved.json();
  expect(evidenceBody.actionId).toBe(data.actionId);
  expect(evidenceBody.sources.length).toBeGreaterThan(0);
  await expect(page.getByText('Связь сохранена:', { exact: false })).toBeVisible();
  await page.reload();
  const card = page.locator('.evidence-card').filter({ hasText: basis });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Редактировать связь' }).click();
  const dialog = page.getByRole('dialog', { name: 'Редактирование ручной связи' });
  await dialog.getByLabel('Основание сохранённой связи').fill(basis + ' — уточнение');
  await dialog.getByRole('button', { name: 'Сохранить изменения связи' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator('.evidence-card').filter({ hasText: basis + ' — уточнение' }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Экспортировать проект ZIP', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Экспорт проекта ZIP' });
  const downloadLink = exportDialog.getByRole('link', { name: 'Скачать ZIP', exact: true });
  await expect(downloadLink).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await downloadLink.click();
  const archive = await downloaded;
  const archivePath = await archive.path();
  expect(archivePath).not.toBeNull();
  expect((await readFile(archivePath!)).length).toBeGreaterThan(0);
  await exportDialog.getByRole('button', { name: 'Закрыть диалог' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const tools = page.getByRole('group', { name: 'Импорт и экспорт проекта' });
  await expect(tools.getByRole('button', { name: 'Импортировать ZIP', exact: true })).toBeVisible();
  await expect(
    tools.getByRole('button', { name: 'Экспортировать проект ZIP', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await tools.getByRole('button', { name: 'Импортировать ZIP', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Импортировать проект ZIP' });
  await importDialog.getByLabel('Проект ZIP', { exact: true }).setInputFiles({
    name: archive.suggestedFilename(),
    mimeType: 'application/zip',
    buffer: await readFile(archivePath!),
  });
  await importDialog.getByRole('button', { name: 'Импортировать проект ZIP', exact: true }).click();
  const openImported = importDialog.getByRole('link', {
    name: 'Открыть импортированный проект',
    exact: true,
  });
  await expect(openImported).toBeVisible();
  const importedPath = await openImported.getAttribute('href');
  expect(importedPath).not.toBe(`/projects/${data.projectId}`);
  await openImported.click();
  await expect(page).toHaveURL(new RegExp(importedPath! + '$'));
  await expect(page.getByRole('heading', { name: 'Исходные записи' })).toBeVisible();
  await page.getByRole('link', { name: 'Журнал действий', exact: true }).click();
  await expect(
    page.locator('.evidence-card').filter({ hasText: basis + ' — уточнение' }),
  ).toHaveCount(1);
  await mkdir('test-results/integration', { recursive: true });
  await writeFile('test-results/integration/last-run.json', JSON.stringify(data, null, 2));
});
