---
title: Migrating from SWAG/NGIX to Traefik
description: >-
  Moving multi-host external/internal services, SSL, cloudflare workers, and crowdsec to Traefik without Swarm
author: FoxxMD
date: 2025-04-07 10:00:00 -0400
categories: [Tutorial]
tags: [nginx, docker, traefik, crowdsec, ssl, dns]
pin: false
image:
  path: /assets/img/traefik/traefik-dashboard.webp
  alt: Traefik dashboard
---

## Background

### Why?

* NGINX designed for single server topology
  * No service discovery
  * Middleware is hard
* Relying on SWAG doesn't feel first class
  * ENVs for cert generation are unwieldy
    * Still kind of a hack, wish it was 1st party
  * crowdsec mod encourages tight coupling with SWAG scripts
  * cloudflare tunnels encourages tight coupling with SWAG scripts
  * service discovery mod designed for single host
    * my fork works but feelsbadman.jpg
* No birdseye
  * No dashboard or metrics
  * Diagnosing config errors is hard
    * Should not need https://github.com/dvershinin/gixy to do this 

### Requirements/Spec

* Must be able to host services with web routing parity WRT NGINX configs
* Cert management must be easier than SWAG
  * Must be able to validate via dns challenge
  * Must be able to validate multiple domains with wildcard subdomains
* Must be able to integrate crowdsec
* Must be able to integrate with cloudflare tunnels
* Must be able to integrate with authentik
* Service discovery must be easier 
  * Must be feasible without Swarm/changing current docker topology (5+ hosts)
* Must be able to separate internal/external services

### Evaluating Other Solutions

* [Caddy](https://caddyserver.com/)
  * Requires third party module just for docker discovery https://github.com/lucaslorentz/caddy-docker-proxy
  * [Plugins require custom builds](https://github.com/serfriz/caddy-custom-builds) including cloudflare/crowdsec
* [GoDoxy](https://github.com/yusing/godoxy)
  * Promising but too new

## Satifying Requirements with Traefik

Overviews of how each [Requirement](#requirementsspec) was met

### Web Routing Parity

The hardest requirement to meet. Unlike NGINX,

* chaining together multiple transformations of a route is not as straightforward
* Doing anything that short-circuits a route and isn't already a middleware isn't well documented or designed for
* Traefik doesn't have as many middlewares (plugins) and well-documented, non-trivial "how to do X" examples

Majority are straightforward, examples of SWAG default configs vs traefik labels

#### Chaining Middleware with Non-Trivial Examples

Mastodon example

#### Redirect on non-existent Route

Return 302 instead of 404 for wildcare routes.

#### Missing How Do To X Example

* Minio for mastodon, `customresponseheaders`
* `ignorecert` and `insecureSkipVerify` usage

### Cert Management

Easy. Traefik has built in management.

`websecure.http.tls.certResolver` and `domains.main domains.sans`

https://doc.traefik.io/traefik/https/acme/#providers
https://go-acme.github.io/lego/dns/cloudflare/

### Crowdsec Integration

https://doc.traefik.io/traefik/providers/file/#go-templating
https://masterminds.github.io/sprig/ --> https://masterminds.github.io/sprig/os.html

https://github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin

#### Access Logs

Using custom json format to prevent buffering, drop headers, and keep user agent

```yaml
accessLog:
  filePath: "/var/log/traefik/access.log"
  format: json
  # filters:
  #   statusCodes:
  #     - "200-299" # log successful http requests
  #     - "400-599" # log failed http requests
  # collect logs as in-memory buffer before writing into log file
  bufferingSize: 0
  fields:
    headers:
      defaultMode: drop # drop all headers per default
      names:
          User-Agent: keep # log user agent strings
```

Using [vegardit/docker-traefik-logrotate](https://github.com/vegardit/docker-traefik-logrotate) to keep log files manageable.

A simple alpine container tails logs to stdout (docker logs) and crowdsec ingests this via a docker-socket-proxy connection.


```yaml
source: docker
container_name:
 - traefik-external-traefik-access-logs-1
docker_host: tcp://192.168.CONTAINER.IP:2375
labels:
  type: traefik
  ```
{: file="acquis.yaml" }

### Cloudflare Tunnels Integration

https://github.com/PseudoResonance/cloudflarewarp Real IP

cf tunnel container using config from dashboard, host is traefik container name

### Authentik Integration

https://docs.goauthentik.io/docs/add-secure-apps/providers/proxy/server_traefik

### Service Discovery

Not using Swarm yet so discovery is done using a stack with [traefik-kop](https://github.com/jittering/traefik-kop) and docker-socket-proxy.

#### Separating Interal/External Services

Will eventually by done with [Swarm using `constraints`](https://doc.traefik.io/traefik/providers/swarm/#constraints) but traefik-kop has equivalent functionality using [label `namespace`](https://github.com/jittering/traefik-kop?tab=readme-ov-file#namespaces)

## Additional Traefik Functionality

### Viewing Realtime Logs

Using Logdy with [access logs json file](#access-logs)

### Metrics and Dashboard

Internal dashboards for troubleshooting errors and checking status

Metrics exported in prometheus format and collected into [Traefik Official Standalone Dashboard](https://grafana.com/grafana/dashboards/17346-traefik-official-standalone-dashboard/) with modifications for entrypoint/alias.

```yaml
api:
  dashboard: true
  insecure: true
metrics:
  prometheus:
    buckets:
      - 0.1
      - 0.3
      - 1.2
      - 5.0
```
{: file="static_config/traefik.yaml" }

## Traefik Gotchas

### Ambiguous Config Sources and Documentation

* Difficult to easily grok what the difference between static/dynamic config is
* Difficult to determine where static/dynamic config should be placed in dir/files
* Not obvious that config from separate sources can be used anywhere (file middleware in labels, docker plugin config in files)
  * Parsed config sources not listed anywhere by name

### Finding Config Errors

* Dynamic config issues immediate feedback, visible in dashboard
* Static config does not appear until restart and traefik will bulldoze over silently
  * Errors only show in docker logs but traefik will startup anyways
  * May cause dashboard to entirely disappear if error affects internal routes
  * Errors may look like dynamic if the error trickles downstream
* So..always check docker logs **first** and always restart traefik after any static config changes

### Clobbering Labels

* Copy-pasting labels, may forget service/router name is same as existing
* Traefik does not complain about this unless it causes actually issues (router issue) but will still cause reachability issues while running

### Multiple Services, Same Container

Not an issue but not well documented

* Traefik will complain if multiple routers on container labels but only one service
* Can set service for router on label explicitly
  * Docs examples focus on service name being implicitly define
Ex

```yaml
# ...
   labels:
    traefik.http.routers.mastodon.service: mastodon
    #...
    traefik.http.routers.mastodon-root.service: mastodon
    # ...
    traefik.http.services.mastodon.loadbalancer.server.port: 443
```

## Full Examples

```yaml
here be stacks
```