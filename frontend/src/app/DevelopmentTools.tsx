import { useState } from 'react';
import { config } from './config';
import { Button, Modal } from '../shared/ui/common';
import { stopOwnMockWorker } from './mock-lifecycle';
import { DownloadLink } from '../shared/ui/DownloadLink';
export function DevelopmentTools() {
  const [open, setOpen] = useState(false);
  if (!import.meta.env.DEV) return null;
  return (
    <div className="development-tools">
      <details>
        <summary>Инструменты разработки</summary>
        <div className="toolbar">
          <Button
            onClick={() => {
              void stopOwnMockWorker().then(() => {
                const url = new URL(location.href);
                url.searchParams.set('mode', config.mode === 'mock' ? 'api' : 'mock');
                location.assign(url.href);
              });
            }}
          >
            Переключить в {config.mode === 'mock' ? 'API' : 'mock'}
          </Button>
          {config.mode === 'mock' && (
            <>
              <DownloadLink
                path="/__madrigal_mock/example/pcap"
                name="synthetic.pcap"
                contentType="application/octet-stream"
              >
                Скачать синтетический PCAP
              </DownloadLink>
              <DownloadLink
                path="/__madrigal_mock/example/pcapng"
                name="synthetic.pcapng"
                contentType="application/octet-stream"
              >
                Скачать синтетический PCAPNG
              </DownloadLink>
              <Button variant="ghost" onClick={() => setOpen(true)}>
                Сбросить demo-state
              </Button>
            </>
          )}
        </div>
        <p>
          Эта панель присутствует только в dev. Моки используют временные frontend DTO. Загруженный
          произвольный файл не анализируется.
        </p>
      </details>
      <Modal
        title="Сбросить демонстрационные данные?"
        description="Будут удалены только изменения синтетического demo-state этого frontend. Реальные проекты хранятся на backend."
        open={open}
        onOpenChange={setOpen}
      >
        <Button
          variant="danger"
          onClick={() => {
            void import('../mocks/state').then(({ resetState }) => {
              resetState();
              location.assign('/projects');
            });
          }}
        >
          Сбросить demo-state
        </Button>
      </Modal>
    </div>
  );
}
