# Проверка Workspace и Capture в Postman

1. Запустите `go run ./cmd/workspace-service` и `go run ./cmd/capture-service` в двух терминалах из корня проекта. Проверьте `GET http://127.0.0.1:8081/readyz` и `GET http://127.0.0.1:8082/readyz`.
2. Перетащите `madrigal-backend1.postman_collection.json` в окно Postman и подтвердите импорт. Коллекция содержит свои переменные `workspaceBase` и `captureBase`; Environment выбирать не нужно.
3. Выполняйте запросы в папках `01`–`05` по порядку. `Create project` сохранит `projectId`. В `Upload PCAP or PCAPNG` откройте **Body → form-data → file**, выберите `testdata/sample_protocol/research/01_configuration.pcap` и нажмите **Send**. Не задавайте `Content-Type` вручную.
4. Повторяйте `Get import job`, пока `status` не станет `SUCCEEDED`. Затем выполните `List assemblies`, `List sessions`, `Get session`, `Read stream bytes` и `Read SourceMap`. Для baseline ожидаются 158 пакетов и два поколения TCP-соединения.
5. Папка `04` создаёт новую версию настроек и повторную assembly. После завершения второго job в списке остаются обе сборки. Папка `05` проверяет внутренний assembly-view.
6. В папке `06` выберите `testdata/sample_protocol/action_journal.csv` для импорта действий. После `Workspace job` со статусом `SUCCEEDED` откройте `Actions`, создайте и измените наблюдение. Папка `07` содержит поиск HEX/ASCII и диагностику checksum.
7. Папки `08`–`09` содержат Capture snapshot, проектный ZIP, восстановление и Markdown-отчёт. Для проектного ZIP и отчёта нужен работающий Analysis Backend 2 по `ANALYSIS_INTERNAL_URL`; без него job завершится ошибкой и артефакт не будет опубликован.

Ответ загрузки имеет статус HTTP 202: это означает, что импорт поставлен в очередь, а не что он уже завершён. Если запросы к Capture дают ошибку подключения к Workspace, проверьте, что Workspace запущен на 8081 или установлена верная переменная `WORKSPACE_INTERNAL_URL`.

## Добавление недостающих запросов вручную

Если коллекция `Madrigal` собрана вручную, откройте сохранённый запрос **Assemblies**, вставьте URL `{{captureBase}}/api/v1/projects/{{projectId}}/captures/{{captureId}}/assemblies`, выберите GET и нажмите **Save**. Для трёх остальных запросов нажмите `+` рядом с Collections → HTTP и сохраните их в `Madrigal`:

| Метод | URL | Header и Body |
|---|---|---|
| PATCH | `{{workspaceBase}}/api/v1/projects/{{projectId}}/settings` | `Idempotency-Key: settings-1`; Body → raw → JSON: `{"settings":{"demo":"postman"}}`. Из ответа сохраните `settingsVersion`. |
| GET | `{{workspaceBase}}/internal/v1/projects/{{projectId}}/context?settingsVersion=current` | Body не нужен. Вместо `current` можно подставить конкретный `{{settingsVersion}}`. |
| POST | `{{captureBase}}/api/v1/projects/{{projectId}}/captures/{{captureId}}/assemblies` | Body → raw → JSON: `{"settingsVersion":"{{settingsVersion}}"}`. Выполняйте после того, как capture станет READY. Ответ 202 содержит новый `assemblyId` и `jobId`. |

После POST новой сборки вызовите `GET {{captureBase}}/api/v1/jobs/{{jobId}}` до `SUCCEEDED`, затем повторите GET Assemblies: список должен содержать прежнюю и новую версии.
