PNPM ?= pnpm
COMPOSE ?= docker compose
PROJECT ?= zero-human

.PHONY: install build test test-unit test-coverage lint typecheck config-check stack-start stack-stop stack-status stack-logs

install:
	$(PNPM) install

build:
	$(PNPM) build

test:
	$(PNPM) test

test-unit:
	$(PNPM) test:unit

test-coverage:
	$(PNPM) test:coverage

lint:
	$(PNPM) lint

typecheck:
	$(PNPM) typecheck

config-check:
	$(COMPOSE) -p $(PROJECT) config

stack-start:
	$(PNPM) stack:start

stack-stop:
	$(PNPM) stack:stop

stack-status:
	$(PNPM) stack:status

stack-logs:
	$(PNPM) stack:logs
