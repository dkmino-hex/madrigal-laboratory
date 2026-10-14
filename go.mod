module github.com/dkmino-hex/madrigal-laboratory

go 1.26.0

require (
	github.com/dkmino-hex/madrigal-laboratory/platform v0.0.0
	github.com/dkmino-hex/madrigal-laboratory/services/analysis-service v0.0.0
	github.com/dkmino-hex/madrigal-laboratory/services/capture-service v0.0.0
	github.com/dkmino-hex/madrigal-laboratory/services/gateway-service v0.0.0
	github.com/dkmino-hex/madrigal-laboratory/services/workspace-service v0.0.0
	github.com/gopacket/gopacket v1.7.4
)

require (
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/gofrs/flock v0.13.1 // indirect
	github.com/golang-migrate/migrate/v4 v4.20.1 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/ncruces/go-strftime v1.0.0 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/sys v0.48.0 // indirect
	modernc.org/libc v1.77.1 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
	modernc.org/sqlite v1.60.1 // indirect
)

replace (
	github.com/dkmino-hex/madrigal-laboratory/platform => ./platform
	github.com/dkmino-hex/madrigal-laboratory/services/analysis-service => ./services/analysis-service
	github.com/dkmino-hex/madrigal-laboratory/services/capture-service => ./services/capture-service
	github.com/dkmino-hex/madrigal-laboratory/services/gateway-service => ./services/gateway-service
	github.com/dkmino-hex/madrigal-laboratory/services/workspace-service => ./services/workspace-service
)
