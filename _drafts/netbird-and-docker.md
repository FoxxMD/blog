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

If you do this make sure there is a way to remove the static route on the device making the next hop or else any traffic to/from netbird will loop indefinitely trying to hop to itself.

Can use [DHCPCD or DHCLIENT hooks](https://netbeez.net/blog/linux-dhcp-hooks-network-engineers/) to setup a script to delete the route when the associated interface comes up:

```shell
#!/bin/bash

if [[ "$interface" == "ensX" ]]
then
    echo -e "\nRemoving extra routes"
    ip route del 100.110.0.0/16 via 192.168.0.X dev ensX
fi
```

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

Need to set mtu here with 

```
--opt com.docker.network.driver.mtu=1280
```

## Test Overlay

# Bonus: Connectivity w/o VPN

SSH tunnelling for port forwarding
