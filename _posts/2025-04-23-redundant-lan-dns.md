---
title: LAN-Only DNS with failover
description: >-
  How to use Technitium and keepalived for high-availability homelab DNS
author: FoxxMD
date: 2025-04-23 12:55:00 -0400
categories: [Tutorial]
tags: [dns, docker, keepalived, vrrp, technitium, failover, high-availability]
mermaid: true
pin: false
image:
  path: /assets/img/dns/techdash.webp
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

When your device (PC, for example's sake) makes a request to `mysite.mydomain.com` it starts a journey to find the DNS that knows about this address. The journey begins in the most specific place, right on the device, and continues "upstream" making requests to further and further away DNS servers until one of them knows about the address, or there are no more servers to ask. Let's take a look at this journey[^simplified], step-by-step, starting with the specific location.

#### On Device

Generally, there is a program built in to the device OS that determines the order in which DNS resolution is done. Usually this program first looks at plain files (like `/etc/hosts` on linux or `/etc/resolver` on macOS), then any on-device DNS servers like [dnsmasq](https://dnsmasq.org/doc.html), and finally network locations.

You may have seen some reverse proxy guides instruct you to modify `/etc/hosts` to add your domain name like

```
127.0.0.1 mysite.mydomain.com
```
{: file="/etc/hosts"}

This will work *but only for this device.* You *could* modify every `/etc/hosts` on every computer on your network but that's not a truly feasible option...

#### Local Network

If on-device DNS does not resolve the address then the device uses the *configured DNS nameserver* as the next hop on its journey to resolve the address. The nameserver that is used can be configured in several ways.

Generally, this is done automatically. When your device connects to a new network the DHCP server (your router, usually) tells the device what nameserver to use. Normally this is just the IP address of the router itself, which has a DNS server/resolver built-in.

The nameserver can also be configured manually using `/etc/resolv.conf` or by using whatever network settings your device has usually under a setting for "DNS".

**Critically, the *automatic* approach used by your router can usually be configured by you!** In your router's settings you can tell it to provide an explicit IP address (or two or three of them) as the DNS for each device. Then, each device will use the IP you gave it to try address resolution, without any manual configuration on your part.

#### Internet

If local-network level DNS cannot resolve the address then it hops to a further DNS server, usually on the [internet at large](https://one.one.one.one/), and this continues up the chain until a server can answer or a [root name server](https://en.wikipedia.org/wiki/Root_name_server) is reached.


## How It Works

### Local DNS

Our first goal is set up our own, [recursive DNS server](https://www.cloudflare.com/learning/dns/what-is-recursive-dns/) that our [local network's DHCP server/router](#local-network) tells all devices to use so that all devices on our network are automatically configured to use our server (no setup required per device).

To achieve this we will use the [docker version](https://github.com/TechnitiumSoftware/DnsServer/blob/master/docker-compose.yml) of [**Technitium**](https://technitium.com/dns/) as our DNS Server which will give us additional benefits uch as ad-blocking, better privacy, and client-domain logging.

### High Availability

Our second goal is to make our DNS server setup (more) redundant. DNS is a mission-critical component of network and leaving it as a single point of failure for your entire network is more a question of *when*, rather than *if*, something will go wrong.

![It was DNS](/assets/img/dns/it-was-dns.jpeg)
_A haiku about DNS - Credit: [nixCraft](https://www.cyberciti.biz/humour/a-haiku-about-dns/)_

The naive way to add redundancy would be to simply setup a second Technitium container and tell our router to use both container's IPs for DNS. This would be flawed though since most systems don't do any type of load balancing for DNS automatically -- if one container was down a random percentage of DNS requests would fail since they'd be sent to the down container.

Instead, we will use [**keepalived**](https://www.keepalived.org/) to create a Virtual IP using [VRRP](https://www.haproxy.com/glossary/what-is-vrrp-virtual-router-redundancy-protocol) that our Technitium containers will sit behind. Each keepalived instance sits next to a Technitium container and monitors the *other* Technitium container. If one container goes down keepalived updates the Virtual IP to route to the other container.

![Keepalive Diagram](/assets/img/dns/keepalive-diagram.jpg)
_Simplified diagram of how keepalived works_

We will then configure our [network-level router](#local-network) to provide **only** the Virtual IP as the dns server to all devices on the network. Now, if one container goes down the other will take over routing requests using the same IP.

### Local Records and Syncing

Our last goal is to configure our DNS to point requests on our network from `mysite.mydomain.com` to our reverse proxy and have these records synced between our two Technitium instances. To do this we will create DNS records on one instance (primary) and then use [Secondary DNS Zones](https://www.cloudflare.com/learning/dns/glossary/primary-secondary-dns/) on our secondary/backup Technitium instance to read these zones from the primary.

## Setup

> In all of the setup/configurations examples replace these values based on how you [configured your stacks](#create-technitium-servers) as well as with your own IPs of the primary/secondary host.
> 
> * `192.168.HOST.IP = IP that technitium instance is running on`
> * `192.168.VIRTUAL.IP = VIRTUAL_IP set in stacks`
> * `192.168.PRIMARY.IP = Primary technitium host IP`
> * `192.168.SECONDARY.IP = Secondary technitium host IP`
> * `192.168.OTHER.IP = Host IP of the OTHER technitium instance`
> * `192.168.REVERSE.IP = Host IP of the machine running your reverse proxy`
{: .prompt-info}

### Prerequisites

* An OCI engine like [Docker](https://www.docker.com/) or Podman must be installed (and [docker compose](https://docs.docker.com/compose/) to use examples in this guide)
* **Both hosts that will run keepalived must have packet forwarding and nonlocal address binding enabled.**

<details markdown="1">

<summary>Enabling Packet Forwarding and Nonlocal Binding for Linux</summary>

[*Based on these instructions*](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/7/html/load_balancer_administration/s1-initial-setup-forwarding-vsa#s1-initial-setup-forwarding-VSA)

##### Packet Forwarding

To enable packet forwarding edit `/etc/sysctl.conf` and edit the existing entry or add the following:

```
net.ipv4.ip_forward = 1
```

Apply settings by rebooting or `sudo sysctl -p`

Test if forwarding is enabled with the following command, if it returns `1` it is enabled.

```bash
/usr/sbin/sysctl net.ipv4.ip_forward
```

##### Nonlocal Address Binding

To enable nonlocal binding edit `/etc/sysctl.conf` and edit the existing entry or add the following:

```
net.ipv4.ip_nonlocal_bind = 1
```

Apply settings by rebooting or `sudo sysctl -p`

Test if forwarding is enabled with the following command, if it returns `1` it is enabled.

```bash
/usr/sbin/sysctl net.ipv4.ip_nonlocal_bind
```

</details>

### Create Technitium Servers

These stacks should be created on **two physically different machines.**

<details markdown="1">

<summary>Technitium Primary</summary>

```yaml
services:
  technitium-primary:
    image: "technitium/dns-server:latest"
    privileged: true
    restart: always
    environment:
      - DNS_SERVER_LOG_USING_LOCAL_TIME=true
    network_mode: "host"
    ports:
      - "5380:5380/tcp"
    volumes:
      - ./technitium:/etc/dns
  keepalived:
    image: shawly/keepalived:edge-7f210c3
    restart: always
    environment:
      TZ: America/New_York
      KEEPALIVED_VIRTUAL_IP: ${VIRTUAL_IP}
      KEEPALIVED_VIRTUAL_MASK: 24
      KEEPALIVED_CHECK_IP: ${CHECK_IP}
      KEEPALIVED_CHECK_PORT: ${CHECK_PORT}
      KEEPALIVED_VRID: 150
      # change to primary LAN interface used by the host
      KEEPALIVED_INTERFACE: eth0
      KEEPALIVED_PRIORITY: 255
      KEEPALIVED_STATE: MASTER
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_BROADCAST
```
{: file="compose.yaml"}


```ini
# change to an unused IP in your LAN subnet -- will be the same value on both stacks
VIRTUAL_IP=192.168.VIRTUAL.IP
# Host IP of the other machine
CHECK_IP=192.168.1.SECONDARY.IP
CHECK_PORT=53
```
{: file=".env"}

</details>

<details markdown="1">

<summary>Technitium Secondary</summary>

```yaml
services:
  technitium-secondary:
    image: "technitium/dns-server:latest"
    privileged: true
    restart: always
    environment:
      - DNS_SERVER_LOG_USING_LOCAL_TIME=true
    network_mode: "host"
    ports:
      - "5380:5380/tcp"
    volumes:
      - ./technitium:/etc/dns
  keepalived:
    image: shawly/keepalived:edge-7f210c3
    restart: always
    environment:
      TZ: America/New_York
      KEEPALIVED_VIRTUAL_IP: ${VIRTUAL_IP}
      KEEPALIVED_VIRTUAL_MASK: 24
      KEEPALIVED_CHECK_IP: ${CHECK_IP}
      KEEPALIVED_CHECK_PORT: ${CHECK_PORT}
      KEEPALIVED_VRID: 150
      # change to primary LAN interface used by the host
      KEEPALIVED_INTERFACE: eth0
      KEEPALIVED_PRIORITY: 100
      KEEPALIVED_STATE: BACKUP
    network_mode: host
    cap_add:
      - NET_ADMIN
      - NET_BROADCAST
```
{: file="compose.yaml"}


```ini
# change to an unused IP in your LAN subnet -- will be the same value on both stacks
VIRTUAL_IP=192.168.VIRTUAL.IP
# Host IP of the other machine
CHECK_IP=192.168.1.PRIMARY.IP
CHECK_PORT=53
```
{: file=".env"}

</details>

The only differences in the two stacks, besides the service names, are

* `KEEPALIVED_PRIORITY` - This determines which DNS server to use if both report as healthy. The higher priority (number value) instance wins.
* `KEEPALIVED_STATE` - This determine which DNS server is the "initial" instance to use when the Virtual Router comes online.

If you would prefer that both instances are equal in terms of which is chosen (and keep using whichever is chosen last) then change both to:

* `KEEPALIVED_PRIORITY: 100`
* `KEEPALIVED_STATE: backup`

In the `.env` `CHECK_IP` should always be the host IP of the **OTHER** Technitium instance.

### Configure Technitium

On both instances you will need to setup an admin user/password when connecting to the web interface for the first time (`http://HOST_IP:5380`).

#### General

Navigate to `Settings -> General` and configure these settings **on each instance:**

**DNS Server Domain**: set a unique name for each instance

**DNS Server Local End Points:**

```
0.0.0.0:53
192.168.HOST.IP:53
192.168.VIRTUAL.IP:53
[::]:53
```

**Zone Transfer Allowed Networks:**

```
192.168.OTHER.IP
```

**Notify Allowed Networks:**

```
192.168.OTHER.IP
```

**Save Settings** at the bottom of the page.

#### Recursion

Enabling recursion enables Technitium to answer DNS queries for domains it doesn't have first-hand records for (configured in Zones). We want to allow recursion so that it can answer any query.

Navigate to `Settings -> Recursion` and enable **Allow Recursion** for both instances. **Save Settings**

#### Ad-Blocking

Technitium supports ad-blocking using the same list formats as Pi-hole does.

To enable ad-blocking navigate to `Settings -> Blocking` and configure these settings **on each instance:**

**Allow / Block List URLs:**

Add the URL of each list on a different line in this field. Alternatively, use **Quick Add** dropdown to add popular blocking lists automatically.

**Save Settings**

#### DNS Forwarding

This is used when **Recursion** is enabled and determines what "upstream" DNS servers Technitium will use to get answers for queries to domains it does not know about or have cached.

Set these in the **Forwarders** field **on each instance.** One IP per line. Or use the **Quick Select** dropdown to populate common servers.

**Save Settings**

### Test DNS and keepalived Failover

At this point it's a good idea to test that:

*  our configured Technitium servers are working for DNS queries
*  keepalived is working to failover if a server becomes unhealthy

#### Testing DNS

I'm assuming that you have been able to reach each Technitium dashboard through a browser and [configure it using `http://HOST_IP:5380`](#configure-technitium). If you cannot reach both or either dashboard you need to revisit your [docker stacks, port publishing, and/or docker networking](#create-technitium-servers) first.

Use one the command line tools below to test queries to your Technitium instances:

<details markdown="1">

<summary>Linux and macOS</summary>

```bash
dig @192.168.PRIMARY.IP example.com
```

Should return results like this:

```
; <<>> DiG 9.20.4 <<>> @192.168.PRIMARY.IP example.com
; (1 server found)
;; global options: +cmd
;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 2826
;; flags: qr rd ra; QUERY: 1, ANSWER: 6, AUTHORITY: 0, ADDITIONAL: 1

;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags:; udp: 1232
;; QUESTION SECTION:
;example.com.			IN	A

;; ANSWER SECTION:
example.com.		155	IN	A	23.192.228.80
example.com.		155	IN	A	23.192.228.84
example.com.		155	IN	A	23.215.0.136
example.com.		155	IN	A	23.215.0.138
example.com.		155	IN	A	96.7.128.175
example.com.		155	IN	A	96.7.128.198

;; Query time: 6 msec
;; SERVER: 192.168.PRIMARY.IP#53(192.168.PRIMARY.IP) (UDP)
;; WHEN: Wed Apr 23 16:57:25 EDT 2025
;; MSG SIZE  rcvd: 136

```

</details>

<details markdown="1">

<summary>Windows</summary>

```
nslookup example 192.168.PRIMARY.IP
```

Should reeturn results like this:

```
Server:  desktop-9bhn4mn.localdomain
Address:  192.168.PRIMARY.IP

Non-authoritative answer:
Name:    example.com
Addresses:  2600:1406:bc00:53::b81e:94ce
          2600:1408:ec00:36::1736:7f24
          2600:1408:ec00:36::1736:7f31
          2600:1406:3a00:21::173e:2e65
          2600:1406:3a00:21::173e:2e66
          2600:1406:bc00:53::b81e:94c8
          23.192.228.80
          23.215.0.138
          23.215.0.136
          96.7.128.198
          23.192.228.84
          96.7.128.175
```

</details>

Use these tools to test queries to both your primary (`192.168.PRIMARY.IP`) and secondary (`192.168.SECONDARY.IP`) Technitium instances.

If either result returns errors or times out then revisit the [settings configuration](#configure-technitium) ane make sure things like **Local End Points** are configured correctly.

#### Testing Keepalived

First, check the logs for your keepalived instances. One should be logging `Sending gratuitous ARP...` occasionally. If neither is doing this review the logs for any errors or warnings.

Next, try to make a DNS query using the [tools mentioned earlier](#testing-dns) but this time using the `VIRTUAL_IP` you set:

```bash
dig @192.168.VIRTUAL.IP example.com
```

If this is working then you're in the clear.

Last, force failover by stopping the Technitium container that is currently being served by the virtual router IE whichever Technitium container is in the same stack as the keepalived container logging `Sending gratuitous ARP...`

When the Technitium container is stopped you should see that the keepalived container on the **other** Technitium stack starts logging `Sending gratuitous ARP...`. Try the DNS query again to make sure the virtual ip is still responding to queries.

If all of this was successful then you have confirmed that keepalived is working as expected for failover and can be used for DNS. If you previously stopped a Technitium container go ahead and restart it now.

### Add Records for Your Domain

On the **Primary** Technitium server navigate to **Zones** and select **Add Zone**:

* **Zone:** `mydomain.com`
* **Type:**: Primary Zone
* Select **Add** to create the new Zone

Navigate to the newly created Zone in the list and select it.

Select **Options** and in the **Zone Transfer** tab make sure **Allow Only Name Servers In Zone** is selected, then Save.

Now, on the Zone details page create **two** records using **Add Record**:

* **Name:** `@`
* **Type:** `NS`
* **Name Server**: Name you used on the secondary Technitium instance for the [**DNS Server Domain** setting](#general)
* **Glue Addresses:** `192.168.SECONDARY.IP`
* **Save**

* **Name:** `@`
* **Type:** `A`
* **IPv4 Address:** `192.168.REVERSE.IP`
* **Save**

The primary Technitium server is now configured to point `mydomain.com` to your reverse-proxy host machine. Additionally, we have added the secondary Technitium instance as a nameserver (NS) to allow zone transfer but we [still need to set that up.](#secondary-zone-and-record-syncing)

#### Add Wildcard Subdomain

Assuming the SSL certificates you created for your reverse-proxy are for a wildcard, use these instructions to point all subdomains *not explicitly defined in records for this zone* to point to your reverse proxy.

On the Primary Technitium Server [Zone details page](#add-records-for-your-domain) create a new record using **Add Record**:

* **Name:** `*`
* **Type:** `A`
* **TTL:** `3600`
* **IPv4 Address:** `192.168.REVERSE.IP`
* **Save**

The primary Technitium server is now configured to point wildcard subdomains (`*.mydomain.com`) to your reverse proxy. 

#### Add Machine IP Alias Subdomains

If you want your DNS to "alias" an IP address for a machine on your network -- IE `machineA.mydomain.com:3000` resolves to `192.168.0.150:3000` -- follow the instructions below for each machine.

On the Primary Technitium Server [Zone details page](#add-records-for-your-domain) create a new record using **Add Record**:

* **Name:** `machineSubdomain`
* **Type:** `A`
* **TTL:** `3600`
* **IPv4 Address:** `192.168.MACHINE.IP`
* **Save**

The primary Technitium server is now configured to point this subdomain (`machineSubdomain.mydomain.com`) to the IP address you configured.

### Secondary Zone and Record Syncing

On the **Secondary** Technitium server navigate to **Zones** and select **Add Zone**:

* **Zone:** `mydomain.com`
* **Type:**: Secondary Zone
* **Primary Name Server Addresses:** `192.168.PRIMARY.IP`
* Select **Add** to create the new Zone

Navigate to the newly created Zone in the list and select it.

If it does not immediately populate records then you can force an update by selecting **Resync.**

If everything was set up correctly you should see copies of the same Records we added to the Primary zone show up here. The secondary server will now stay up to date with any changes made to the `mydomain.com` zone made on the primary server.

### Configuring Network DNS

All that is left to do is configure your router to point to the [`VIRTUAL_IP` we set earlier.](#create-technitium-servers) This is left up to you since configuring this will be specific to your router/network/scenario.

After configuring this change it may take some time before devices start using the new DNS configuration. They need to release/renew their existing IP lease in order to get updated information. This usually happens if the device power cycles or roams away/to (wifi disconnect/reconnect) the network.

After some time you should see the Dashboard in the primary Technitium before to fill out with requests. You did it!

## Additional Notes

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
___

## Footnotes

[^resolver-optional]: Often times the software can serve as both a DNS server and the resolver but it is not required.
[^simplified]: This explanation is greatly simplified and meant to be illustrative, not exhaustive.
