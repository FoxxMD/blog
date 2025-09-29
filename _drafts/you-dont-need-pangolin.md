---
title: You Don't Need Pangolin
description: >-
  Tunnel web traffic from the cloud to your network without lock-in
author: FoxxMD
categories: [Tutorial]
tags: [docker, tcp, reverse proxy, TLS, SSL, VPN]
pin: false
mermaid: true
---

*Copied from my reddit comment as a starting point...to be fleshed out later*

One point I haven't seen anyone mention about Pangolin vs. Cloudflare, or the other alternative setups mentioned here, is that Pangolin (and other reverse proxy in the VPS solutions):

* terminate TLS **in the cloud VM**
* make you configure proxied services with addresses accessible **in the cloud VM**

compared to cloudflare tunnel which

* terminates TLS on their servers
* deliver traffic directly **into your private network**

Why does this make a difference?

* TLS decryption can be computationally intensive
   * number of concurrent requests/bandwidth drops by a non-trivial amount when terminating TLS, like 10-30% depending on the processing power of the machine
* Moving reverse proxy config out of your private network (pangolin) means it's no longer "network agnostic" IE...
   * A proxy in your private network with port forwarding from your router has the same configuration (network-wise) as if your proxy is receiving traffic from cloudflare -- the proxy sits in your private network in both scenarios.
   * In the VPS/pangolin scenario, unless your whole private network is available to the VPS, you can't "just" move the proxy from one location to another without reconfiguring how all services are proxied.
      * The exception being all services addressed through VPN interfaces, but that's another layer to have to think about before services can be proxied

Given this, and since the OP asked for a tunneling mechanism like cloudflare which is *not* how pangolin works, I would suggest this setup (I am using this):

* VPS/cloud VM accepting web traffic
* VPN (anything...tailscale, headscale, netbird, nebula, etc...) connected between VPS and a machine inside your private network
* A reverse proxy/load balancer in the VPS that supports
   * TCP routing with
      * TLS/SSL passthrough to keep content encrypted, skip intensive CPU on low-power VPS ([traefik](https://doc.traefik.io/traefik/reference/routing-configuration/tcp/tls/#passthrough), [nginx](https://www.cyberciti.biz/faq/configure-nginx-ssltls-passthru-with-tcp-load-balancing/), [haproxy](https://www.ssltrust.com/help/setup-guides/haproxy-reverse-proxy-setup-guide))
      * [PROXY Protocol](https://www.haproxy.org/download/1.8/doc/proxy-protocol.txt) which encapsulates client connection information so it can be transparently passed to upstream servers ([traefik](https://doc.traefik.io/traefik/reference/routing-configuration/tcp/serverstransport/#serverstransport-proxyProtocol-version), [nginx](https://docs.nginx.com/nginx/admin-guide/load-balancer/using-proxy-protocol/#proxy-protocol-for-a-tcp-connection-to-an-upstream), [haproxy](https://www.haproxy.com/documentation/haproxy-configuration-tutorials/proxying-essentials/client-ip-preservation/enable-proxy-protocol/))
* A reverse proxy in your private network on the VPN-connected machine that accepts the connection from the load balancer in the VPS (over VPN)
   * It needs to support PROXY Protocol

With this setup...

* Proxying/routing remains inside private network, making it easy to switch to (or combine with) cloudflare tunnel or port forwarding
* TLS termination occurs on your on-prem machine so you can use a much beefier-specced machine, which reduces bandwidth loss compared to low-powered VPS
* Save money on VPS since it can be super low-powered since its basically just passing TCP traffic
* Actually replicates (most of) the behavior of cloudflare tunnel
