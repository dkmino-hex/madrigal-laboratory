import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, FileArchive } from 'lucide-react';
import { api } from '../../shared/api/client';
import { usePagedChoices } from '../../shared/api/paged-choices';
import { queryKey, useCommand } from '../../shared/api/query';
import { Banner, Button, ErrorState, Loading, Modal } from '../../shared/ui/common';
import { DownloadLink } from '../../shared/ui/DownloadLink';
import { JobCard, jobQuery, terminalJob, trackJob } from '../jobs/Jobs';
import { UploadWidget } from './Upload';

export function ImportProjectButton() {
  return (
    <Modal
      title="Импортировать проект ZIP"
      description="Выбери ZIP, сохранённый через экспорт. Восстановится отдельный проект с записями, схемами, наблюдениями и результатами проверки."
      trigger={
        <Button>
          <FileArchive size={16} aria-hidden="true" />
          Импортировать ZIP
        </Button>
      }
    >
      <UploadWidget kind="project" />
    </Modal>
  );
}

function ExportProjectButton({ projectId, ready }: { projectId: string; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const command = useCommand(
    'exportProject',
    (id: string, options) => api.exportProject(id, options),
    [queryKey(projectId, 'artifacts')],
  );
  const jobId = command.isPending ? undefined : command.data?.job.jobId;
  const job = useQuery({ ...jobQuery(projectId, jobId ?? ''), enabled: !!jobId });
  const busy = !!jobId && (!job.data || !terminalJob(job.data.status));
  const archives = usePagedChoices(
    projectId,
    'artifacts',
    (cursor, signal) => api.artifacts({ projectId, cursor, limit: 100 }, { signal }),
    { exportJobId: jobId },
    job.data?.status === 'COMPLETED',
    job.data?.resourceId ?? command.data?.artifact?.artifactId ?? '',
    (item) => item.jobId === jobId,
  );
  const archive = archives.data?.items.find(
    (item) => item.jobId === jobId && item.kind === 'project',
  );
  function start() {
    setOpen(true);
    if (busy || command.isPending) return;
    command.mutate(projectId, { onSuccess: (result) => trackJob(projectId, result.job.jobId) });
  }
  return (
    <>
      <Button
        disabled={!ready || command.isPending}
        onClick={start}
        aria-label="Экспортировать проект ZIP"
      >
        <Download size={16} aria-hidden="true" />
        {busy ? 'Экспорт ZIP: готовится…' : 'Экспортировать проект ZIP'}
      </Button>
      <Modal
        title="Экспорт проекта ZIP"
        description="Архив содержит исходные записи, журнал действий, настройки, схемы, наблюдения, источники и результаты проверки. Его можно импортировать обратно."
        open={open}
        onOpenChange={setOpen}
      >
        {command.isPending && <Loading text="Запрос на подготовку архива…" />}
        {command.error && <ErrorState error={command.error} />}
        {jobId && <JobCard projectId={projectId} jobId={jobId} />}
        {job.data?.status === 'COMPLETED' && (
          <>
            {(archives.isPending || archives.resolving) && <Loading text="Поиск готового ZIP…" />}
            {(archives.error ?? archives.paginationError) && (
              <ErrorState
                error={archives.error ?? archives.paginationError}
                retry={() => void archives.refetch()}
              />
            )}
            {archive?.status === 'READY' && archive.downloadUrl ? (
              <div className="project-export-download">
                <Banner tone="success">
                  Архив готов. Скачай ZIP и сохрани его для переноса или восстановления.
                </Banner>
                <DownloadLink
                  path={archive.downloadUrl}
                  name={archive.name}
                  contentType={archive.contentType}
                >
                  Скачать ZIP
                </DownloadLink>
              </div>
            ) : (
              !archives.isPending &&
              !archives.resolving &&
              !archives.error && (
                <Banner tone="warning">
                  Готовый файл пока недоступен. Открой список файлов проекта или обнови его
                  состояние.
                </Banner>
              )
            )}
          </>
        )}
        {(command.error ||
          (job.data && ['FAILED', 'CANCELLED', 'INTERRUPTED'].includes(job.data.status))) && (
          <Button disabled={command.isPending} onClick={start}>
            Повторить экспорт
          </Button>
        )}
        <p className="muted">
          Подготовка продолжается, даже если закрыть окно. Готовые архивы остаются в «Отчётах и
          переносе».
        </p>
        <Link to={'/projects/' + projectId + '/artifacts'} onClick={() => setOpen(false)}>
          Открыть все файлы проекта →
        </Link>
      </Modal>
    </>
  );
}

export function ProjectTransferActions({
  projectId,
  ready,
}: {
  projectId: string;
  ready: boolean;
}) {
  return (
    <div className="project-transfer-bar" role="group" aria-label="Импорт и экспорт проекта">
      <span className="muted">Архив проекта</span>
      <ImportProjectButton />
      <ExportProjectButton projectId={projectId} ready={ready} />
    </div>
  );
}
