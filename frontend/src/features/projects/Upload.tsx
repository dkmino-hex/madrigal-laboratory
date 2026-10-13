import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { api } from '../../shared/api/client';
import { queryKey } from '../../shared/api/query';
import { createRequestKey, logicalRequest } from '../../shared/api/transport';
import { Banner, Button, ErrorState, Field } from '../../shared/ui/common';
import { trackJob, JobCard } from '../jobs/Jobs';
import { fileError, timeOffsetInput, timeZoneError } from '../../shared/model/validation';
import { TimeZoneSelect } from '../../shared/ui/TimeZoneSelect';
export function UploadWidget({
  kind,
  projectId,
}: {
  kind: 'capture' | 'project' | 'csv';
  projectId?: string;
}) {
  const [file, setFile] = useState<File>();
  const [timeZone, setTimeZone] = useState('UTC');
  const [offset, setOffset] = useState('0');
  const [job, setJob] = useState<{ projectId: string; jobId: string }>();
  const [notice, setNotice] = useState('');
  const accept = kind === 'capture' ? '.pcap,.pcapng' : kind === 'project' ? '.zip' : '.csv';
  const uploadProblem = fileError(file, accept.split(','));
  const offsetInput = timeOffsetInput(offset);
  const timeProblem = kind === 'csv' ? (timeZoneError(timeZone) ?? offsetInput.error) : undefined;
  const fileKey = useRef(createRequestKey());
  const getKey = useRef(logicalRequest());
  const client = useQueryClient();
  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      if (!file) throw new Error('Выберите файл');
      if (uploadProblem || timeProblem) throw new Error(uploadProblem ?? timeProblem);
      const operation =
        kind === 'capture'
          ? 'uploadCapture'
          : kind === 'project'
            ? 'importProject'
            : 'importActions';
      const options = {
        file,
        idempotencyKey: getKey.current(operation, {
          fileKey: fileKey.current,
          projectId,
          ...(kind === 'csv' ? { timeZone, offsetNanoseconds: offsetInput.value! } : {}),
        }),
      };
      if (kind === 'capture') return api.uploadCapture({ projectId: projectId! }, options);
      if (kind === 'project')
        return api.importProject({ name: 'Перенесённое исследование' }, options);
      return api.importActions(
        { projectId, timeZone, offsetNanoseconds: offsetInput.value! },
        options,
      );
    },
    onSuccess: async (result) => {
      if ('job' in result) {
        const resourceProject = result.project?.projectId ?? projectId!;
        trackJob(resourceProject, result.job.jobId);
        setJob({ projectId: resourceProject, jobId: result.job.jobId });
        setNotice(
          result.duplicate
            ? 'Запись с тем же содержимым уже существует. Дубликат подтверждён ответом сервера.'
            : 'Передача завершена. Файл принят; обработка выполняется отдельно.',
        );
      } else {
        setNotice(
          'Импортировано строк: ' +
            result.imported +
            (result.partial ? '. Частичный импорт. ' : '. ') +
            result.errors.map((error) => 'Строка ' + error.row + ': ' + error.reason).join('; '),
        );
      }
      await client.invalidateQueries({
        queryKey: queryKey(
          projectId ?? 'all',
          kind === 'csv' ? 'actions' : kind === 'project' ? 'projects' : 'captures',
        ),
      });
      if (projectId) await client.invalidateQueries({ queryKey: queryKey(projectId, 'project') });
    },
  });
  const label =
    kind === 'capture' ? 'Запись PCAP / PCAPNG' : kind === 'project' ? 'Проект ZIP' : 'Журнал CSV';
  return (
    <div className="upload-widget">
      <Field
        label={label}
        error={uploadProblem}
        hint={
          kind === 'project'
            ? 'Версию, хеши и ссылки проверяет Workspace. Незавершённый импорт не готов для исследования.'
            : 'Передача и обработка — отдельные этапы. Файл передаётся без base64.'
        }
      >
        {(id, info) => (
          <input
            id={id}
            aria-describedby={info}
            type="file"
            accept={accept}
            disabled={mutation.isPending}
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              fileKey.current = createRequestKey();
              getKey.current = logicalRequest();
              setNotice('');
              mutation.reset();
            }}
          />
        )}
      </Field>
      {file && (
        <p className="mono">
          {file.name} · {file.size.toLocaleString('ru-RU')} байт
        </p>
      )}
      {kind === 'csv' && (
        <div className="form-grid">
          <TimeZoneSelect
            label="Часовой пояс журнала"
            value={timeZone}
            disabled={mutation.isPending}
            onChange={(value) => {
              setTimeZone(value);
              mutation.reset();
              setNotice('');
            }}
          />
          <Field
            label="Поправка времени, наносекунды"
            error={offsetInput.error}
            hint="Целое число; знак минус сдвигает время назад. 1 секунда = 1 000 000 000 нс."
          >
            {(id) => (
              <input
                id={id}
                inputMode="text"
                value={offset}
                disabled={mutation.isPending}
                onChange={(event) => {
                  setOffset(event.target.value);
                  mutation.reset();
                  setNotice('');
                }}
              />
            )}
          </Field>
        </div>
      )}
      <Button
        variant="primary"
        disabled={!file || !!uploadProblem || !!timeProblem || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        <Upload size={15} aria-hidden="true" />
        {mutation.isPending
          ? 'Передача файла…'
          : kind === 'csv'
            ? 'Импортировать журнал'
            : kind === 'project'
              ? 'Импортировать проект ZIP'
              : 'Добавить запись'}
      </Button>
      {mutation.isPending && (
        <div role="status">
          <progress aria-label="Передача файла, точный прогресс недоступен" />
          <p>Передача файла. Точный процент недоступен.</p>
        </div>
      )}
      {notice && <Banner tone={notice.includes('Частичный') ? 'warning' : 'info'}>{notice}</Banner>}
      {mutation.error && <ErrorState error={mutation.error} />}
      {job && <JobCard {...job} />}
    </div>
  );
}
