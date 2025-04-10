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

Configuring Traefik to use [Crowdsec](https://www.crowdsec.net/) (CS) as a bouncer within Traefik is similar to SWAG but the actual setup of CS (containers, acquisition) is different.

How SWAG does it:

* [LSIO blog post on standing up a CS instance configured for Nginx/SWAG](https://www.linuxserver.io/blog/blocking-malicious-connections-with-crowdsec-and-swag)
* [LSIO docker mod `swag-crowdsec`](https://github.com/linuxserver/docker-mods/tree/swag-crowdsec) installs crowdsec lua module for use in nginx

How traefik does it:

* Given an existing crowdsec instance, traefik uses a [plugin](https://doc.traefik.io/traefik/plugins/) [maxlerebourg/crowdsec-bouncer-traefik-plugin](https://github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin) that implements a [bouncer](https://docs.crowdsec.net/u/user_guides/bouncers_configuration/) that can be used as a middleware

#### Crowdsec Architecture

My CS setup is *verbose*:

* Traefik container
  * Uses crowdsec-bouncer-plugin for middleware
  * Writes [access logs](https://doc.traefik.io/traefik/observability/access-logs/) to rotating log file using [vegardit/docker-traefik-logrotate](https://github.com/vegardit/docker-traefik-logrotate)
* Basic alpine container `tail`s access logs to output (referred to below as `log-tail`)
  * [docker-socket-proxy](https://docs.linuxserver.io/images/docker-socket-proxy/) is used to expose `tail` container over the network
* Crowdsec
  * [**Decision (Local API)**](https://docs.crowdsec.net/docs/next/concepts) instance of `crowdsecurity/crowdsec` docker image (referred to below as `crowdsec`)
    * Used by crowdsec-bouncer-plugin
  * [**Ingest (Log Processor)**](https://docs.crowdsec.net/docs/next/concepts) instance of `crowdsecurity/crowdsec` docker image (referred to below as `crowdsec-ingest`) configured as a [**child** log processor](https://www.crowdsec.net/blog/multi-server-setup)
    * Processes logs `log-tail` container and feeds decisions back to `crowdsec`

The majority of the above could be consolidated into one CS container, CS config, and your main traefik container. The reason it is broken out into so many components:

* Separating access logs from regular Traefik logs
  * Troubleshooting traefik-specific issues from logs is much easier (less noise in container logs)
  * Write to file persists access logs after restart
* Exposing/using `log-tail` container enables
  * [traefik log acquistion](https://docs.crowdsec.net/docs/next/log_processor/data_sources/docker) to be done with a docker connection locally or remotely, and by container name. Instead of needing to mount log folders/files into a crowdsec container (locally only) and having to deal with permissions.
  * access logs are consumable/viewable in other apps (when using `json` access log format, readable in [Dozzle](https://dozzle.dev/) or Logdy)
* Separate Crowdsec LAPI/log processor instances:
  * In high-traffic environments log processing can be CPU intensive while bouncer-decision communication is relatively light
    * `crowdsec-ingest` can be deployed to a more powerful machine and its config is simplified compared to full LAPI config
    * `crowdsec` can be deployed to a lower power/more stable machine, or next to traefik
      * if `crowdsec-ingest` bottlenecks to high volume, or crashes, `crowdsec` will still operate and traefik will still get decisions

From real-world experience this setup scales *much better* than a single CS instance. Feel free to consolidate any of the below setup if this setup is too overkill for you, though.

#### Setup Access Logs {#access-logs}

Configure traefik to output access logs, make sure files are rotated, and expose logs as a docker container.

In your traefik [static config](https://doc.traefik.io/traefik/getting-started/configuration-overview/#the-static-configuration)[^static_mount] add:

```yaml
accessLog:
# Using custom json format to prevent buffering, drop headers, and keep user agent
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
{: file="/etc/traefik/traefik.yaml" }

Make sure to mount the log dir to your host filesystem:

```yaml
services:
  traefik:
  # ...
    volumes:
      # ...
      - $DOCKER_DATA/traefik/log:/var/log/traefik:rw
```
{: file="compose.yaml" }

Then add the rest of the access log functionality to `compose.yaml`

```yaml
services:
  traefik:
  # ...
    volumes:
      # ...
      - $DOCKER_DATA/traefik/log:/var/log/traefik:rw
    # ...

  logrotate:
    image: vegardit/traefik-logrotate:latest
    network_mode: none
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:rw # required to send USR1 signal to Traefik after log rotation
      - $DOCKER_DATA/traefik/log:/var/log/traefik:rw # folder containing access.log file
    environment:
      TZ: "America/New_York"
      # all environment variables are optional and show the default values:
      LOGROTATE_LOGS: "/var/log/traefik/*.log" # log files to rotate, directory must match volume mount
      LOGROTATE_TRIGGER_INTERVAL: daily  # rotate daily, must be one of: daily, weekly, monthly, yearly
      LOGROTATE_TRIGGER_SIZE: 50M        # rotate if log file size reaches 50MB
      LOGROTATE_MAX_BACKUPS: 7          # keep 14 backup copies per rotated log file
      LOGROTATE_START_INDEX: 1           # first rotated file is called access.1.log
      LOGROTATE_FILE_MODE: 0644          # file mode of the rotated file
      LOGROTATE_FILE_USER: root          # owning user of the rotated file
      LOGROTATE_FILE_GROUP: root         # owning group of the rotated file
      CRON_SCHEDULE: "* * * * *"
      CRON_LOG_LEVEL: 8                  # see https://unix.stackexchange.com/a/414010/378036
      # command to determine the id of the container running Traefik:
      TRAEFIK_CONTAINER_ID_COMMAND: docker ps --no-trunc --quiet --filter label=org.opencontainers.image.title=Traefik
  tail-log:
    image: alpine
    # name that will be used in aquis.yaml
    container_name: tail-log
    volumes:
      - $DOCKER_DATA/traefik/log:/var/log:ro
    command: >
      sh -c "tail -F /var/log/access.log"
    network_mode: none
    restart: unless-stopped
  socket-proxy:
    image: lscr.io/linuxserver/socket-proxy:latest
    container_name: socket-proxy
    environment:
      - CONTAINERS=1
      - POST=0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    ports:
      - 2375:2375
    restart: always
    read_only: true
    tmpfs:
      - /run
```
{: file="compose.yaml" }

#### Setup Crowdsec Local API {#crowdsec-local-api}

```yaml
services:
  crowdsec:
    image: "crowdsecurity/crowdsec:latest"
    environment:
      - "CUSTOM_HOSTNAME=cs-decision"
      - "GID=1000"
      - "LEVEL_INFO=true"
      - "TZ=America/New_York"
    ports:
      - "4242:4242/tcp"
      - "6060:6060/tcp"
      - "8080:8080/tcp"
    restart: "always"
    volumes:
      - "$DOCKER_DATA/crowdsec/config:/etc/crowdsec"
      - "$DOCKER_DATA/crowdsec/data:/var/lib/crowdsec/data"
      - "$DOCKER_DATA/crowdsec/logs:/var/log/crowdsec"
      - /var/run/docker.sock:/var/run/docker.sock:ro
```
{: file="compose.yaml" }

Start the service and exec into the container.

```shell
docker container exec -it crowdsec-crowdsec-1 /bin/sh
```

Then, add a new **machine** so our child log processor can login.

```shell
cscli machines add MyChildMachine --auto
```

`MyChildMachine` is the username for the machine and the command will output a **LAPI password**. Save this for the next step.

Then, add a new bouncer that will be used with traefik.

```
cscli bouncers add MyBouncerName
```

This command will output a **bouncer key**. Save this for [traefik bouncer setup.](#traefik-bouncer-setup)

#### Setup Crowdsec Child Log Processor {#crowdsec-child-setup}

```yaml
  crowdsec-ingest:
    image: "crowdsecurity/crowdsec:latest"
    environment:
      - "COLLECTIONS=crowdsecurity/linux crowdsecurity/traefik crowdsecurity/whitelist-good-actors"
      # known to have false positives and is CPU intensive
      - "DISABLE_SCENARIOS=crowdsecurity/http-bad-user-agent"
      # improves regex performance
      - "CROWDSEC_FEATURE_RE2_GROK_SUPPORT=true"
      - "CUSTOM_HOSTNAME=cs-ingest"
      - "GID=1000"
      # important to make this a worker
      - "DISABLE_LOCAL_API=true"
      - "LEVEL_INFO=true"
      - "LOCAL_API_URL=http://CS_LAPI_INSTANCE_HOST_IP:8080"
    ports:
      - "6061:6060/tcp"
    restart: "always"
    volumes:
      - "$DOCKER_DATA/crowdsec-ingest/config:/etc/crowdsec"
      - "$DOCKER_DATA/crowdsec-ingest/data:/var/lib/crowdsec/data"
      - "$DOCKER_DATA/crowdsec-ingest/logs:/var/log/crowdsec"
```
{: file="compose.yaml" }

> This service can be added to the Local API stack above if they are running on the same machine
{: .prompt-tip }

Start the service to generate all of the default configuration files. Then stop the service and edit these files:

Set `api.server.enable: false` in `/etc/crowdsec/config.yaml`
```yaml
# ...
api:
  # ...
  server:
    # ...
    enable: false
```
{: file="/etc/crowdsec/config.yaml" }

Modify `/etc/crowdsec/local_api_credentials.yaml` to use the username/**LAPI password** we got in the [previous step.](#crowdsec-local-api)

```yaml
url: http://CROWDSEC_LOCAL_API_HOST:8080
login: MyChildMachine
password: 9W0Mtyh5lJ1Hks29BxN4arPKA06t264J8TvIh9Uxu1fyHAVGO22AcWNbx8Oh4tJ
```

Finally, modify `/etc/crowdsec/acquis.yaml` to add the docker data source for our `tail-log` container that is [streaming traefik access logs:](#access-logs)

```yaml
source: docker
container_name:
 - tail-log
docker_host: tcp://TRAEFIK_HOST_IP:2375
labels:
  type: traefik
  ```
{: file="acquis.yaml" }

Now `crowdsec-ingest` can be restarted and should be processing traefik logs as well as reporting to CS Local API.

#### Setup Traefik Crowdsec Bouncer {#traefik-bouncer-setup}

Add the `crowdsec` service IP and **bouncer key**, [generated earlier](#crowdsec-local-api), to traefik as environmental variables.

```yaml
  traefik:
    image: "traefik:v3.3"
    # ...
    environment:
      # ...
      # better in .env or as secret
      CS_TRAEFIK_BOUNCER_KEY: o2siyq4Dt92N9sQCbiRVIHjXWstr5jIwU7Puhxws
      BOUNCER_HOST: CROWDSEC_LOCAL_API_HOST:PORT
```
{: file="compose.yaml"}

Add the [crowdsec-bouncer-traefik-plugin](https://github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin) to your traefik [static config](https://doc.traefik.io/traefik/getting-started/configuration-overview/#the-static-configuration).

```yaml
experimental:
  plugins:
    # ...
    csbouncer:
      moduleName: github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin
      version: "v1.4.0"
```
{: file="/etc/traefik/traefik.yaml"}

Create a new middleware in your traefik [dynamic config](#cf-real-ip-forwarding) that configures the CS plugin. We use [go templating](https://doc.traefik.io/traefik/providers/file/#go-templating) to [get the ENVs](https://masterminds.github.io/sprig/os.html) we set in the compose service earlier.

```yaml
http:
  middlewares:
    # ...
    crowdsec:
      plugin:
        csbouncer:
          #logLevel: DEBUG
          enabled: true
          httpTimeoutSeconds: 2
          # ban page can be enabled by manually copying ban.html https://github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin
          # to a directory accessible to traefik container
          #banHTMLFilePath: /config/ban.html
          {% raw %}crowdsecLapiKey: '{{ env "CS_TRAEFIK_BOUNCER_KEY" }}'
          crowdsecLapiScheme: http
          crowdsecLapiHost: '{{ env "BOUNCER_HOST" }}'{% endraw %}
          # optional but necessary if using cloudflare dns proxy/tunnel
          forwardedHeadersTrustedIPs: 
            - 172.28.0.1/24 
          # skip bouncing if request is from this IP range   
          clientTrustedIPs: 
            - 192.168.0.0/24
```
{: file="/config/global.yaml"}

Then, add the middleware `crowdsec@file` to [entrypoints](https://doc.traefik.io/traefik/routing/entrypoints/) to have it applied to all routes or add it to [specific routes.](https://doc.traefik.io/traefik/routing/routers/#middlewares)

Finally, restart traefik to have crowdsec enabled and in use!


### Cloudflare Tunnels Integration

CF Tunnels setup is markedly different than SWAG but functionally the same once setup.

For CF Tunnels with SWAG there are two [LSIO docker mods](https://docs.linuxserver.io/general/container-customization/#docker-mods) that are used:

* [`universal-cloudflared`](https://github.com/linuxserver/docker-mods/tree/universal-cloudflared) - Installs `cloudflared` directly into the SWAG container and uses `CF_*` ENVs to automate setup via CLI (or `CF_REMOTE_MANAGE_TOKEN` to pull config from CF dashboard)
* [`cloudflare_real-ip`](https://github.com/linuxserver/docker-mods/tree/swag-cloudflare-real-ip) - pulls CF edge server IPs into a list that Nginx can use. It also requires adding a few Nginx directives to your config in order to use this list to set real IP.

We can achieve the same as above by setting up `cloudflared` as its own container and using a the [traefik plugin](https://doc.traefik.io/traefik/plugins/) [cloudflarewarp](https://github.com/PseudoResonance/cloudflarewarp) to parse CF edge server IPs.

#### `cloudflared` Tunnel Container Setup

My opinionated approach is to do all Tunnel config in the CF Dashboard. This makes compose setup easier and enables `cloudflared` to automatically check for and applies config changes from dashboard so no container restarts are needed.

First, acquire your tunnel token by [creating a tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel/) or using **Refresh Token** from the tunnel Overview tab, if you didn't save it initially on creation.

Next, setup the `cloudflared` container in your traefik stack:

```yaml
services:
  traefik:
    image: "traefik:v3.3"
    networks:
      - traefik_internal
    volumes:
    # how i get dynamic/static configs into traefik, can do this however you want
      - $DOCKER_DATA/traefik/static_config:/etc/traefik:rw
      - $DOCKER_DATA/traefik/dynamic_config:/config/dynamic:rw    
    # ...  
  cloudflare_tunnel:
    image: cloudflare/cloudflared:2025.2.0
    networks:
      - traefik_internal
    restart: unless-stopped
    # configure tunnel in cloudflare dashboard and use token from dashboard to configure container
    command: tunnel run --token ${CF_TRAEFIK_TUNNEL_TOKEN}
networks:
  traefik_internal:
    driver: bridge
    ipam:
    # important to set this so cloudflare_tunnel always has correct subnet
    # for traefik to recognize as trusted IP range
      config:
        - subnet: 172.28.0.0/16
```
{: file="compose.yaml" }

Setting up the `traefik_internal` network with a static subnet will be important for CF IP forwarding later.

#### Traefik CF Entrypoint

Now we need to 1) tell Traefik to accept CF Tunnel traffic on an [entrypoint](https://doc.traefik.io/traefik/routing/entrypoints/) and 2) tell CF Tunnel to forward traffic to that entrypoint.

In your traefik [static config](https://doc.traefik.io/traefik/getting-started/configuration-overview/#the-static-configuration)[^static_mount] configure an entrypoint with a port and [forwarded headers](https://doc.traefik.io/traefik/routing/entrypoints/#forwarded-headers) so traefik knows to use CF IP as "request from" IP, rather than the `cloudflared` container internal IP. We will then use this later to get the [actual "request from" IP.](#cf-real-ip-forwarding)

[^static_mount]: I use a yaml file mounted into `/etc/traefik` in the container because it's easier to configure but this can be done however you want.

```yaml
providers:
  file:
    directory: /config/dynamic
    watch: true
entryPoints:
  cf:
    # address CF tunnel config is pointed to on traefik container
    address: :808
    # if this is the only entrypoint this needs to be true
    asDefault: true
    # this needs to be on the entrypoint you are using for cf tunneled services
    # must match traefik_internal network
    forwardedHeaders:
      trustedIPs:
        - 172.28.0.1/24
```
{: file="/etc/traefik/traefik.yaml" }

Then, setup your tunnel's **Public Hostname** entries with the service pointing to

```
http://traefik:808
```

![Cloudflare Tunnel Dashboard](/assets/img/traefik/cf_config.png)
_Domain and wildcard entries with service URL_

The domain `traefik` should be the same as whetever you have the *service name* of traefik as in your [compose stack.](#cloudflared-tunnel-container-setup)

#### CF Real IP Forwarding

Finally, we need to configure traefik to substitute the value of the header `Cf-Connecting-IP` CF Tunnel attaches to our traffic into the `X-Forwarded-For` header. This will ensure that logs/metrics and downstream applications see the IP of the actual origin host rather than CF's edge server IPs.

To this we first install the [traefik plugin](https://doc.traefik.io/traefik/plugins/) [cloudflarewarp](https://github.com/PseudoResonance/cloudflarewarp) by defining it in our **static config**:

```yaml
# add this to the /etc/traefik/traefik.yaml example above
experimental:
  plugins:
    cloudflarewarp:
      moduleName: "github.com/PseudoResonance/cloudflarewarp"
      version: "v1.4.0"
```
{: file="/etc/traefik/traefik.yaml" }

Then, define a middleware that uses the plugin *somewhere* in a [dynamic config.](https://doc.traefik.io/traefik/providers/overview/) I prefer to keep my "globally" used dynamic config in a [file](https://doc.traefik.io/traefik/providers/file/) defined by [directory in static config](https://doc.traefik.io/traefik/providers/file/#directory) rather than defining in a random container label.

> * [`providers.files.directory`](#traefik-cf-entrypoint) in static config defines directory in container for dynamic configs
> * dynamic config dir `/config/dynamic` is [mounted in the container](#cloudflared-tunnel-container-setup)
{: .prompt-tip }

```yaml
http:
  middlewares:
    cloudflarewarp:
      plugin:
        cloudflarewarp:
          disableDefault: false
```
{: file="/config/dynamic/global.yaml" }

To use with the entrypoint we setup earlier in our static config add `entryPoints.cf.http.middlewares` with our middlename@provider:

```yaml
# ... building on previous static config
# ...
entryPoints:
  cf:
    # ...
    # will always run if service/router is using cf entrypoint
    # otherwise, this middleware can be ommited here and instead used per service/router as a middleware
     middlewares:
       - cloudflarewarp@file
   # ...
```
{: file="/etc/traefik/traefik.yaml" }

Now traefik will the plugin to get a list of CP edge server IPs that can be trusted for Real IP. It will use this list to overwite `X-Real-IP` and `X-Forwarded-For` with an IP from the CF-Connecting-IP header.

#### Full CF Tunnel Example

<details markdown="1">

```yaml
services:
  traefik:
    image: "traefik:v3.3"
    networks:
      - traefik_internal
    # ... whatever else you do to config traefik
    volumes:
    # ... how i get dynamic/static configs into traefik, can do this however you want
      - $DOCKER_DATA/traefik/static_config:/etc/traefik:rw
      - $DOCKER_DATA/traefik/dynamic_config:/config/dynamic:rw    
  cloudflare_tunnel:
    image: cloudflare/cloudflared:2025.2.0
    restart: unless-stopped
    # configure tunnel in cloudflare dashboard and use token from dashboard to configure container
    command: tunnel run --token ${CF_TRAEFIK_TUNNEL_TOKEN}
    networks:
        - traefik_internal
networks:
  traefik_internal:
    driver: bridge
    ipam:
    # important to set this so cloudflare_tunnel always has correct subnet
    # for traefik to recognize as trusted IP range
      config:
        - subnet: 172.28.0.0/16
```
{: file="compose.yaml" }

```yaml
providers:
  file:
    directory: /config/dynamic
    watch: true
entryPoints:
  cf:
    # address CF tunnel config is pointed to on traefik container
    address: :808
    asDefault: true
    http:
    # will always run if service/router is using cf entrypoint
    # otherwise, this middleware can be ommited here and instead used per service/router as a middleware
     middlewares:
       - cloudflarewarp@file
    # this needs to be on the entrypoint you are using for cf tunneled services
    # must match traefik_internal network
    forwardedHeaders:
      trustedIPs:
        - 172.28.0.1/24
 experimental:
  plugins:
    cloudflarewarp:
      moduleName: "github.com/PseudoResonance/cloudflarewarp"
      version: "v1.4.0"
```
{: file="/etc/traefik/traefik.yaml" }

```yaml
http:
  middlewares:
    cloudflarewarp:
      plugin:
        cloudflarewarp:
          disableDefault: false
```
{: file="/config/dynamic/global.yaml" }

</details>

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
