# Структура Madrigal

В репозитории реализованы три предметных контекста: Capture, Workspace и Analysis. У каждого отдельный Go-модуль, приложение, миграции и приватная SQLite. Gateway — отдельный технический модуль; Frontend сохраняет собственную Node-сборку. Корневой `go.work` объединяет Go-модули для разработки; `replace` позволяет собирать каждый сервис с `GOWORK=off`.

```text
madrigal/
├── go.work
├── go.mod                         # CLI и проверки архитектуры
├── cmd/                           # сохранённые команды запуска и утилиты
├── contracts/http-routes.json      # маршруты до рефакторинга
├── platform/                      # отдельный технический Go-модуль
│   ├── database/                  # SQLite и проверка миграций
│   ├── httpapi/                   # ошибки, JSON, requestId, health
│   ├── identifier/
│   ├── jobs/                      # очередь в БД владельца
│   ├── service/                   # общий жизненный цикл HTTP и workers
│   └── testdatabase/
├── services/
│   ├── capture-service/
│   │   ├── go.mod
│   │   ├── cmd/
│   │   ├── bootstrap/             # конфигурация и соединение зависимостей
│   │   ├── migrations/            # неизменённая история SQL
│   │   └── internal/
│   │       ├── domain/            # модели, правила, восстановление TCP
│   │       ├── application/       # импорт, сборки, перенос; интерфейсы портов
│   │       └── adapters/
│   │           ├── inbound/http/
│   │           └── outbound/     # sqlite, filestore, pcap, workspacehttp
│   ├── workspace-service/
│   │   ├── go.mod
│   │   ├── cmd/
│   │   ├── bootstrap/
│   │   ├── migrations/
│   │   └── internal/
│   │       ├── domain/            # проекты, настройки, наблюдения, источники
│   │       ├── application/       # журнал, отчёт, экспорт и импорт; порты
│   │       └── adapters/
│   │           ├── inbound/http/
│   │           └── outbound/     # sqlite, capturehttp, peerhttp
│   ├── analysis-service/
│   │   ├── go.mod
│   │   ├── cmd/analysis/
│   │   ├── bootstrap/
│   │   ├── migrations/            # исходная история Analysis up/down
│   │   └── internal/
│   │       ├── domain/            # интерпретации, ревизии, runs, чистый parser
│   │       ├── application/analysis/ # сценарии и интерфейсы портов
│   │       └── adapters/
│   │           ├── inbound/http/
│   │           └── outbound/     # sqlite, capturehttp, workspacehttp
│   └── gateway-service/
│       ├── go.mod
│       ├── cmd/gateway/
│       ├── bootstrap/
│       └── internal/adapters/
│           ├── inbound/http/     # публичные маршруты, CORS, выбор jobs
│           └── outbound/proxy/   # HTTP reverse proxy
├── frontend/                     # собственные package.json и lockfile
├── scripts/check.ps1
├── scripts/check.sh
├── compose.yaml
└── testdata/
```

## Правила зависимостей

`domain` содержит предметные модели и правила. Он не импортирует HTTP, SQL, файловую систему, `platform`, сценарии или адаптеры. Модели каждого контекста принадлежат только ему.

`application` координирует сценарии через интерфейсы хранилищ и соседних сервисов. SQL-запросы и сетевые вызовы находятся в адаптерах. Локальные транзакции, создание предметной записи вместе с job, защита идемпотентности и восстановление после рестарта остаются внутри хранилища владельца. Читающие методы возвращают готовые представления API; отдельные обёртки для простого перенаправления вызовов не добавляются.

`bootstrap` выбирает конкретные адаптеры и конфигурацию. Корневые команды запускают его публичные функции; самостоятельные команды внутри модулей используют ту же сборку зависимостей. HTTP и workers отменяются и завершаются вместе, в том числе при отказе одного компонента.

`platform` содержит только технические средства. Общих сущностей Project, Capture, Assembly или Interpretation в нём нет. Общая реализация jobs работает с приватной БД каждого сервиса.

Продакшен-код одного сервиса не импортирует реализацию другого. Capture зависит от модуля Workspace только для теста взаимодействия через HTTP; этот тест создаёт независимые временные хранилища. В сборке Capture зависимости от реализации Workspace нет.

## Взаимодействие компонентов

Analysis сохраняет собственные модели интерпретаций и результатов. Его чистый parser находится в `domain/engine`; `application/analysis` работает с интерфейсами Repository, Capture и Workspace. SQL и сетевые клиенты находятся в outbound-адаптерах; HTTP-обработчики не импортируют их. Создание и восстановление ZIP выполняет application-сценарий Snapshots. Фоновые runs отменяются и завершаются перед закрытием SQLite.

Analysis получает закреплённые диапазоны через Capture `/internal/v1/.../assembly-views`, а версии настроек — через Workspace `/internal/v1/projects/{projectId}/context`. Экспорт, импорт и отчёты Workspace обращаются к Analysis через адаптер `peerhttp` и `ANALYSIS_INTERNAL_URL`.

Gateway маршрутизирует публичные API и jobs по владельцу. Его `bootstrap` соединяет входной HTTP-router с исходящими proxy; предметные сущности и фиктивные DDD-слои ему не добавляются. Frontend находится в `frontend/` и должен обращаться к публичному Gateway. Карта его реальных операций пока не согласована; текущее поведение mock/API сохранено из исходной ветки.

Контракты маршрутов, JSON, идентификаторы, диапазоны байтов и файловые форматы сохранены. `contracts/http-routes.json` зафиксирован по исходникам до переноса и проверяется автоматически: 20 маршрутов Capture и 19 Workspace, включая health/readiness и отдельную регистрацию jobs у обоих владельцев. Содержимое существующих SQL-миграций не менялось.

## Проверка

`scripts/check.ps1` или `sh scripts/check.sh` запускает тесты, `go vet` и сборку всех шести Go-модулей. Проверяются границы зависимостей всех четырёх служб и сохранность маршрутов Capture/Workspace, HTTP-сценарии, весь приложенный корпус PCAP/PCAPNG, SourceMap, конфликты и пропуски, версии сборок, очередь и отмена, идемпотентность, миграции, сохранность после рестарта и перенос исследований.

Исходные тесты Analysis сохранены; добавлены проверки application-сценария snapshot/restore и отмены активных и ожидающих runs при остановке. Результаты общего запуска, Frontend и ограничения дальнейшей интеграции записаны в `docs/integration.md`.
