# Мадригал — общая рабочая область

Ветка `integration/all-services` объединяет `backend/capture`, `backend/analysis-workspace` и `frontend/app`. Capture/Workspace включают локальные коммиты рефакторинга `fe3f427` и `6e6dc1e`. Рабочая копия `madrigal-laboratory` при объединении не изменялась.

Четыре Go-сервиса запускаются вместе:

```powershell
docker compose up --build -d --wait
```

Gateway доступен на `127.0.0.1:8080`, Workspace — `8081`, Capture — `8082`, Analysis — `8083`. Порты должны быть свободны. Compose-проект называется `madrigal-integration`; у каждой службы свой том, отдельный от прежнего проекта `madrigal`. Все публикации ограничены localhost. Для ручной проверки Workspace/Capture есть [коллекция Postman](postman/madrigal-backend1.postman_collection.json) и [инструкция](postman/README.md).

Capture, Workspace, Analysis и Gateway имеют отдельные `go.mod`; локальная разработка объединена через `go.work`. Предметные сервисы разделены на `domain`, `application` и `adapters`. Gateway содержит HTTP-маршрутизацию и прокси, Frontend — собственную Node-сборку в `frontend/`. Общий технический код находится в `platform`; корневой модуль содержит CLI и проверки архитектуры. Подробности — в [архитектуре](docs/architecture.md).

Сценарии проверки Capture/Workspace перечислены в [отчёте](docs/refactoring-verification.md). Состав объединённых веток, проверки и оставшиеся ограничения интеграции — в [отчёте объединения](docs/integration.md).

Каждый сервис собирается самостоятельно:

```powershell
cd services/capture-service
$env:GOWORK = 'off'
go build ./cmd/capture-service
```

Аналогично собираются `services/workspace-service` (`./cmd/workspace-service`), `services/analysis-service` (`./cmd/analysis`) и `services/gateway-service` (`./cmd/gateway`). После самостоятельной сборки удалите переменную `GOWORK` из окружения, чтобы вернуться к общей рабочей области. Корневые команды `go run ./cmd/<имя>` также сохранены; адреса соседей при запуске вне Docker задаются окружением.

Для Go выполните `./scripts/check.ps1` или `sh scripts/check.sh`: тесты, `go vet` и сборка охватывают корень, `platform` и все четыре сервисных модуля. Для Frontend необходим Node.js 22.12 или новее:

```powershell
cd frontend
npm ci
npm run verify
npm run dev:mock
```

Frontend пока работает с подготовленным mock-контрактом. Его `gateway-mapping.json` не заполнен; реальный API включается отдельным этапом согласования DTO. Подробности запуска и ограничений — в [инструкции Frontend](frontend/README.md).

Отчёты по плановым дням Backend 1: [14 октября](docs/backend1-day3.md), [15 октября](docs/backend1-day4.md), [16 октября](docs/backend1-day5.md). Для показа есть отдельные файлы `docs/backend1-defense-day3.md`, `docs/backend1-defense-day4.md`, `docs/backend1-defense-day5.md`.

Workspace вызывает Analysis через `ANALYSIS_INTERNAL_URL`; в Compose указан `http://analysis-service:8083`. Gateway направляет публичные API и jobs владельцу, а внутренние API используются сервисами напрямую.
