FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod ./
RUN go mod download

COPY . .

ARG SERVICE
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/server ./cmd/${SERVICE}



FROM alpine:3.22

WORKDIR /app

COPY --from=builder /app/server ./server

CMD ["./server"]