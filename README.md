# Мадригал — Backend 1

Реализованы Workspace и Capture. Из корня репозитория запустите их в двух терминалах:

```powershell
go run ./cmd/workspace-service
go run ./cmd/capture-service
```

Workspace слушает `127.0.0.1:8081`, Capture — `127.0.0.1:8082`. Полная проверка всех Go-модулей: `./scripts/check.ps1` в PowerShell или `sh scripts/check.sh` в Linux. Для ручной проверки импортируйте [коллекцию Postman](postman/madrigal-backend1.postman_collection.json); порядок запросов и выбор файлов описаны в [инструкции](postman/README.md).

Capture и Workspace имеют отдельные `go.mod`; локальная разработка объединена через `go.work`. Внутри сервисов выделены `domain`, `application` и `adapters`. Общий технический код находится в `platform`; корневой модуль содержит CLI и проверки архитектуры. Границы и подключение Analysis, Gateway и Frontend описаны в [архитектуре](docs/architecture.md).

Сценарии и результаты проверки рефакторинга перечислены в [отчёте](docs/refactoring-verification.md).

Каждый сервис собирается самостоятельно:

```powershell
cd services/capture-service
$env:GOWORK = 'off'
go build ./cmd/capture-service
```

Для Workspace используется `services/workspace-service` и `./cmd/workspace-service`. После самостоятельной сборки удалите переменную `GOWORK` из окружения, чтобы вернуться к общей рабочей области. `go test ./...` из корня проверяет корневой модуль; скрипт проверки дополнительно охватывает `platform` и оба сервиса.

`docker compose up --build` запускает Workspace и Capture в отдельных контейнерах с приватными томами. Локальные адреса и имена томов сохранены. Прямые порты опубликованы для разработки; при подключении Gateway наружу следует оставить его единую точку входа. Для Analysis используется `ANALYSIS_INTERNAL_URL`.

Отчёты по плановым дням Backend 1: [14 октября](docs/backend1-day3.md), [15 октября](docs/backend1-day4.md), [16 октября](docs/backend1-day5.md). Для показа есть отдельные файлы `docs/backend1-defense-day3.md`, `docs/backend1-defense-day4.md`, `docs/backend1-defense-day5.md`.

Проектный ZIP и Markdown-отчёт вызывают внутренние API Analysis через `ANALYSIS_INTERNAL_URL` (по умолчанию `http://127.0.0.1:8083`). Их сквозная совместимость с реальным Analysis Backend 2 требует проверки после подключения этого сервиса. Локальные тесты используют его HTTP-заглушку; Capture проходит экспорт и восстановление на всём приложенном корпусе.
