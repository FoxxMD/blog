---
title: Plex Remote Access with Docker Compose
description: >-
  Configuring Plex in Docker to work with Remote Access
author: FoxxMD
date: 2024-09-05 12:00:00 -0400
categories: [Tutorial]
tags: [plex, docker, iplan, networking]
pin: false
---

**So, you are running Plex in Docker and thought [Remote Access](https://support.plex.tv/articles/200289506-remote-access/) would be easy.**

![Captain America](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExMGdhZnlmbXdsc2VvYWM4Z3J1aTZseTd1ZjdzNWM1ZGV1MWNzNW8zZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/5hbbUWcuvtoJGx5fQ4/giphy-downsized.gif){: width="650" height="325" }

Whether it works for you or not seems to be like rolling dice. Here's what I learned, and the hoops you'll need to jump through, to _maybe_ get Remote Access working when running Plex with docker (compose).

## What Plex Wants

### Forwarded Port

It needs ingress into your network so it can reach your hosted Plex server. This is the easiest part. As long as you aren't behind a NAT/CGNAT this is as simple as forwarding a port on your router to the machine where Plex is hosted. The plot thickens below though...

### Unrestricted Port Access

You'll find countless solutions on Reddit and in google searches recommending that Plex **not** be in a container using [bridge networking](https://docs.docker.com/engine/network/drivers/bridge/) because it needs access to many ports. While there are known ports that can be mapped it seems Plex chooses to use random ports for reachability as well. From `Plex Media Server.log`:

```
Sep 04, 2024 22:21:43.080 [140124105521976] INFO - [Req#63] [PlexRelay] Allocated port 26243 for remote forward to 127.0.0.1:32401
Sep 04, 2024 22:21:43.161 [140124105521976] INFO - [Req#79] [PlexRelay] Allocated port 18837 for remote forward to 127.0.0.1:32401
Sep 04, 2024 22:21:43.553 [140124105521976] WARN - [Req#ab] MyPlex: attempted a reachability check but we're not yet mapped.
Sep 04, 2024 22:21:43.621 [140124103150392] WARN - [Req#ba] MyPlex: attempted a reachability check but we're not yet mapped.
```

### Private IP on First Interface

Most importantly (and most annoyingly) **Plex listens on the first listed network interface in the container.** You can determine what this address by checking the `Private IP` on the Remote Access settings page. Alternatively, use `ifconfig` in the container (installed with `apt install net-tools`) to see all interfaces available in the container.

If this interface is not the one that has forwarded traffic from your router then Plex will consider your server as unreachable and fallback to Relay (if you have it enabled). This is especially infuriating since it could just listen on `0.0.0.0`, to all interfaces, to get that traffic and establish a direction connection.

## What You Need

#### Host Networking?

If you're familiar with docker/compose your first thought might be "Why can't I just use [host networking](https://docs.docker.com/engine/network/drivers/host/)?" and honestly this might work for you. You'll fix port access and don't have to worry about bridge networking at all. Unfortunately, this is also dependent on the [correct interface being first on your host.](#private-ip-on-first-interface) If it isn't first there's nothing you can do about it as host networking mode gives up all networking control for the container. Short of re-naming/ordering the interfaces on your host machine this is not a situation that can be fixed.

If you try host networking and it works for you, then more power to you. You can stop reading now and should be good to go. 

If your interfaces are not the correct order or you just want more reproducibility for the future, read on...

### IPvlan Network

The solution to unfettered port access and one interface, in isolation, is [IPvlan networking.](https://docs.docker.com/engine/network/drivers/ipvlan/) This allows us to give our Plex container its own IP address on the LAN without any port restrictions. It also means that, by itself, there is only one interface attached to the container so Plex will always use the correct Private IP.

> Use caution when setting up ipvlan and assigning an IP address to your container. Since you are manually setting these there is the potential for address collision which will cause serious issues for your network. Ideally you should use a subnet not in use by the rest of your LAN or reserve the IP address on your router so it can't be assigned anywhere else.
{: .prompt-warning }

Find the parent interface your ipvlan will communicate on by using `ifconfig` or `ip a show`. Look for the interface with the IP address of the host machine on your LAN, EX `inet 192.168.0.150/24`, and then use the interface name given for that entry, IE `eth0`.

```yaml
services:
  plex:
    container_name: plex
    image: linuxserver/plex:latest
    # ...
    networks:
      plexnet:
        # An address you manually assign here
        ipv4_address: 192.168.0.233
# ...
networks:
  plexnet:
    driver: ipvlan
    driver_opts:
      # the interface we found above
      parent: eth0
      ipvlan_mode: l2
    ipam:
      config:
          # same subnet and gateway as the interface we found above
        - subnet: 192.168.0.0/24
          gateway: 192.168.0.1
```

Recreate your stack to get the network to be created (and any time you edit it):

```bash
docker compose down
docker compose up
```

Inspecting the container `docker container inspect plex` should result in a Networking setting that looks similar to this:

```json
{
            "Networks": {
                "plexnet": {
                    "IPAMConfig": {
                        "IPv4Address": "192.168.0.233"
                    },
                    "Links": null,
                    "Aliases": [
                        "plex",
                        "plex"
                    ],
                    "MacAddress": "",
                    "DriverOpts": null,
                    "NetworkID": "3b63c4cb58d336307feba0798a5209f0d2c1547ccf292103127412697e173c57",
                    "EndpointID": "23af84f3e64d04ec7396dcff121412119ae982eb94769f7e44c742e77823a0e6",
                    "Gateway": "192.168.0.1",
                    "IPAddress": "192.168.0.233",
                    "IPPrefixLen": 24,
                    "IPv6Gateway": "",
                    "GlobalIPv6Address": "",
                    "GlobalIPv6PrefixLen": 0,
                    "DNSNames": [
                        "plex",
                        "79fa89e12c61"
                    ]
                },

            }
}
```

At this point you only need to [change the forwarded IP address](#forwarded-port) in your router to newly assigned IP and you should be good to go.

Now...the downside of using IPvlan is that **the new interface is isolated from all other docker networks.** Even though from your host machine you can access Plex at `192.168.0.233` you will find that this is not the case from any other container. This is problematic if you use any other services with Plex such as [Tautulli](https://tautulli.com/) or [Overseer](https://overseerr.dev/).

To fix this we need to re-introduce bridge networking but with a small quirk...

### Bridge Network with Priority

As mentioned in the previous section, you only need to complete this step if you have other containers/services in your compose stack that need access to Plex.

The issue with this is that we still have to deal with that [pesky first interface problem Plex has.](#private-ip-on-first-interface) Docker does not have an explicit way to name interfaces within a container, or give priority to attaching, but it _does_ have This One Weird Trick™️ for working around this problem. Thanks to [h4ck3rk3y](https://github.com/moby/moby/issues/25181#issuecomment-1410883805) and [limscoder](https://github.com/moby/moby/issues/35221#issuecomment-537102824) in the Docker github issue comments for discovering that Docker attaches interfaces **based on alphabetically order of their names!**

Using this trick we can now _force_ our ipvlan interface to be attached first by giving it a name alphabetically earlier than our bridge (default) network:

```yaml
services:
  plex:
    image: linuxserver/plex:latest
    # ...
    networks:
      plexnet:
        ipv4_address: 192.168.0.233
      default: # specify we want our container attached to default (bridge) network, as well
        aliases:
          - plexlocal # give container an alias on bridge network so we can connect to it by name from other containers
# ...
networks:
  plexnet:
    name: aaa # give an early alphabetical name
    driver: ipvlan
    driver_opts:
      parent: ens18
      ipvlan_mode: l2
    ipam:
      config:
        - subnet: 192.168.0.0/24
          gateway: 192.168.0.1
  default:
    name: zzz # specify default network name, later than plexnet name
```

Now when we inspect our container:

```json
{
            "Networks": {
                "aaa": {
                    "IPAMConfig": {
                        "IPv4Address": "192.168.0.233"
                    },
                    "Links": null,
                    "Aliases": [
                        "plex",
                        "plex"
                    ],
                    "MacAddress": "",
                    "DriverOpts": null,
                    "NetworkID": "3b63c4cb58d336307feba0798a5209f0d2c1547ccf292103127412697e173c57",
                    "EndpointID": "23af84f3e64d04ec7396dcff121412119ae982eb94769f7e44c742e77823a0e6",
                    "Gateway": "192.168.0.1",
                    "IPAddress": "192.168.0.233",
                    "IPPrefixLen": 24,
                    "IPv6Gateway": "",
                    "GlobalIPv6Address": "",
                    "GlobalIPv6PrefixLen": 0,
                    "DNSNames": [
                        "plex",
                        "79fa89e12c61"
                    ]
                },
                "zzz": {
                    "IPAMConfig": null,
                    "Links": null,
                    "Aliases": [
                        "plex",
                        "plex",
                        "plexlocal"
                    ],
                    "MacAddress": "02:42:ac:0d:00:02",
                    "DriverOpts": null,
                    "NetworkID": "5fe40284188df02697e0437d4c3d6495b2ad379f167cb094a8873b32b00e3a83",
                    "EndpointID": "c4a058c9543d546bbb752593a75221cc11f2c01601f4a601941c9d2e9a475810",
                    "Gateway": "172.13.0.254",
                    "IPAddress": "172.13.0.2",
                    "IPPrefixLen": 24,
                    "IPv6Gateway": "",
                    "GlobalIPv6Address": "",
                    "GlobalIPv6PrefixLen": 0,
                    "DNSNames": [
                        "plex",
                        "79fa89e12c61"
                    ]
                }
            }
}
```

We see it has two attached networks with the names we gave. Inspect `ifconfig` output from the container:

```shell
# ifconfig
eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 192.168.0.233  netmask 255.255.255.0  broadcast 192.168.0.255
        ether bc:24:11:06:95:d8  txqueuelen 0  (Ethernet)
        RX packets 40175  bytes 58455639 (58.4 MB)
        RX errors 0  dropped 2578  overruns 0  frame 0
        TX packets 36774  bytes 137290812 (137.2 MB)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0

eth1: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500
        inet 172.13.0.2  netmask 255.255.255.0  broadcast 172.13.0.255
        ether 02:42:ac:0d:00:02  txqueuelen 0  (Ethernet)
        RX packets 6790  bytes 586521 (586.5 KB)
        RX errors 0  dropped 0  overruns 0  frame 0
        TX packets 9632  bytes 2310195 (2.3 MB)
        TX errors 0  dropped 0 overruns 0  carrier 0  collisions 0
...
```

we see that our ipvlan interface is listed first as eth0, so Plex grabs the correct interface to listen on.

Other containers in the stack that need to communicate with the Plex container can now use `plexlocal` instead of an IP address, as well.

## Conclusion

This could all be avoided if Plex just listened on `0.0.0.0`.

![Obama](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExMzhuZzJtc2cwcndpaDU4bmp2aW05aGd0NGd0dGgxYjU3eXpsMml2MiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/pPhyAv5t9V8djyRFJH/giphy-downsized.gif){: height="325" }
