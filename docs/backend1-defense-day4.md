# Backend 1 — показ дня 4

1. После готовой сборки открыть `GET {{captureBase}}/api/v1/projects/{{projectId}}/streams/{{streamId}}/search?assemblyId={{assemblyId}}&mode=HEX&pattern=00` и проверить `items`, `nextCursor`. Нечётный HEX даёт `INVALID_PATTERN`.
2. Создать Capture snapshot через `POST /internal/v1/projects/{{projectId}}/snapshots` с `{}` и скачать `/internal/v1/snapshots/{{captureSnapshotId}}/archive`; внутри есть `manifest.json`, `originals/` и `data/`.
3. При доступном Analysis запустить `POST {{workspaceBase}}/api/v1/projects/{{projectId}}/exports`, дождаться `SUCCEEDED` по `ws_` job и скачать ZIP через `/api/v1/artifacts/{{artifactId}}`.
4. Отправить этот ZIP в `POST {{workspaceBase}}/api/v1/projects/import` как form-data `file`; сохранить `importId` и `projectId`. До конца работы `GET /projects/{{projectId}}` показывает `IMPORTING`.
5. Повторить импорт с тем же `importId`: новый проект не создаётся. Повреждённый ZIP отвергается до создания проекта. При отключённом Analysis проект остаётся `ERROR`, а повтор после восстановления сервиса завершает его.
6. Для отчёта передать завершённый `runId` в `POST .../reports`; дождаться job и скачать Markdown через `/artifacts/{artifactId}`.

Реальная проверка шагов 3–6 требует работающего Analysis Backend 2. До его подключения они проверены тестовым HTTP-ответом с тем же контрактом.
