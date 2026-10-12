FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /out/ ./cmd/workspace-service ./cmd/capture-service ./cmd/capture-prepare ./cmd/migrate

FROM alpine:3.23
RUN addgroup -S madrigal && adduser -S madrigal -G madrigal && mkdir -p /data/capture /data/workspace && chown -R madrigal:madrigal /data
COPY --from=build /out/ /usr/local/bin/
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER madrigal
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
