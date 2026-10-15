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
        const evidence = await api.saveEvidence(
          {
            projectId,
            location,
            sources,
            kind: 'support',
            status: 'tentative',
            basis: 'Исходные байты',
            actionId: actions.items[0]!.actionId,
          },
          key(),
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
        return {
          projectId,
          restoredId,
          runId: run.runId,
          location,
          messages: run.summary.messages,
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
  const source = new URLSearchParams(data.location);
  await page.goto(`${gateway}/projects/${data.projectId}/traffic?${source}`);
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.locator('.source-packet').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('grid')).toBeVisible();
  await mkdir('test-results/integration', { recursive: true });
  await writeFile('test-results/integration/last-run.json', JSON.stringify(data, null, 2));
});
