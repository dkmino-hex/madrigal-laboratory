# Мадригал — Analysis, задачи 13 октября

Это исторический отчёт исходной ветки. В объединённой рабочей области Analysis находится в `services/analysis-service`, Gateway — в `services/gateway-service`. Актуальные запуск и проверки описаны в [README](README.md); команда Compose для Analysis теперь `docker compose up --build -d analysis-service`.

## Что добавлено
- POST /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions
- GET /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions
- GET /api/v1/projects/{projectId}/interpretations/{interpretationId}/revisions/{revisionId}
- Поддержка пагинации `limit` (1–100, по умолчанию 50), `cursor` (числовое смещение) для списков.
- JSON-ответы по формату `api/openapi.yaml`: `interpretationId`, `currentRevisionId`, `revisionId`, `revision`, `items`, `page`.
- POST интерпретации принимает `revision: {"fields": [...]}` согласно OpenAPI; старый `schema` временно тоже принимается.
- Ошибки 400/404/500 в JSON, проверка projectId при обращении к ревизиям.
- Ревизии создаются с монотонно растущей версией в транзакции, ранее созданные не меняются.
- Отдельное подключение SQLite для мигратора, чтобы `m.Close()` не закрывал основную БД.
- Интеграционный HTTP-тест с временной SQLite.

## Установка
Архив содержит только backend-файлы из полученной копии проекта; в нём нет Gateway, фронтенда и других файлов репозитория. **Не удаляйте существующий репозиторий**. Распакуйте архив с заменой файлов в корне существующего репозитория.

## Проверка на Mac
```bash
go build -buildvcs=false ./...
go test -buildvcs=false ./...
docker compose up --build -d analysis
```

## Примеры
```bash
# Создать интерпретацию (сохраните interpretationId из ответа)
curl -i -X POST http://localhost:8080/api/v1/projects/test-project/interpretations \
  -H 'Content-Type: application/json' \
  -d '{"name":"Parser","revision":{"fields":[]}}'

# Создать вторую ревизию (замените INTERPRETATION_ID)
curl -i -X POST http://localhost:8080/api/v1/projects/test-project/interpretations/INTERPRETATION_ID/revisions \
  -H 'Content-Type: application/json' \
  -d '{"revision":{"fields":[{"name":"command","type":"string","length":5}]}}'

# Список ревизий
curl -i 'http://localhost:8080/api/v1/projects/test-project/interpretations/INTERPRETATION_ID/revisions?limit=20'

# Одна ревизия (замените REVISION_ID)
curl -i http://localhost:8080/api/v1/projects/test-project/interpretations/INTERPRETATION_ID/revisions/REVISION_ID
```

## Ограничения и будущие задачи
- Тесты нужно запустить локально: среда подготовки имела Go 1.23, а проект требует Go 1.26. Поэтому сборка/тесты **не подтверждены здесь**.
- `changeComment` в OpenAPI необязателен, но текущая таблица `revisions` не содержит такого поля. Запрос принимает его, но **не сохраняет**; для сохранения потребуется новая миграция и поле модели.
- `Idempotency-Key` описан в OpenAPI, но пока не реализован.
- `cursor` — простой offset, не устойчив к параллельным вставкам. Для продакшена нужен стабильный keyset cursor.
- Preview, Runs и Results не входят в задачи 13 октября и не реализованы.
- Проверка наличия проекта в Workspace пока не производится; валидация ограничена `projectId` из URL и данными Analysis.
