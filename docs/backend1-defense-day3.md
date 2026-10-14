# Backend 1 — показ дня 3

1. Создать проект через `POST {{workspaceBase}}/api/v1/projects` с `Idempotency-Key`.
2. В `POST {{workspaceBase}}/api/v1/projects/{{projectId}}/action-log` выбрать Body → form-data: `file` = `testdata/sample_protocol/action_journal.csv`, `timezone` = `UTC`, `timeOffsetNs` = `0`. Ответ `202` содержит `jobId`.
3. Дождаться `SUCCEEDED` через `GET {{workspaceBase}}/api/v1/jobs/{{jobId}}`. В `GET .../actions?limit=10&type=read-config` показать исходные параметры и `incompleteImports: 0`.
4. Создать `HYPOTHESIS` через `POST .../observations`, связать с полученным `actionId`; затем PATCH статуса. При evidence с неверным captureId или выходом за границу кадра сервис вернёт 400.
5. Запросить `POST /internal/v1/projects/{{projectId}}/snapshots` и показать `metadataSha256`. Попытка изменить таблицу `snapshots` отвергается SQLite-триггером.
6. В Capture открыть диагностические записи: `missing_segment` показывает `GAP`, `conflicting_overlap` — альтернативы, `checksum_offload`/`bad_checksum` — разные статусы пакетов.

Команда проверки: `go test ./...`. Ориентир — приложенный корпус, без TODO-раздела Postman.
