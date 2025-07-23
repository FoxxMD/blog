---
title: Docker Overlay over Netbird
description: >-
  Self-hosting a Netbird wireguard network and deploying Docker Swarm/Overlay over it
author: FoxxMD
categories: [Rabbit Hole]
tags: [docker, swarm, traefik, netbird, wireguard, vxlan, overlay]
pin: false
mermaid: true
---

# Setup Netbird

## Add Peers

### Add NB Host

### Add a Lan Host

## Create Network

### Add LAN Subnet Resource

### Add Routing Peer(s) in LAN

## Optionally setup Nameserver to local DNS

## Test Netbird Barebones with Docker

### Create Test Container and confirm reachable from Routing Peer

# LAN Routing to Peer

## Create Routing

Use one of

### Manually add Route `ip route add`

### Static Route on Router

### DHCP Option 121

## Test Routing

# Swarm

## Configure Firewall

Test ports 7946 4789 2377 udp/tcp with `nc` to verify reachability and configure firewall rules for NB IP subnets if needed

* Test from routing peer
* Test from host using a static route

## Join as Worker

advertise address is NB ip

### Check logs for connectivity issues

All nodes need to be able to reach NB host, no errors

#### Configure MTU for ingress network?????

## Create Overlay

## Test Overlay

# Bonus: Connectivity w/o VPN

SSH tunnelling for port forwarding
