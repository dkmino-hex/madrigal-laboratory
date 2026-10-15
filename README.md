# Мадригал

Общая рабочая область Capture, Workspace, Analysis, Gateway и Frontend. Ветка `integration/all-services` сохраняет историю исходных веток. Все изменения выполнены в `D:\Проекты\madrigal`; рабочая копия `madrigal-laboratory` остаётся отдельно.

```powershell
docker compose up --build -d --wait
```

Открыть **http://127.0.0.1:8080/projects**. Gateway раздаёт production Frontend и публичное API. Сервисы используют собственные SQLite и тома проекта `madrigal-integration`; внешние API не нужны. При первом запуске Docker скачивает образы и зависимости сборки.

В предметных сервисах принята единая структура `domain → application → adapters`, зависимости соединяет `bootstrap`. У каждого сервиса свой Go-модуль. Gateway содержит маршрутизацию, HTTP proxy и раздачу SPA. Frontend имеет собственную Node-сборку и преобразует HTTP DTO в проверяемые модели интерфейса. Общие технические средства находятся в `platform`; корень содержит команды, контракты и проверки архитектуры. Подробности — в [архитектуре](docs/architecture.md).

Публичный контракт — [contracts/gateway.openapi.json](contracts/gateway.openapi.json), доступен также через Gateway `/openapi.json`. Карта 38 операций интерфейса и вспомогательных HTTP-запросов находится в `frontend/src/shared/api/contracts/gateway-mapping.json`.

Начни с [подробного руководства](docs/user-guide.md): загрузка учебных записей и журнала, автоматическое сравнение, наблюдения, создание схемы и независимая проверка. [Сверка с требованиями PDF](docs/requirements-audit.md) отделяет проверенные функции от оставшихся ограничений. [Автоматика](docs/research-automation.md), [формат схемы](docs/analysis-schema.md).

```powershell
./scripts/check.ps1
cd frontend
npm ci
npm run verify
```

`check.ps1` проверяет тесты, `go vet` и сборку всех шести Go-модулей. `verify` проверяет типы, lint, воспроизводимость OpenAPI-типов, состав репозитория, unit/component-тесты и production build.

Полная проверка реальных сервисов через клиент и браузер:

```powershell
$env:MADRIGAL_GATEWAY_URL = 'http://127.0.0.1:8080'
# Windows с установленным Edge: $env:MADRIGAL_BROWSER_CHANNEL = 'msedge'
npm run test:e2e:integration
npm run test:e2e:research
```

Тест сам запускает Vite на `localhost:5173`, создаёт отдельные тестовые проекты и проверяет загрузку PCAP/PCAPNG, журнал, доказательства, гипотезы, ревизии, preview, анализ двух записей, отчёт, ZIP и восстановление в ту же базу. Затем проверяет production-интерфейс Gateway и reload ссылки на пакет. Данные теста остаются в отдельном Compose-проекте.

Каждый сервис можно собирать самостоятельно, например: `cd services/capture-service`, затем `GOWORK=off go build ./cmd/capture-service` (в PowerShell: `$env:GOWORK='off'`). Корневые команды `go run ./cmd/<имя>` сохранены.

[Результаты интеграции](docs/integration.md), [Frontend](frontend/README.md), [проверки Capture/Workspace](docs/refactoring-verification.md), [Postman](postman/README.md).
