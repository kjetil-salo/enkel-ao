# Makefile for fugleobservasjoner - basic dev tasks
IMAGE = fugleobservasjoner:local
CONTAINER = fugle-real
COMPOSE_FILE = docker-compose.yml

.PHONY: help build run rebuild stop remove compose-up compose-down logs stats load static-load clean

help:
	@echo "Targets: build run rebuild stop remove compose-up compose-down logs stats load static-load clean"
	@echo ""
	@echo "Load modes for 'make load' (MODE=...): mixed, static, gentle, ramp, soak, spike, smoke"
	@echo "  mixed  - default: ['/', '/api/species', '/api/reverse']"
	@echo "  static - only '/' (static files)"
	@echo "  gentle - mixed with small randomized delays (safe for external APIs)"
	@echo "  ramp   - gradually increase rate over run"
	@echo "  soak   - low-rate continuous run for N seconds (use REQUESTS as seconds)"
	@echo "  spike  - several short bursts to test burst behavior"
	@echo "  smoke  - a few quick sanity checks"
	@echo "Examples:"
	@echo "  make load MODE=gentle REQUESTS=10 CONC=2 DELAY=0.1"
	@echo "  make static-load REQUESTS=1000 CONC=50"

build:
	docker build -t $(IMAGE) .

run: build
	# start app that talks to real external services
	docker run --name $(CONTAINER) -d -p 3000:3000 $(IMAGE)

stop:
	docker stop $(CONTAINER) 2>/dev/null || true

remove:
	docker rm -f $(CONTAINER) 2>/dev/null || true

rebuild: remove
	docker rmi -f $(IMAGE) 2>/dev/null || true
	$(MAKE) build

compose-up:
	docker-compose -f $(COMPOSE_FILE) up --build -d

compose-down:
	docker-compose -f $(COMPOSE_FILE) down

logs:
	@docker logs --tail 200 $(CONTAINER) || echo "No logs for $(CONTAINER)"

stats:
	@docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" $(CONTAINER)

# load test: customize with REQUESTS, CONC, MODE, DELAY
# e.g. make load MODE=gentle REQUESTS=100 CONC=5 DELAY=0.05
load:
	python3 tools/load_test.py --mode ${MODE:-mixed} --requests ${REQUESTS:-1000} --concurrency ${CONC:-50} --delay ${DELAY:-0.05}

# convenience for static-only load
static-load:
	python3 tools/load_test.py --mode static --requests ${REQUESTS:-1000} --concurrency ${CONC:-50}

clean: stop remove
	@echo "Cleaned local container."
