# Backend 1 — показ дня 5

1. `go test ./...` прогоняет все сервисные тесты, включая 12 PCAP/PCAPNG и CSV.
2. `go test ./services/capture-service/api -run '^$' -bench BenchmarkReassemblyCorpus -benchtime=3x -benchmem -count=1` показывает время и выделения памяти для корпуса.
3. `GET /api/v1/artifacts/{artifactId}` до завершения job возвращает 409, после `SUCCEEDED` — файл с заголовками и проверенным SHA-256.
4. Повреждённый ZIP и ZIP без `analysis.zip` дают `INVALID_ARCHIVE`; отсутствие Analysis во время восстановления оставляет проект `ERROR`, повтор с тем же `importId` возвращает его к работе.

Сервисные адреса по умолчанию: Workspace `127.0.0.1:8081`, Capture `127.0.0.1:8082`. Для проектного экспорта/импорта и отчёта требуется `ANALYSIS_INTERNAL_URL` с реализацией внутренних методов Backend 2.
