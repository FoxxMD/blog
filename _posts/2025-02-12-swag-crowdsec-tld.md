---
title: Crowdsec with SWAG on a Top-Level Domain 
description: >-
  Gotchas appear when using swag-crowdsec with a TLD
author: FoxxMD
date: 2025-02-12 12:00:00 -0400
categories: [Rabbit Hole]
tags: [swag, nginx, crowdsec, lua]
pin: false
---

# Background

I use [Linuxserver.io's (LSIO)](https://www.linuxserver.io/) dockerized nginx reverse-proxy solution, [SWAG](https://docs.linuxserver.io/general/swag/), as the point of ingress for public-facing services in my homelab. In addition to being easy to configure LSIO containers can be sideloaded with ["Docker Mods"](https://www.linuxserver.io/blog/2019-09-14-customizing-our-containers#docker-mods) that can provide additional functionality to the main service. Some of these are [generic](https://mods.linuxserver.io/?mod=universal) but most are specific to the container they are running on.

One of thes docker mods specific to SWAG installs and configures an [nginx bouncer](https://github.com/linuxserver/docker-mods/tree/swag-crowdsec) for [Crowdsec](https://crowdsec.net/), a community-driven quasi [WAF](https://www.cloudflare.com/learning/ddos/glossary/web-application-firewall-waf/). This mod, along with [LSIO's guide for setting up a full Crowdsec solution](https://www.linuxserver.io/blog/blocking-malicious-connections-with-crowdsec-and-swag), is a large facet of my homelab's defensive design.

# The Setup

Crowdsec reads `access.log` from nginx and then uses [leaky buckets](https://en.wikipedia.org/wiki/Leaky_bucket) along with Crowdsec scenarios (patterns) to detect bad behavior from IPs accessing my web server. When a scenario "overflows" a bucket (detected X number of times within Y minutes, simplified) the IP is then banned (added to a list in Crowdsec) for a period of time. The bouncer becomes relevant here: on each request nginx is supposed to check the banned list of IPs and return a "banned" page with 403 if the `$remote_addr` of the request matches it, regardless of what the IP is requesting.

The banning behavior was working as expected when a banned IP attempted to access any of my services behind an existing subdomain (proxy-conf in SWAG terms) **but was not occurring when the request was to a top-level domain or non-existing subdomain.**

```
realSubdomainA.myTLD.com           <-- CS intercepts, banned response
realSubdomainB.myTLD.com/something <-- CS intercepts, banned response
notASubdomainC.myTLD.com           <-- not intercepted! Returns 307
myTLD.com                          <-- not intercepted! Returns 307
myTLD.com/something                <-- not intercepted! Returns 307
```

This was perplexing...why was it only working sometimes? And basically only not working when I needed it most! IE when an attacker is probing for `.env` files and the such.

## Current Nginx Configuration

Let's take a look at my abridged configuration...this is foreshadowing. The problem is present below but trickily not immediately obvious as it is a valid config.

* `nginx.conf` is setup to include `http.d` where the crowdsec bouncer is configured
* `site-confs/default.conf` is largely the same as SWAG sets it up with these changes

```nginx
# ...

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    server_name _;

    # ...

    # modified so that
    # any requests to TLDs or non-existent subdomains
    # redirect to my portfolio static site
    location / {
      return 307 https://myStaticSite.com;
    }

    # ...
}

include /config/nginx/proxy-confs/*.subdomain.conf;
# ...
```
{: file='site-confs/default.conf'}

The non-intercepting behavior seems suspiciously consistent with what the redirect is supposed to do...

But let me tell you it was a rabbit hole to get to this point. I debugged the crowdsec side of things thoroughly thinking maybe it was an issue with scenario buckets not overflowing...or the bouncer not getting IP ban decisions in time. It wasn't until I turned on debug-level logging in nginx with `error_log ... debug;` that I was able to see the bouncer not logging anything that it clued me in that it might be my nginx directive instead.

## Well There's Your Problem

It wasn't until I got some feedback from the helpful devs on the LSIO discord server, who suspected it might be an order-of-operations issue, that I really started digging into what the nginx bouncer did and how nginx directives are processed.

Nginx procceses request in a [sequences of **phases**](https://nginx.org/en/docs/dev/development_guide.html#http_phases). If an earlier phase ends execution or causes a response to sent then all subsequent phases are not run.

The `return` directive in the `location` block is part of the [**rewrite phase**](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html) but the nginx bouncer runs in an [`access_by_lua_block`](https://github.com/openresty/lua-nginx-module?tab=readme-ov-file#access_by_lua_block) [handler](https://github.com/crowdsecurity/cs-nginx-bouncer/blob/main/nginx/crowdsec_nginx.conf#L19) that is part of the **access phase**. Critically, the rewrite phase runs before the access phase.

So, since the `location /` block was catching all these non-existing routes it was returning a response using a phase that occurred before the nginx bouncer ever run!

## The Solution

So we need to get rid of the `return` directive and use something that lets the access phase run first. 

### The Easy Way

Well, we already know that `proxy_pass` works since it's what we've been using with LSIO. Yep, random helpful internetizen on stackoverflow confirms[`proxy_pass` is part of the **content phase**](https://stackoverflow.com/a/78595091/1469797) which does run after access phase.

So let's create a dummy server inline and park our `return directive` behind a proxy.

```nginx
server {
  # prevent double logging to access.log
  access_log  off;
  listen 127.0.0.1:11111;
  return 307 https://myStaticSite.com;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    server_name _;
    # ...


    location / {
      proxy_pass http://127.0.0.1:11111;
    }
```
{: file='site-confs/default.conf'}

Boom! Problem solved. Crowdsec is intercepting all requests now. Hooray!

### The Hard Way

What's that? You want to be clever? Don't want to create new `server` blocks? Do it all in the same `location` block? Fine. But you asked for it.

Let's revisit that [lua handler](https://github.com/crowdsecurity/cs-nginx-bouncer/blob/main/nginx/crowdsec_nginx.conf#L19) provided by the crowdsec bouncer. If we do some digging we can determine that re-defining the same handler within a nested directive (http -> server -> location) will cause the ["most specific" handler to be used.](https://groups.google.com/g/openresty-en/c/0RmRy6Q2DOA). Essentially, we can override crowdsec's handler with our own.

So let's copy-paste their handle into our location block and add some code to do the redirect after cs runs.

```nginx
server {
    # ...

    location / {

        access_by_lua_block {
            local cs = require "crowdsec"
            if ngx.var.unix == "1" then
                ngx.log(ngx.ERR, "[Crowdsec] Unix socket request ignoring...")
            else
                cs.Allow(ngx.var.remote_addr)

                # custom redirect after CS
                ngx.req.set_method(ngx.HTTP_GET)
                return ngx.redirect("https://myStaticSite.com", 307)
            end
        }
    }
```
{: file='site-confs/default.conf'}

But wait..this isn't working? And if we add debug logging we can see `ngx.redirect` never runs! What gives?

Crowdsec's bouncer code is running [`ngx.exit(ngx.DECLINED)`](https://github.com/crowdsecurity/lua-cs-bouncer/blob/main/lib/crowdsec.lua#L662) when the IP is not blocked. This causes the handler to exit early and not run out code after `cs.Allow`.

So lets replace that exit with a return...

```diff
  end
-   ngx.exit(ngx.DECLINED)
+   return
end
```

Now our redirect is running! Hooray!

But now you need to deal with patching this file any time the docker-mod is updated. Manging this dependency would be a PITA but it is possible. [I've commented on an issue on the bouncer to make this easier](https://github.com/crowdsecurity/lua-cs-bouncer/issues/95) but it's still not as end-user friendly as the proxy_pass solution. Good luck with that.