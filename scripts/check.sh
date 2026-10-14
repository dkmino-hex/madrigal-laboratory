#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
for check in test vet build; do
    go "$check" ./cmd/... ./internal/... ./platform/... ./services/capture-service/... ./services/workspace-service/... ./services/analysis-service/... ./services/gateway-service/...
done
