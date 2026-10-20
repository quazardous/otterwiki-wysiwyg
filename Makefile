# otterwiki-wysiwyg — make help
.PHONY: help install build watch test e2e screenshots check-pages up down restart logs seed clean

COMPOSE ?= docker compose

help: ## this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

install: ## install the frontend dependencies
	cd frontend && npm ci

build: ## build the editor bundle into otterwiki_wysiwyg/static/
	cd frontend && npm run build

watch: ## rebuild the bundle on every change (not minified)
	cd frontend && npm run watch

test: ## run the round-trip tests
	cd frontend && npm test

e2e: ## run the end-to-end tests against the local wiki (make up && make seed first)
	cd frontend && npm run e2e

check-pages: ## check the plugin on a wiki's pages, DIR=<its git repository> (counts only, no content)
	cd frontend && node tools/check-pages.mjs $(abspath $(DIR))

screenshots: ## the README screenshots, docs/*.png (make up && make seed first)
	cd frontend && npm run screenshots

up: build ## start the local wiki on http://localhost:8080
	$(COMPOSE) up -d
	@echo "http://localhost:$${OTTERWIKI_PORT:-8080}"

down: ## stop the local wiki (data is kept)
	$(COMPOSE) down

restart: ## reinstall the plugin (after a change of the Python side)
	$(COMPOSE) restart otterwiki

logs: ## follow the wiki's logs
	$(COMPOSE) logs -f otterwiki

seed: ## add the demo pages to the local wiki
	$(COMPOSE) exec -T -u www-data otterwiki sh -c 'cp /seed/*.md /app-data/repository/ && cd /app-data/repository && git add -A && git -c user.name=seed -c user.email=seed@localhost commit -qm "Demo pages" && echo seeded'

clean: ## stop the local wiki and delete its data
	$(COMPOSE) down -v
