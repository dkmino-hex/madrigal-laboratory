# МАДРИГАЛ — Frontend

React, TypeScript strict, Vite, React Router и TanStack Query. Интерфейс подключён к Workspace, Capture и Analysis через публичный Gateway. Production Frontend собирается вместе с сервисами и открывается на `http://127.0.0.1:8080/projects` после `docker compose up --build -d --wait` из корня репозитория.

## Разработка

```powershell
npm ci
$env:VITE_API_BASE_URL = 'http://127.0.0.1:8080'
npm run dev:api
```

Открыть `http://localhost:5173`. Gateway разрешает `localhost:5173` и `127.0.0.1:5173` по умолчанию; другие origins задаются через `FRONTEND_ORIGIN` списком через запятую. Для демонстрации без backend есть отдельная команда `npm run dev:mock`.

Node.js — 22.12 или новее. Зависимости закреплены в `package-lock.json`; используется npm. `VITE_DATA_MODE` и `VITE_API_BASE_URL` доступны браузеру. Production использует API; query-параметры не включают MSW.

## Структура и контракт

- `src/pages` — экраны и маршруты.
- `src/features` — HEX, исходные пакеты, задания, загрузки и результаты.
- `src/shared/api/transport.ts` — HTTP, отмена, таймауты и ошибки.
- `src/shared/api/live` — преобразование DTO отдельных сервисов в модели интерфейса.
- `src/shared/api/contracts/models.ts` — Zod-модели и проверка контекста данных.
- `src/shared/api/contracts/gateway-mapping.json` — реальные HTTP-операции.
- `src/shared/api/generated/gateway.d.ts` — типы из корневого `contracts/gateway.openapi.json`.

Источник OpenAPI находится на один уровень выше Frontend. Генератор использует его по умолчанию; `MADRIGAL_OPENAPI_FILE` позволяет указать другой файл. [Подробности интеграции](docs/frontend/integration.md).

Большие координаты представлены десятичными строками, значения `uint64` — точными строками результата. Источник всегда привязан к конкретным capture/assembly/session/stream и направлению. Исторические ревизии содержат исходный JSON, комментарий и родительскую ревизию. CSV принимается в формате `timestamp,name,type,parameters` либо исходном формате из восьми колонок; импорт асинхронный.

## Проверки

```powershell
npm run verify
npm run format:check
npm run api:generate
npm run api:check
$env:MADRIGAL_GATEWAY_URL = 'http://127.0.0.1:8080'
# При необходимости: $env:MADRIGAL_BROWSER_CHANNEL = 'msedge'
npm run test:e2e:integration
```

Для Chromium установить браузер через `npx playwright install chromium`; Edge можно использовать через указанную переменную. Интеграционный тест требует работающий Gateway, разрешающий `http://localhost:5173`; Vite он запускает самостоятельно. MSW и подмена HTTP отключены. Тест создаёт собственные проекты, проверяет все 36 операций клиента, отчёт и перенос ZIP в тот же сервер, затем открывает production-интерфейс Gateway.

Существующие mock E2E доступны через `npm run test:e2e:mock`. Читающая API-проверка существующего проекта — `npm run test:e2e:api`; ей нужны `MADRIGAL_PROJECT_ID`, `MADRIGAL_RUN_ID` и `MADRIGAL_SOURCE_LINK`. Отчёты и трассы сохраняются в игнорируемом `test-results/`.

`npm run build` создаёт API production build и удаляет demo worker/архив. Страницы и редактор загружаются отдельными chunks. Gateway отдаёт SPA для экранов, JSON для ошибок API и 404 для отсутствующих assets.

История исходной frontend-ветки и её требований сохранена в [requirements](docs/frontend/requirements.md), [progress](docs/frontend/progress.md) и [verification](docs/frontend/verification.md). Старые приёмочные отчёты относятся к указанным в них датам и mock-окружению.
