.DEFAULT_GOAL:=help

COMPOSE_PREFIX_CMD := DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1

COMMAND ?= /bin/sh

# --------------------------

.PHONY: build deploy start stop logs restart shell up rm help

up:				## Start service
	@echo "Starting Application \n (note: Web container will wait App container to start before starting)"
	${COMPOSE_PREFIX_CMD} docker compose up -d

build-up:       ## Start service, rebuild if necessary
	${COMPOSE_PREFIX_CMD} docker compose up --build -d

build:			## Build The Image
	${COMPOSE_PREFIX_CMD} docker compose build

down:			## Down service and do clean up
	${COMPOSE_PREFIX_CMD} docker compose down

start:			## Start Container
	${COMPOSE_PREFIX_CMD} docker compose start

stop:			## Stop Container
	${COMPOSE_PREFIX_CMD} docker compose stop

logs:			## Tail container logs with -n 1000
	@${COMPOSE_PREFIX_CMD} docker compose logs --follow --tail=100

images:			## Show Image created by this Makefile (or docker compose in docker)
	@${COMPOSE_PREFIX_CMD} docker compose images

ps:			## Show Containers Running
	@${COMPOSE_PREFIX_CMD} docker compose ps

jekyll-build:
	@${COMPOSE_PREFIX_CMD} docker compose run --rm jekyll /bin/sh -c "build"

jekyll-proof:
	@${COMPOSE_PREFIX_CMD} docker compose run --rm jekyll 'htmlproofer _site \
                                                                     \-\-disable-external \
                                                                     \-\-ignore-urls "/^http:\/\/127.0.0.1/,/^http:\/\/0.0.0.0/,/^http:\/\/localhost/"'

command:	  ## Execute command ( make command COMMAND=<command> )
	@${COMPOSE_PREFIX_CMD} docker compose run --rm jekyll ${COMMAND}

command-root:	 ## Execute command as root ( make command-root COMMAND=<command> )
	@${COMPOSE_PREFIX_CMD} docker compose run --rm jekyll ${COMMAND}

shell-root:			## Enter container shell as root
	@${COMPOSE_PREFIX_CMD} docker compose exec -u root jekyll /bin/bash

shell:			## Enter container shell
	@${COMPOSE_PREFIX_CMD} docker compose exec jekyll /bin/bash

restart:		## Restart container
	@${COMPOSE_PREFIX_CMD} docker compose restart

rm:				## Remove current container
	@${COMPOSE_PREFIX_CMD} docker compose rm -f

help:       	## Show this help.
	@echo "\n\nMake Application Docker Images and Containers using docker compose files"
	@echo "Make sure you are using \033[0;32mDocker Version >= 20.1\033[0m & \033[0;32mdocker compose >= 1.27\033[0m "
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m ENV=<prod|dev> (default: dev)\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
