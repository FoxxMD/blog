---
title: LAN-Only DNS with failover
description: >-
  How to use Technitium and keepalived for high-availability homelab DNS
author: FoxxMD
date: 2025-04-22 12:55:00 -0400
categories: [Tutorial]
tags: [dns, docker, keepalived, vrrp, technitium, failover, high-availability]
pin: false
---

> *Parts of this post were originally published in an [earlier post](../lan-reverse-proxy-https#step-3-setting-up-lan-only-dns), this a more thorough version.*
{: .prompt-info }

There are a huge number of articles and guides for homelabs that discuss using reverse proxies (nginx, traefik, caddy) in a lan/local/internal-network only environment but surprisingly few of them cover what is required to go from

> **"I have configured my reverse proxy to serve requests to `mysite.mydomain.com`"**

to

> **`mysite.mydomain.com` in every browser and device on my network points to that reverse proxy**

Likely because getting to this point can be done in many different ways, has many pitfalls, and is non-trivial to setup.

This guide covers:

* (Background) at a high level, how DNS can be resolved in a home network setting, from most specific to most general
* (Setup) how to implement a resilient DNS solution for your whole home network (router-level)
  * Using two dockerized Technitium DNS servers
    * *Records* are synchronized between instances
    * `keepalived` is used to provide failover/redundancy
  * With ad-blocking
  * Setting up LAN-only, wildcard subdomain resolution for your domain

## Background

If you already know exactly why you would need this feel free to skip ahead to **Setup**. For everyone else...

### What Is Missing?

The missing glue required to make devices on your network use your reverse proxy when using `mysite.mydomain.com` is **DNS** ([Domain Name System](https://www.cloudflare.com/learning/dns/what-is-dns/)) and a [**DNS Resolver**](https://www.geeksforgeeks.org/address-resolution-in-dns-domain-name-server/).

* DNS - Software (servers, usually) that converts an address like `mysite.mydomain.com` to an IP address like `192.168.0.100` that a machine can use to make a connection
* DNS Resolver - Software that dictates to a machine/device what DNS server to use for converting an address, when the machine/device requests it[^resolver-optional]

**Your reverse proxy (nginx, traefik, caddy) does not provide DNS.** You must make explicit changes to your machines/network in order for them to point `mysite.mydomain.com` to `192.168.0.100`.

### Where is an Address Resolved?

<!-- TODO: Add link to more in-depth resolver journey -->

When your device (PC, for example's sake) makes a request to `mysite.mydomain.com` it starts a journey to find the DNS that knows about this address. The journey begins in the most specific place, right on the device, and continues "upstream" making requests to further and further away DNS servers until one of them knows about the address, or there are no more servers to ask. Let's take a look at this journey, step-by-step, starting with the specific location.

#### On Device

Generally, there is a program built in to the device OS that determines the order in which DNS resolution is done. Usually this program first looks at plain files (like `/etc/hosts` on linux or `/etc/resolver` on macOS), then any on-device DNS servers like [dnsmasq](https://dnsmasq.org/doc.html), and finally network locations.

You may have seen some reverse proxy guides instruct you to modify `/etc/hosts` to add your domain name like

```
127.0.0.1 mysite.mydomain.com
```
{: file="/etc/hosts"}

This will work *but only for this device.* You *could* modify every `/etc/hosts` on ever computer on your network but that's not a truly feasible option...

#### Local Network

If on-device DNS does not resolve the address then the device uses the *configured DNS nameserver* as the next hop on its journey to resolve the address. The nameserver that is used can be configured in several ways.

Generally, this is done automatically. When your device connects to a new network the DHCP server (your router, usually) tells the device what nameserver to use. Normally this is just the IP address of the router itself, which has a DNS server/resolver built-in.

The nameserver can also be configured manually using `/etc/resolv.conf` or by using whatever network settings your device has usually under a setting for "DNS".

**Critically, the *automatic* approach used by your router can usually be configured by you!** In your router's settings you can tell it to provide an explicit IP address (or two or three of them) as the DNS for each device. Then, each device will use the IP you gave it to try address resolution, without any manual configuration on your part.

#### Internet

If local-network level DNS cannot resolve the address then it hops to a further DNS server, usually on the [internet at large](https://one.one.one.one/), and this continues up the chain until a server can answer or a [root name server](https://en.wikipedia.org/wiki/Root_name_server) is reached.


### Where does LAN-Only DNS Fit In?

Our goal is set up our own, [recursive DNS server](https://www.cloudflare.com/learning/dns/what-is-recursive-dns/) that is provided by our [local network's DHCP server/router](#local-network) so that:

* all devices on our network are automatically configured to use our server (no setup required per device)
* our DNS server resolves our "LAN-only" address `mysite.mydomain.com` only for our devices inside the network

We will get additional benefits from this such as ad-blocking and better privacy, but those are the main objectives.

### What about Pi-hole?

[Pi-hole](https://pi-hole.net/) is a great solution for a dns-based/network-wide adblock but it's not a good replacement for a "full" DNS server. Its primary purpose is for blocking ads, not authoritative DNS administration so it's missing many of the features true DNS software offers. Namely, for our use case, it does not support [wildcard in local DNS records](https://discourse.pi-hole.net/t/support-wildcards-in-local-dns-records/32098/12) without modifying the underlying dnsmasq instance which is outside the scope of pi-hole configuration.

If you have an existing Pi-hole configuration and _really really_ do not want to switch to Technitium (it can do the same full ad-blocking with upstream DNS like Pi-hole) you can modify dnsmasq using one of the solutions from the [above-linked discussion](https://discourse.pi-hole.net/t/support-wildcards-in-local-dns-records/32098/12) or  manage your domains _without the benefit of wildcards_ by using Pi-hole's Local DNS features. [Here's another article explaining how to use those features.](https://www.techaddressed.com/tutorials/using-pi-hole-local-dns/#dns)

<details markdown="1">
  <summary>TL;DR Domain Management in Pi-hole</summary>

Open the Pi-hole dashboard, then:

* Local DNS -> DNS Record
  * **Domain:** `MY_DOMAIN.com`
  * **IP Address:** `Reverse Proxy Local IP`
* Local DNS -> CNAME Records
  * For each subdomain add a CNAME pointing back to the same domain
  * **Domain:** `subdomain.MY_DOMAIN.com`
  * **Target Domain:** `subdomain.MY_DOMAIN.com`

</details>

## Setup



___

## Footnotes

[^resolver-optional]: Often times the software can serve as both a DNS server and the resolver but it is not required.
