---
title: Crowdsec at Homelab Scale
description: >-
  How to take advantage of Crowdsec in an enthusiast, multi-host environment
author: FoxxMD
categories: [Tutorial]
tags: [docker, crowdsec, firewall, waf, security]
pin: false
mermaid: true
---

## Crowdsec?

* What is crowdsec
* Why should I use it?
* Maybe explain WAF

### Key Concepts

#### Management Instance (LAPI)

The CrowdSec application can be deployed with "management" enabled. CS docs refer to this functionality as [Local API (LAPI)](https://docs.crowdsec.net/u/user_guides/lapi_mgmt).

The Management instance is the "brains" of CrowdSec's security engine. In most non-enterprise settings there is only one Management instance that all other components talk to.

The management functionality enables the CS app to:

* Recieve decisions ("ban IP X for Y minutes") from [Log Processors](#log-processor)
* Register Log Processors (authenticate that a Log Processor can send it decisions)
* Contain a database of all decisions that [Bouncers](#bouncers) can query to apply those decisions to block attackers
  * IE the [firewall bouncer](https://docs.crowdsec.net/u/bouncers/firewall) on a machine can get all IPs that should be blocked, from the Management Instance, and add them to firewall rules for that machine
* Send notifications for decisions it recieves (ping Slack that IP X is banned for Y minutes)
* Enable you to use the crowdsec cli, [`cscli`](https://docs.crowdsec.net/docs/next/cscli/), to manage those decicions and which Log Processors are authenticated

Notably, the Management instance does *not* need acquisition config or hub collections/scenarios/etc installed on it. That is only needed on Log Processors.

#### Log Processor

The CrowdSec application can be deployed with log processing (acquisition) and scenario monitoring functionality. CS docs refer to this functionality as [Log Processing](https://docs.crowdsec.net/docs/next/log_processor/intro).

There may be many Log Processor instances of the Crowdsec application, for example one per host. Log Processors are the "senses" (see/hear/touch) of the CrowdSec "brain". They all communicate back to a Management instance.

When the CS app is used for Log Processing it:

* Has user-defined configuration to tell it what [Data Sources](https://docs.crowdsec.net/docs/next/log_processor/data_sources/intro) to consume, known as [acquistion](https://docs.crowdsec.net/docs/next/log_processor/intro#acquistions)
  * This is anything from `.log` files [on disk](https://docs.crowdsec.net/docs/next/log_processor/data_sources/file), to tailing [docker containers](https://docs.crowdsec.net/docs/next/log_processor/data_sources/docker), to tailing [journald (systemd)](https://docs.crowdsec.net/docs/next/log_processor/data_sources/journald)
* Installs and uses [Parsers](https://docs.crowdsec.net/docs/next/log_processor/parsers/intro) to understand the data consumed from Data Sources
* Installs and uses [Scenarios](https://docs.crowdsec.net/docs/next/log_processor/scenarios/intro) to monitor the parsed data for attack events
  * When a Scenario is triggered it sends a Decision to the [Management instance](#management-instance-lapi)

Note: Data Source, Parsers, and Scenarios can be installed as bundles called [**Collections**](https://app.crowdsec.net/hub/collections).

#### Bouncers

A Bouncer is an application, separate from the Crowdsec app, that is used to:

* query and interpret Decisions from the [Management instance](#management-instance-lapi)
* apply those decisions to an environment to block an attacker in some way

Crowdsec docs refer to Boucers as [Remediation Components](https://docs.crowdsec.net/u/bouncers/intro). There may be many Bouncers, all communicating with a Management instance. Bouncers are the "weapons" used to react after the CrowdSec "brain" realizes there is an "attack" (decision from Log Processor).

Some examples of bouncers, and how they use Management:

* [Firewall](https://docs.crowdsec.net/u/bouncers/firewall) - gets all IPs from Decicions stored in the Management instance and applies them as `BLOCK` rules to a host's firewall application (`iptables` or `nftables`)
* [Traefik](https://plugins.traefik.io/plugins/6335346ca4caa9ddeffda116/crowdsec-bouncer-traefik-plugin) - Installed as a middleware. When a request is intercepted it queries the Management instance for the request IP. If the IP is banned it returns a 403.

CS develops and maintains a large list of Bouncers for all popular platforms.

## Why Is this post needed?

### Prior Art Insufficient

* CS docs *tutorials* are fine for single instance, all-in-one
  * docs explain concepts are separate but all tutorials assume AIO instance
* CS docs cover multi-host as a [short guide](https://docs.crowdsec.net/u/user_guides/multiserver_setup/) and a [blog post](https://www.crowdsec.net/blog/multi-server-setup) but
  * Assume you already know how everything works already
  * Assume you want shared db, more complicated setup
  * Don't use docker for CS instances
  * Are outdated WRT config/env
  * Are aimed at systems with much larger topology than homelabs, verging on enterprise
  * Assume you will be using central api

### Why not AIO?

* Log processor performance under heavy load can cause problems https://github.com/FoxxMD/crowdsecBench
* Separating decision source (lapi) from processors is more reliable
  * IE log processor goes down or requires restart, don't make lapi unavailable for bouncers

## Architecture Overview

Architecture will be similar to https://docs.crowdsec.net/u/user_guides/multiserver_setup/

* Management instance (docker)
  * located on most stable server
  * potentially on VPS if any services also live there
* Log Process instances (docker)
  * Location based on 
    * type of data source (docker containers can be tailed from anywhere)
    * expected traffic load 
  * Use centralized log processor on beefy machine for high load, docker data sources
  * Use on-host log processor for low load or data sources that can't be tailed from docker
  * Showcase load testing stack to determine log processor feasability
  * Avoid log processor on same machine as Management unless lots of overhead
* Bouncer on each point of ingress
  * Use firewall if possible
  * cloudflare tunnel fallback to reverse proxy bouncer

## Implementation

### Create Management

* Use auto validation if possible https://docs.crowdsec.net/u/user_guides/machines_mgmt#machine-auto-validation
* Mention CSAPI
* Exposed port for incoming machine/bouncer comms, unless overlay

### Create Log Processor

* disable lapi with env
* auto register vs. register single
* discuss collections
  * discuss `DISABLED_` and performance optimizations
* explain acquis.d usage
* explain docker-socket-proxy for remote aquisition
  * explain tail container for physical logs
* use `cscli metrics` to verify acquisition

### Create Bouncer

* create bouncer api key in Management
* install bouncer component or configure for service
