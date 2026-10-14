# Backend 1 — результат второго дня, 13.10.2026

Основание: `Мадригал_итог_16_октября.docx`, раздел «13 октября 2026», и `Мадригал — микросервисы и API.md`. Наша зона — только Workspace и Capture. Работа выполнена в существующем проекте `D:\Проекты\madrigal-laboratory`, поверх SQLite-хранилищ и очереди первого дня. Gateway, Analysis и UI здесь не реализовывались.

## Что сделано

| Задача | Результат |
|---|---|
| WS-03 | `PATCH /projects/{projectId}/settings` создаёт неизменяемую версию с `Idempotency-Key`. `GET /internal/v1/projects/{projectId}/context?settingsVersion=current` или с конкретным ID подтверждает проект и возвращает закреплённую версию; старые версии доступны. |
| CAP-03 | Multipart-загрузка PCAP/PCAPNG через `POST /captures`: оригинал сохраняется потоково, считается SHA-256, повтор содержимого явно возвращает `duplicate: true`; capture и импортный job записываются одной транзакцией. Есть список с состояниями. |
| CAP-04/05 | Worker читает PCAP/PCAPNG, индексирует пакеты с `packetNo` от 1, временем до наносекунд, длинами, interface/link type, кадром и диагностикой. `GET /captures/{captureId}/packets/{packetNo}` возвращает исходный кадр и разобранные TCP-поля. |
| CAP-06/07 | TCP-пакеты разделены на поколения соединения и направления A→B/B→A. Payload размещается по sequence number, включая перестановку, переход через `2^32` и одинаковые ретрансляции. SYN/FIN/RST и неизвестное начало отмечаются в логике/диагностике. |
| CAP-08 | SourceMap хранит полуоткрытые диапазоны потока и исходного кадра для каждого известного байта. Повторная передача сохраняется как дополнительный источник. Пропуск — `GAP`, несовпадающее перекрытие — `CONFLICT` с альтернативами. |
| CAP-11 | Первый assembly создаётся при импорте и закрепляет `settingsVersion` и JSON настроек. `POST /captures/{captureId}/assemblies` ставит повторную сборку в очередь для явно указанной версии; `GET .../assemblies` перечисляет версии. Старые версии и их `streamId` сохраняются. |
| CAP-12/13 | Список sessions с `captureId`, `assemblyId`, временем, IP, портом и пагинацией; карточка соединения; ограниченное чтение `/bytes` и `/sources` с явным `assemblyId`, `offset`, `length`. Интервалы и источники читаются из SQLite. |
| CAP-15 | Внутренний `POST /internal/v1/projects/{projectId}/assembly-views` атомарно закрепляет диапазоны только готовых сборок. `GET /internal/v1/assembly-views/{viewId}/data` отдаёт блоки интервалов и SourceMap с cursor/limit. Запросы используют context для отмены. |

Префикс публичных ручек — `/api/v1`. Названия и владение ручками соответствуют API-документу. Бинарные `frame`, `data` и альтернативы в JSON кодируются base64. Смещения в запросе и ответе — полуоткрытые диапазоны `[start,end)`; `packetNo` начинается с 1, `frameStart` — с 0. Чтение одного диапазона ограничено 1 МиБ.

## Где код

- `services/workspace-service/projects/settings.go`, `services/workspace-service/api/api.go` — настройки и внутренний context.
- `services/capture-service/reassembly/reader.go`, `tcp.go`, `model.go` — reader, соединения, байты и SourceMap.
- `services/capture-service/captures/import.go` — индекс и сборки в SQLite, worker.
- `services/capture-service/api/capture.go`, `streams.go`, `views.go` — публичные и внутренние ручки.
- `services/capture-service/api/day2_test.go` — приёмочный сценарий на всех 12 файлах.

## Как запустить и показать

Из `D:\Проекты\madrigal-laboratory` запустить в двух терминалах:

```powershell
go run ./cmd/workspace-service
go run ./cmd/capture-service
```

Адреса по умолчанию: Workspace `127.0.0.1:8081`, Capture `127.0.0.1:8082`. Capture обращается к Workspace через `WORKSPACE_INTERNAL_URL` (по умолчанию `http://127.0.0.1:8081`). Используются отдельные файлы `data/workspace/workspace.sqlite` и `data/capture/capture.sqlite`, оригиналы — `data/capture/objects`. Сначала создаётся проект, затем загружается запись:

```powershell
$headers = @{ 'Idempotency-Key' = 'demo-project-13-oct' }
$project = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8081/api/v1/projects' -Headers $headers -ContentType 'application/json' -Body '{"name":"Day 2 demo"}'
$base = "http://127.0.0.1:8082/api/v1/projects/$($project.projectId)"
$file = 'D:\Проекты\madrigal-laboratory\testdata\sample_protocol\research\01_configuration.pcap'
$upload = curl.exe -sS -F "file=@$file" "$base/captures" | ConvertFrom-Json
$job = Invoke-RestMethod "http://127.0.0.1:8082/api/v1/jobs/$($upload.jobId)"
while ($job.status -in @('QUEUED','RUNNING')) { Start-Sleep -Milliseconds 200; $job = Invoke-RestMethod "http://127.0.0.1:8082/api/v1/jobs/$($upload.jobId)" }
$sessions = Invoke-RestMethod "$base/sessions?captureId=$($upload.captureId)"
$sessions.items | Select-Object sessionId,assemblyId,generation
$assembly = (Invoke-RestMethod "$base/captures/$($upload.captureId)/assemblies").items[0].assemblyId
$detail = Invoke-RestMethod "$base/sessions/$($sessions.items[0].sessionId)?assemblyId=$assembly"
$stream = $detail.streams[0].streamId
Invoke-RestMethod "$base/streams/$stream/sources?assemblyId=$assembly&offset=2&length=2"
```

Для новой версии настроек: `PATCH /api/v1/projects/{projectId}/settings` в Workspace с JSON `{"settings":{...}}` и новым `Idempotency-Key`; затем `POST /api/v1/projects/{projectId}/captures/{captureId}/assemblies` в Capture с `{"settingsVersion":"set_..."}`. Ответ `202` содержит `assemblyId` и `jobId`. Старую сборку можно запросить по прежнему ID.

## Проверка на корпусе

`go test ./services/capture-service/api -run TestDay2CaptureAPIOnReferenceCorpus -count=1 -v` загружает и индексирует все 12 PCAP/PCAPNG из `testdata/sample_protocol`, проверяет первую сборку, исходный пакет, список/карточку sessions, bytes/sources, конфликт, повторную assembly и внутренний view. У baseline 158 пакетов и два поколения одного 4-tuple. Для диапазона `[2,4)` SourceMap указывает пакет 4 `[56,57)` и пакет 6 `[54,55)`. Проверки `go test ./...`, `go vet ./...`, `go build ./...` выполняются из корня проекта.

## Границы результата

Применение произвольных ключей настроек к поведению TCP-движка ещё не реализовано: версия и точный JSON сохраняются для воспроизводимости, текущий алгоритм сборки фиксирован. Reader поддерживает Ethernet/IPv4/TCP; неподдержанный link type и усечённые заголовки диагностируются, но IPv6, IP-фрагментация, полная checksum-политика и очень длинные потоки через несколько эпох sequence number не закрыты. Подтверждение на 12 файлах не равно испытанию максимального профиля 100 МиБ/250000 пакетов. Критерии Gateway/Analysis/UI относятся к другим исполнителям.
