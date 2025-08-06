---
title: Internal Rybbit dashboard with external tracking via Traefik
description: >-
  Setup a Rybbit instance to track your external websites while keeping the dashboard private
author: FoxxMD
categories: []
tags: [docker, traefik, rybbit, analytics]
pin: false
date: 2025-08-06 15:50:00 -0400
image:
  path: /assets/img/rybbit/rybbit.webp
---

I've recently switched from Plausible to a self-hosted [Rybbit](https://www.rybbit.io) instance for analytics on my personal projects and sites. While Rybbit does have minimal guidance on configuring [Traefik](https://www.rybbit.io/docs/self-hosting-guides/nginx-proxy-manager#alternative-proxy-configurations) for use with Rybbit, it's not a complete solution.

The Rybbit docs also do not address how to set it up for a common scenario among the self-hosted community: **serving external and internal sites on separate domains.** I want data collection and client-side scripts served by a **external** endpoint but everything else -- the Rybbit dashboard, login page, etc. -- to only be accessible via my **internal** network/domain.

This post explains how to achieve this and also includes some neat tricks for getting additional functionality out of Rybbit with Traefik.

## External Tracking with Internal Dashboard

### Prerequisites

You need to have this functionality before using this guide:

* [Docker](https://docs.docker.com/engine/install/) or another OCI engine installed
* [Traefik](../migrating-to-traefik) installed and running
  * **Two domains** you own already configured and routing traffic to traefik (via [certs](http://localhost:4000/posts/migrating-to-traefik/#cert-management) or something like [cloudflare](http://localhost:4000/posts/migrating-to-traefik/#cert-management), pangolin, etc...)
  * If you don't have a second domain for internal sites, or don't have it already setup, you'll need to configure some kind of [local DNS](../redundant-lan-dns) to properly use it

### Deploy Rybbit Internally

First, we'll configure and deploy Rybbit using our **internal** domain so that we can sign up, add sites, etc... via the dashboard.

You can use the [setup script](https://www.rybbit.io/docs/self-hosting#clone-the-rybbit-repository) from the docs to generate an initial compose stack, but it will need to be modified for use with Traefik. If possible use the [Manual Docker Compose Setup](https://www.rybbit.io/docs/self-hosting-manual) instead.

```yaml
services:
  clickhouse:
    container_name: clickhouse
    image: clickhouse/clickhouse-server:25.4.2
    volumes:
      - $DOCKER_DATA/rybbit/clickhouse-data:/var/lib/clickhouse
      - $DOCKER_DATA/rybbit/clickhouse-config:/etc/clickhouse-server/config.d
    environment:
      - CLICKHOUSE_DB=${CLICKHOUSE_DB:-analytics}
      - CLICKHOUSE_USER=${CLICKHOUSE_USER:-default}
      - CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD:-frog}
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8123/ping"]
      interval: 3s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  postgres:
    image: postgres:17.4
    container_name: postgres
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-frog}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-frog}
      - POSTGRES_DB=${POSTGRES_DB:-analytics}
    volumes:
      - $DOCKER_DATA/rybbit/postgres:/var/lib/postgresql/data
    restart: unless-stopped

  backend:
    image: ghcr.io/rybbit-io/rybbit-backend:v1.5.1
    container_name: rybbit_backend
    ports:
      - "${HOST_BACKEND_PORT}"
    environment:
      - NODE_ENV=production
      - CLICKHOUSE_HOST=http://clickhouse:8123
      - CLICKHOUSE_DB=${CLICKHOUSE_DB:-analytics}
      - CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD:-frog}
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - POSTGRES_DB=${POSTGRES_DB:-analytics}
      - POSTGRES_USER=${POSTGRES_USER:-frog}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-frog}
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
      - BASE_URL=https://${BASE_URL}
      - DISABLE_SIGNUP=${DISABLE_SIGNUP}
      - DISABLE_TELEMETRY=${DISABLE_TELEMETRY}
    depends_on:
      clickhouse:
        condition: service_healthy
      postgres:
        condition: service_started
    networks:
      - default
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.rybbit-internal-backend.rule=Host(`${BASE_URL}`) && PathPrefix(`/api`)"
      - "traefik.http.services.rybbit-internal-backend.loadbalancer.server.port=3001"
    restart: unless-stopped

  client:
    image: ghcr.io/rybbit-io/rybbit-client:v1.5.1
    ports:
      - "${HOST_CLIENT_PORT}"
    environment:
      - NODE_ENV=production
      - BASE_URL=https://${DOMAIN_NAME}
      - NEXT_PUBLIC_BACKEND_URL=https://${BASE_URL}
      - NEXT_PUBLIC_DISABLE_SIGNUP=${DISABLE_SIGNUP}
    depends_on:
      - backend
    networks:
      - traefik
      - default
    labels:
      - "trafik.enable=true"
      - "traefik.http.routers.rybbit-client.rule=Host(`${BASE_URL}`)"
      - "traefik.http.services.rybbit-client.loadbalancer.server.port=3002"
    restart: unless-stopped

networks:
  default:
    internal: true
  trafik:
    external: true
```
{: file="compose.yaml"}

> In the above example
> * change `$DOCKER_DATA` to wherever you want data to be persisted on the host machine. Or use the named volumes from the official rybbit example, instead.
> * modify `networks` to match however you proxy services through traefik.
{: .prompt-tip}

The `.env` that should be used with the above compose stack:

```ini
# https://www.rybbit.io/docs/self-hosting-manual#create-environment-file

# Use the TLD ONLY
DOMAIN_NAME=myInternalDomain.io
# Subdomain (no http prefix) dashboard is reachable at
BASE_URL=rybbit.myInternalDomain.io
BETTER_AUTH_SECRET=changeMe
DISABLE_SIGNUP=false
DISABLE_SIGNUP=false
USE_WEBSERVER=false
HOST_BACKEND_PORT="3001:3001"
HOST_CLIENT_PORT="3002:3002"
```
{: file=".env"}

To summarize the differences between the above and the offical setup:

**Removed Caddy**

We don't use the Caddy container since we are using Traefik.

**`HOST_*_PORT` have been updated to listen on *all* interfaces.**

Since we are not exposing any ports on the host we want to make sure that the apps accept conenctions from the docker network interfaces that are attached to the container.

**`DOMAIN_NAME` changed to TLD**

It was previously used by Caddy but has been repurposed. We need to tell the `client` app what the top level domain it is serving on is.

**`BASE_URL` not using http prefix**

So that we can re-use this for our Traefik labels.

### Finish Rybbit Setup

Finish [deployment/configuration](https://www.rybbit.io/docs/self-hosting-manual#start-the-services) by starting the stack. The Rybbit dashboard should now be available at `https://rybbit.myInternalDomain.io`.

Create an admin account to finish setup.

### Configure External Endpoint

Right now Rybbit is only available on our **internal** domain. We need to add another [Route](https://doc.traefik.io/traefik/routing/routers/) and [Service](https://doc.traefik.io/traefik/routing/services/) to Traefik to make Rybbit publically accessible.

The key with this route is that we only want [*specific paths*](https://doc.traefik.io/traefik/routing/routers/#path-pathprefix-and-pathregexp) to be accessible when Rybbit is accessed from our **external** domain. These routes are:

* `/api/script.js`
* `/api/replay.js`
* `/api/track`
* `/api/session-replay/record`

We will use Traefik [Path and PathPrefix](https://doc.traefik.io/traefik/routing/routers/#path-pathprefix-and-pathregexp) rules with a [Host](https://doc.traefik.io/traefik/routing/routers/#host-and-hostregexp) rule to achieve this restriction. Additionally, these routes only need to be accessible to rybbit's `backend` service.

Modify the `labels` for `backend` service from your Rybbit compose file, adding these:

```yaml
- "traefik.http.services.rybbit-ext.loadbalancer.server.port=3001"
- "traefik.http.routers.rybbit-ext.rule=Host(`rybbit.myExtDomain.com`) && (Path(`/api/script.js`) || Path(`/api/replay.js`) || Path(`/api/track`) || PathPrefix(`/api/session-replay/record`))"
- "traefik.http.routers.rybbit-ext.service=rybbit-ext"
```
{: file="compose.yaml"}


<details markdown="1">

<summary>Dynamic File Config Example</summary>

If you do not want to (or cannot) use additional labels for the external route the above can be achieved by adding the following to a [dynamic config](../migrating-to-traefik/#dynamic-config)

```yaml
http:
  routers:

    ## add to your existing routers
    rybbit-ext:
      #entryPoints: # may need to specify this
      #  - "websecure"
      rule: "Host(`rybbit.myExtDomain.com`) && (Path(`/api/script.js`) || Path(`/api/replay.js`) || Path(`/api/track`) || PathPrefix(`/api/session-replay/record`))"
      service: rybbit-ext

  services:

    ## add to your existing services
    rybbit-ext:
      loadBalancer:
        servers:
          # name of rybbit backend container accessible on the traefik docker network
          - url: "http://rybbit_backend:3001"
```
{: file="/config/dynamic/sites.yaml"}

</details>

Now Rybbit accessible, but locked-down, on your externally-accessible domain!

**To recap what should/should not be accessible:**

* `rybbit.myInternalDomain.io`
  * should be the Rybbit login/dashboard
  * should **not** be accessible outside your local network
* `rybbit.myExtDomain.com`
  * should 404 when no additional path is specified
  * should **not** serve the login/dashboard
  * should serve `/api/script.js`
  * should serve `/api/replay.js`

### Note: Rybbit Tracking Script is Different

Since we are serving Rybbit's dashboard on a different domain than what is being used externally the content of the **Tracking Script** code given for a Site will be incorrect.

You will need to change the internal domain shown in the code to your external domain. Example:

```
<script
    src="https://rybbit.myInternalDomain.io/api/script.js"
    data-site-id="9"
    defer
></script>
```

SHOULD BE

```
<script
    src="https://rybbit.myExtDomain.com/api/script.js"
    data-site-id="9"
    defer
></script>
```

## Additional How-To's

### Inject Rybbit into Existing Sites

Use [packrules's Rewrite Body](https://plugins.traefik.io/plugins/6294728effc0cd18356a97c3/rewrite-body-with-compression-support) Traefik [plugin](https://doc.traefik.io/traefik/plugins/) to inject Rybbit's `script.js` code into the HTML response for a service proxied by Traefik.

This does not require modifying the source code or proxied application code in any way -- the injection is done by modifying an HTML response before it is send back to the client.

#### Install Plugin

Add the plugin to your Traefik [static config:](../migrating-to-traefik/#static-config)

```yaml
# ...

experimental:
  plugins:
    # ...
    rewrite-body:
      moduleName: "github.com/packruler/rewrite-body"
      version: "v1.2.0"
```
{: file="/etc/traefik/traefik.yaml"}

Then restart Traefik to install the plugin.

#### Add Rewrite Middleware

Add or modify the `labels` for a proxied docker service to create a new middleware with the rewrite plugin:

* It will search for the end of the `</head>` node using `regex`
* Replace it with our tracking script using `replacement` like: `<script src="https://rybbit.myExtDomain...></script></head>`

Example:

```yaml
    labels:
      #...
      traefik.enable: true
      traefik.http.routers.foo.rule: Host(`foo.myExtDomain.com`)
      traefik.http.services.foo.loadbalancer.server.port: 80
      traefik.http.middlewares.foo-rybbit.plugin.rewrite-body.rewrites[0].regex: </head>
      traefik.http.middlewares.foo-rybbit.plugin.rewrite-body.rewrites[0].replacement: <script defer data-site-id="9" src="https://rybbit.myExtDomain.com/api/script.js"></script></head>
      traefik.http.routers.foo.middlewares: foo-rybbit
```

### Tracking Server-Side Traffic

For services that do not return HTML, or if you want tracking to be fully transparent/non-invasive, I have published the [traefik-rybbit-feeder](https://plugins.traefik.io/plugins/688d0ecc1181ba8b1e36eb25/traefik-rybbit-feeder) plugin that uses the [Rybbit API](https://www.rybbit.io/docs/api) to send events directly from Traefik middleware.

This is not a replacement for `script.js` and is not as good a solution as [HTML injection](#inject-rybbit-into-existing-sites) because it cannot support replay or client specific metrics like browser size or time spent on pages. But, it is better than nothing!

#### Install Plugin

Add the plugin to your Traefik [static config:](../migrating-to-traefik/#static-config)


```yaml
experimental:
# ...
  plugins:
    # ...
    rybbit-feeder:
      moduleName: github.com/foxxmd/traefik-rybbit-feeder
      version: v0.13.4
```
{: file="/etc/traefik/traefik.yaml"}

Then restart Traefik to install the plugin.

#### Add Middleware

Create a middleware using a [dynamic config](../migrating-to-traefik/#dynamic-config). This can also be done using labels but it's noisy...

```yaml
http:
  # ...
  middlewares:
    # ...
    my-rybbit-middleware:
      plugin:
        rybbit-feeder:
          host: "http://rybbit.myExtDomain.com" # URL of your Rybbit instance

          apiKey: rb_a0938250c2c2efd061c8250c2c3707a # found in Rybbit -> Site -> Site Settings

          websites:
            # domain to capture traffic for and the site-id from Rybbit -> Site -> Site Settings
            "example.com": "1"
```

Then apply it as a middleware in the `labels` of your traefik proxied service:

```yaml
- traefik.enable: true
- traefik.http.routers.mysite.rule: Host(`example.com`)
- traefik.http.services.mysite.loadbalancer.server.port: 8080
- traefik.http.routers.mysite.middlewares: rybbit@file
```
