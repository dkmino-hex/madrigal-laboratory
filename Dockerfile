FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum go.work ./
COPY platform/go.mod platform/go.sum ./platform/
COPY services/capture-service/go.mod services/capture-service/go.sum ./services/capture-service/
COPY services/workspace-service/go.mod services/workspace-service/go.sum ./services/workspace-service/
COPY services/analysis-service/go.mod services/analysis-service/go.sum ./services/analysis-service/
COPY services/gateway-service/go.mod services/gateway-service/go.sum ./services/gateway-service/
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/ ./cmd/workspace-service ./cmd/capture-service ./cmd/capture-prepare ./cmd/migrate ./cmd/analysis ./cmd/gateway

FROM alpine:3.23
RUN apk add --no-cache tzdata \
    && addgroup -S madrigal && adduser -S madrigal -G madrigal \
    && mkdir -p /data/capture /data/workspace /data/analysis && chown -R madrigal:madrigal /data
COPY --from=build /out/ /usr/local/bin/
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER madrigal
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
