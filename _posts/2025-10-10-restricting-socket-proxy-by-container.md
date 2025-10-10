---
title: Restricting Docker Socket Proxy by Container
description: >-
  Further enhance security for socket-proxy usage with this one wierd trick
author: FoxxMD
categories: [Tutorial]
tags: [docker, socket-proxy, security, container labels, self-hosted]
pin: false
mermaid: false
date: 2025-10-10 13:41:00 -0400
---

## Intro

In the homelab it is common to find services that consume *some* part of the Docker API in order to provide easy discovery or monitoring of your docker containers/services.

Most of these services only require access to a specific part of the API, and it is usually read-only. However, the normal way of accessing the Docker API does not provide any access control for these services and so solutions like [docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) have been created to restrict this access.

Unfortunately, even these solutions can be too broad in the access they expose: their access control is granular only to the api "category" level without (usually) providing any control over the individual routes *and* resources.

Effectively: a service that only needs access to one specific container still has access to read data for *any* container on that docker host.

**In this article I introduce a new "proxy for your proxy" that enables filtering Docker API responses to specific containers, to further enhance security and restrict access for specific usecases.**

## What is the Docker API?

The Docker Daemon running on your host machine communicates with programs using an HTTP API (usually) served over unix socket, the [Docker Engine API](https://docs.docker.com/reference/api/engine/version/v1.48/). The aforementioned socket is a [network socket](https://www.geeksforgeeks.org/linux-unix/understanding-unix-sockets/) accessible through the filesystem, normally at `/var/run/docker.sock`.

Using this socket the Docker client, and any other program with access to `docker.sock`, can interact with any part of your Docker instance: start/stop container, create new containers, volumes, networks, get container logs and info, etc...

> If you aren't familiar with unix sockets all that you need to understand about communication through it is that it's essentially the same as making normal HTTP calls.
> 
> For instance, to [get a list of all containers](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerList) running on a host a call to the Docker API would be:
> 
> ```shell
> $ curl --unix-socket /var/run/docker.sock http:/v1.50/containers/json
> # response output:
> [{"Id":"2c97d3e28dafa0b9af160bcbc67c5785930cfa2fbef2802ffe0ff8a76285da47","Names":["/my-service-a"],"Image":"qmcgaw/gluetun", ... ]
> ```
{: .prompt-tip }

This makes communication with the Docker Daemon easy but it's also a problem: **the Docker API has no authentication and no access control.** Other than filesystem permissions applied to `docker.sock`, if a program can access `docker.sock` then it can do *anything* with Docker.

This is not an issue for the Docker client since that's its intended use, but if another program or service wants to use the Docker API there is no way to control what it can do with that access.

## Restricting Docker API with Socket Proxy

Smart folks realized this unrestricted access could be a problem and quickly came up with a good solution: an HTTP server that *proxies* requests to `docker.sock` for you.

Rather than giving your service direct access to `docker.sock` you can instead configure it to connect through the *docker socket proxy* to get the same interface to the Docker API. Then, the proxy can be configured to allow/disallow access to parts of the Docker API by blocking requests to routes by name.

As an example, your Service A only needs to get a list of containers to see which have the label `my.cool.label=foo`. Our docker socket proxy can disallow all requests except those that are prefixed with `/containers`. It can additionally only allow `GET` requests to this route. Now, Service A only has access to the relevant part of the API for containers and has read-only access (cannot restart/stop/create containers).

There are *many* docker socket proxy implementations that exist today, but the most popular ones are:

* [tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy)
* [linuxserver/socket-proxy](https://docs.linuxserver.io/images/docker-socket-proxy/)
* [wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy)

### Not Enough Restriction

The existing socket proxy implementations are great but they are still lacking more granular access controls, in my opinion.

Consider our example from above where we want to get a list of containers with the label `my.cool.label=foo`: We can configure our socket proxy to allow only access to container endpoints but when Service A makes a request to [/containers/json](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerList) it is still getting a response *with all the containers on the host*. Even though it may only need to be able to see 1 or 2 containers to do its job it can read data about all other 50+ containers. 

Additionally, Service A can still make any GET request for any container, even if it doesn't need them. Concerningly, the [Inspect a container endpoint](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerInspect) returns all environmental variables for a container. What if those ENVs contain secrets and sensitive keys? It can also [Get containers logs](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerLogs) for any container which may also contain sensitive data.

While Service A may use the API as intended this won't stop an attacker from exploiting it or accessing your network from another vector. Anyone who can access the port of the socket proxy can read any data about any container. Not great!

#### Mitigating Socket Proxy Access

*Some* of the attack vectors mentioned above can be mitigated by restricting how a socket proxy is exposed. If the service that needs docker access is on the same host that needs to be accessed then the socket proxy can be created in the same stack as the service and communication can happen on the isolated stack network, rather than over the docker bridge.

<details markdown=1>

<summary>Example</summary>

**❌ Using socket proxy over the docker bridge (don't do this!)**

```yaml
services:
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
     - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
     - POST=0
     - CONTAINERS=1
    ports:
      # any client can connect to proxy using HOST_IP:2375, not good!
      - 2375:2375
```
```yaml
services:
  serviceA:
    image: myService
    environment:
      # connecting over docker bridge, uh oh!
      - DOCKER_HOST=192.168.0.101:2375
```

**✅ Using socket proxy over isolated stack network**

```yaml
services:
  serviceA:
    image: myService
    environment:
      # connecting over internal stack network
      - DOCKER_HOST=docker-socket-proxy:2375
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    volumes:
     - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
     - POST=0
     - CONTAINERS=1
    # no ports required since connection is over stack network
```

</details>

This can be extended to remote hosts if you use [docker overlay networks](../migrating-to-traefik#swarm-and-overlay) with Docker Swarm. However, this isn't possible if you don't have Swarm setup or there are other network factors that prevent overlay networks from working across hosts.

## Restricting Docker API to Specific Containers

To address the problem of exposing all containers I have created [**docker-proxy-filter**](https://github.com/FoxxMD/docker-proxy-filter) (DPF).

DPF is an *additional* proxy that sits in front of your socket proxy and enables you to filter Docker API *responses* and *container specific routes* based on container names and labels. It is used exactly the same as other socket proxies, as far as your services are concerned.

**Using filters with DPF changes [Docker API container routes](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container) like so:**

* **Filters [List Containers](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerList) responses so any container that does not match filters is excluded from the returned list**
* **Any other [Container](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container) endpoints will return 404 if it does not match a filter**

Now, in addition to the restrictions configured by your normal socket proxy, you can restrict the containers that are exposed by your socket-proxy.

Going back to our initial example of

> Service A wants to get a list of containers that have label `my.cool.label=foo`

We can configure DPF to only expose containers that have that exact label. The List Containers endpoint now returns 2 containers instead of 50+. Calls to `/containers/{id}/json` return 404 if the container does not have our label attached. We're only exposing what is needed!

## `docker-proxy-filter` Usage

Like other socket proxies, DPF is configured through environmental variables passed to the container. This, and more, is covered in [docker-proxy-filter's repository README.](https://github.com/FoxxMD/docker-proxy-filter)

* `PROXY_URL` - The URL of the *existing* socket proxy DPF will connect through EX `http://socket-proxy:2375`
* `CONTAINER_NAMES` (optional) - A comma-delimited list of values that should appear in valid container names. Any value matched will mark the container as valid.
  * EX `frigate,postgres` will match container names like `frigate-nvidia` and `postgres11`
* `CONTAINER_LABELS` (optional) - A comma-delimited listed of key-values that should appear in valid container labels. Any container label that matches any filter value will be marked as valid.
  * Values are optional so it is possible to search only for label keys.
    * EX `CONTAINER_LABELS=foo` will match any container labels whose key contains `foo` like `com.mylabel.foo=bar`
  * Full key-values are matched together, but as "part" of larger strings.
    * EX `CONTAINER_LABELS=com.foo=bar` will match any container label where the key contains `com.foo` AND value contains `bar` like `com.foo.fun=barstuff`
* `SCRUB_ENVS` (optional) - Replaces environmental variables list with an empty list in [Container Inspect responses](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerInspect).

`CONTAINER_NAMES` and `CONTAINER_LABELS` are independent filters. Any container that matches *either* filter will be valid.

## Example

### Homepage Docker Integration

#### Scenario

[Homepage](https://gethomepage.dev/), a popular startpage application, can [use the Docker API](https://gethomepage.dev/configs/docker/) to discover services automatically for its dashboard.

Homepage uses the Docker API to:

* Query the [List Containers](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerList) (`/containers/json`) endpoint to find services by label.
* Query the [Inspect Container](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerInspect) (`/containers/{id}/json`) endpoint for service state, among other things.

It does not need access to any other Docker API endpoints, and does not need access to any container that does not have a `homepage` label.

We have Homepage deployed on **Server A** and we want it to discover services running on **Server B** at **192.168.0.101**.

#### Implementation

##### Deploy docker-proxy-filter with a socket-proxy implementation

I am choosing to use [wollomatic/socket-proxy](https://github.com/wollomatic/socket-proxy) as the backing proxy service for DPF because it provides additional functionality by allowing routes to be restricted by regular expression. The configuration below for wollomatic/socket-proxy:

* Only allows connections from a container named `proxy-container` (docker-proxy-filter)
* Disallows all methods except `GET`
* Only allows routes to `containers/*`

For docker-proxy-filter:

* we set `CONTAINER_LABELS=homepage` so that only containers that contain `homepage` in their labels are returned for Container List and for access to individual routes
* expose port `2375` so that Homepage can connect to it

```yaml
services:
  proxy-container:
    image: foxxmd/docker-proxy-filter
    environment:
      - PROXY_URL=http://socket-proxy:2375
      - CONTAINER_LABELS=homepage
    ports:
      - 2375:2375
  socket-proxy:
    image: wollomatic/socket-proxy:1.10.0
    restart: unless-stopped
    user: 0:0
    mem_limit: 64M
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    command:
      - '-loglevel=debug'
      - '-listenip=0.0.0.0'
      - '-allowfrom=proxy-container'
      - '-allowGET=/(v1\..{1,2}/)?(containers).*'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

##### Configure Homepage

Finally, we configure [`docker.yaml` in our Homepage configuration](https://gethomepage.dev/configs/docker/) to connect to docker-proxy-filter like a normal socket-proxy:

```yaml
server-b:
  host: 192.168.0.101
  port: 2375
```

And we're done! Now, Homepage (and any other actor) connecting to `192.168.0.101:2375` will only be able to get read-only access to containers that have `homepage` in their labels, rather than all containers as with a normal socket proxy.

### Monitor All Services with scrubbed ENVs

#### Scenario

Maybe you want to be able to monitor all services for a host. Or can't narrow down to a subset immediately. You can still expose container info while removing sensitive environmental variables and restricting routes to prevent inspect container contents in a way that might reveal sensitive data.

#### Implementation

* `allowGET` allows only ping, info, version, and requests to List Container and Container Inspect
  * disallows container routes that could expose sensitive data like [export](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerExport) and [archive](https://docs.docker.com/reference/api/engine/version/v1.48/#tag/Container/operation/ContainerArchive)
* `SCRUB_ENVS` replaces environmental variables in Container Inspect with an empty list
* Omitting `CONTAINER_LABELS` and `CONTAINER_NAMES` means all containers will be marked as valid

```yaml
services:
  proxy-container:
    image: foxxmd/docker-proxy-filter
    environment:
      - PROXY_URL=http://socket-proxy:2375
      - SCRUB_ENVS=true
    ports:
      - 2375:2375
  socket-proxy:
    image: wollomatic/socket-proxy:1.10.0
    restart: unless-stopped
    user: 0:0
    mem_limit: 64M
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges
    command:
      - '-loglevel=debug'
      - '-listenip=0.0.0.0'
      - '-allowfrom=proxy-container'
      - '-allowHEAD=/_ping'
      - '-allowGET=/_ping|/(v1\..{1,2}/)?((info|version)$|containers/(json$|.*/json$))'
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```
