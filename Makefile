# Frontend toolchain: Node >= 22.12 (see .nvmrc) and pnpm.
PNPM ?= pnpm
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
GO_PORT ?= 4000
GOLANGCI_LINT_VERSION ?= v2.6.0

.PHONY: help dev dev-go dev-web web build verify perf release-snapshot test test-go test-web e2e lint fixture clean

help: ## list targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

dev: ## run Go API (:$(GO_PORT)) and Vite (:5173) together with live reload
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) --no-print-directory dev-go & \
	$(MAKE) --no-print-directory dev-web & \
	wait

dev-go: ## run the Go server against REPO (default: .)
	go run ./cmd/void -port $(GO_PORT) $(or $(REPO),.)

dev-web: ## run the Vite dev server (proxies /api to :$(GO_PORT))
	cd web && $(PNPM) dev

web: ## build the frontend into web/dist
	cd web && $(PNPM) install --frozen-lockfile && $(PNPM) build

build: web ## build the single binary at bin/void (embeds web/dist)
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o bin/void ./cmd/void

verify: build ## smoke-test the built binary against the fixture repo
	bash scripts/verify-release.sh bin/void

perf: ## first-page history latency on a generated 10k-commit repo
	VOID_PERF=1 go test -run TestLogFirstPageLatency -count=1 -v ./internal/git/

release-snapshot: ## build release archives locally (needs goreleaser)
	goreleaser release --snapshot --clean

test: test-go test-web ## run all unit tests

test-go: ## Go unit + API golden tests (race detector on)
	go test -race -count=1 ./...

test-web: ## frontend unit tests
	cd web && $(PNPM) test

e2e: web ## Playwright against the real binary + fixture repo
	cd web && $(PNPM) e2e

lint: ## vet, golangci-lint (pinned via go run if not installed), oxlint, tsc
	go vet ./...
	@if command -v golangci-lint >/dev/null; then golangci-lint run ./...; \
	else GOFLAGS=-mod=mod go run github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_LINT_VERSION) run ./...; fi
	cd web && $(PNPM) lint && $(PNPM) typecheck

fixture: ## build the fixture repo into ./tmp/fixture for manual poking
	rm -rf tmp/fixture && bash testdata/mkrepo.sh tmp/fixture && echo "fixture at tmp/fixture/repo"

clean:
	rm -rf bin tmp web/dist/* && touch web/dist/.gitkeep
