---
title: LAN-Only SSL with Auto-Generated Subdomains
description: >-
  How to configure LAN-only SSL with a reverse proxy (SWAG) and auto-generated subdomains using only docker containers
author: FoxxMD
date: 2024-07-01 14:06:00 -0400
categories: [Tutorial]
tags: [nginx, cloudflare, docker, swag, lan]
pin: false
---

**So, you wanna set up LAN-only SSL and thought it would be easy**

![Captain America](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExMGdhZnlmbXdsc2VvYWM4Z3J1aTZseTd1ZjdzNWM1ZGV1MWNzNW8zZSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/5hbbUWcuvtoJGx5fQ4/giphy-downsized.gif){: width="650" height="325" }

> Dang it's hard to find a tutorial and why does this one require port forwarding? And this one wants me to install nginx locally? And this one doesn't explain the LAN-only part? And this...

Yeah, I know. There's a ton of information but none of it is concise or exhaustive. And who _isn't_ using docker containers these days? Don't worry, I suffered through all of the trial-and-error so you can reap the benefits.


## Summary

At the end of this tutorial you will have:

* A [SWAG](https://docs.linuxserver.io/general/swag/) ([nginx](https://nginx.org/en/) reverse proxy) container with SSL certificates for your domain using [Let's Encrypt](https://letsencrypt.org/) that:
  * does not require port forwarding or any other public-internet exposure to authenticate certs
  * can automatically configure subdomains for containers on one or more docker hosts
* A DNS container that redirects your LAN-only requests to the SWAG container

While I will use my own preferences for the tech stack here the general concepts are applicable as long as your alternative supports the same authentication and DNS approaches.

## Prerequisites

* Have registered and have control over your own domain name at a domain registrar
* [Docker](https://www.docker.com/) and [docker-compose](https://docs.docker.com/compose/) installed
* Can modify the DNS/DHCP configuration for your LAN network (through your router or w/e)

Additionally, given examples assume the user is using Linux/macOS.

## Step 1: Domain and DNS Challenge

This is the most important part and the main key to enabling you to acquire SSL certs without any publicly-accessible services.

When you request an SSL certification for a domain the cert provider requires that you validate that you are the actual owner of that domain through a [**challenge**](https://letsencrypt.org/docs/challenge-types/). 

> The most common way to do this is through an HTTP challenge where the cert provider must be able to access your web server (and the cert client) publicly. For this you need to forward ports into your private network and your web server needs to be able to receive public-internet traffic. This is, obviously, what we are trying to avoid. Even if you do this once and then disable port forwarding the certs need to be renewed from time to time which makes this non-feasible for unattended maintenance.
{: .prompt-info }

Rather than the common HTTP challenge we want to use a **DNS challenge**. Instead of requiring access to your web server in order to validate a response from the cert client the DNS challenge works by:

* Cert client (in SWAG container) accesses your domain's DNS service through the DNS provider's API
  * Adds an additional, informational DNS record with unique `Token A`
  * Contacts the cert provider and tells it that it should see `Token A` in that DNS record for your domain
  * Cert provider checks your domain's DNS records for this token
* If the token is found then it proves you have access to the domain and the provider issues the cert

Using this challenge, then, does not require that your web server (or reverse proxy) is publicly accessible in order for the cert client to validate the domain and generate certs. Hooray!

#### Choosing A DNS Provider

With that in mind its (obviously) important to choose a DNS provider that supports DNS challenge through their API. Thankfully, there are many options out there and our reverse proxy, [SWAG](swag) , supports 50+ providers with [easy configuration.](https://github.com/linuxserver/docker-swag/tree/master/root/defaults/dns-conf)

It's also important that the DNS provider we choose supports **wildcard subdomains.** Without wildcard support we will need to list out every subdomain we want to validate for, before the certs are created, which defeats the point of being able auto-generate subdomains later.

For this tutorial I will be using Cloudflare (which does support wildcards) but, as mentioned at the top, **this can be applied to any DNS provider that supports DNS challenge and wildcards!**

> If your domain registrar does not support DNS challenge validation you can resolve this by signing up at a provider that does (like Cloudflare) and then [change the DNS **name server** records](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/) for your domain to the new DNS provider.
{: .prompt-info }

### Configuring Cloudflare API

![Cloudflare API token](assets/img/cloudflare_zones_api.png){: .w-50 .right }

* Navigate to [https://dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
* Select **Create Token**
* Select **Use template** for `Edit zone DNS`
  * Under Zone Resources:
    * Set `Include`
    * To allow the token to edit all DNS for all sites in your account use
      * `All Zones`
    * To restrict token to a specific site
      * `Specific zone`
      * Choose the site from the next dropdown list
    * Under TTL, select Start/End dates, or leave untouched for no expiration of these permissions.
  * Create Summary -> Create Token

After the token is created save it for the next step...

> TODO check that additional DNS records are not required
{: .prompt-warning }

## Step 2: Setup and Configure Reverse Proxy

Now we will create our reverse proxy for serving sites from within our LAN and configure it to create certs using a DNS challenge from Let's Encrypt.

The instructions below are largely reproduced from [SWAG documentation](https://docs.linuxserver.io/general/swag/#create-container-via-http-validation).

Create a docker-compose configuration for swag

```yaml
services:
  swag:
    image: lscr.io/linuxserver/swag
    container_name: swag
    environment:
      # on linux run 'id $user' to get uid => PUID and guid => PGID
      # https://docs.linuxserver.io/general/understanding-puid-and-pgid/
      - PUID=1000
      - PGID=1000
      - TZ=America/New_York
      - URL=MY_DOMAIN.com
      - SUBDOMAINS=wildcard
      - VALIDATION=dns
      - DNSPLUGIN=cloudflare
    volumes:
      - /home/host/path/to/swag:/config
    ports:
      - 443:443
      - 80:80
    restart: unless-stopped
```
{: file='~/stacks/swag/docker-compose.yml'}

Make sure to replace `/home/host/path/to/swag` with a real path on your host machine.

Run the container for the first time to generate all the configuration defaults:

```shell
# from ~/stacks/swag dir
docker-compose up
```

The container **will fail** due to missing configuration but that is ok! Now we have configuration created in `/home/host/path/to/swag`{: .filepath}.

Now edit the cloudflare dns challenge configuration for swag:

* Comment out `global api key` entries
* Uncomment `with token` entries and replace token with the one we [generated earlier](#configuring-cloudflare-api)

```ini
# Instructions: https://github.com/certbot/certbot/blob/master/certbot-dns-cloudflare/certbot_dns_cloudflare/__init__.py#L20
# Replace with your values

# With global api key:
#dns_cloudflare_email = cloudflare@example.com
#dns_cloudflare_api_key = 0123456789abcdef0123456789abcdef01234567

# With token (comment out both lines above and uncomment below):
dns_cloudflare_api_token = OUR_API_TOKEN
```
{: file='~/host/path/to/swag/dns-conf/cloudflare.ini'}

Remove/restart the container to get validation to succeed.

```shell
# If container is still running
docker-compose down
docker-compose up -d
```

## We did it, Reddit?
{: data-toc-skip='' .mt-4 }

If no errors appear in the log (`docker-compose logs`) you have successfully validated with a DNS challenge! Your reverse proxy now has valid certs without ever becoming publicly accessible. Congratulations.

At this point the rest of the tutorial is optional. If you are fine with manually editing `/etc/hosts`{: .filepath} files and configuring your subdomains manually in nginx then feel free to close this tab and celebrate victory. Otherwise, keep on reading for how to auto-generate subdomain proxies and setup local DNS.

## Step 3: Setting up LAN-only DNS

### It Ain't Magic

_What gives?? I've got my reverse proxy setup. Certs are validated. With my normal public-facing proxy all I needed was a wildcard CNAME and subdomains just worked!_

![Judge Judy](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExcjY2NTBxaWlqaTN2d2h4a3d1dDNmcnUwMW90eHVhaG5sNXR0YXd0NyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Rhhr8D5mKSX7O/giphy.gif){: width="650" height="325" }

Well we didn't do that! In fact, we didn't setup _any DNS records at all_ other than the TXT domain required for the DNS challenge. Even after setting up subdomain proxies in SWAG (nginx) the machines on your LAN:

1. do not know the reverse proxy exists, there are no public DNS records.
2. do not know it should look for every subdomain at the reverse proxy, again _there are no public DNS records._

Technically yes we could just setup a CNAME wildcard record pointing to the private IP where the reverse proxy is located but we  **do not want to put these records in the public DNS in order to avoid leaking details about our private network.**

So then what do? Well, you've read the section header so I haven't really buried the lead but _*queue scary music*_ yes we have to host our own DNS. Every self-hoster wants to avoid it but if you want LAN-only SSL it's an inevitability. Sorry. Our local machines need to be able to get DNS information from a local source, there's no way around it.

Fortunately, the solution is pretty idiot-proof with the added benefit of network-side adblock (if you so wish) for zero cost: [**Technitium DNS**](https://technitium.com/dns/) is a full-fat authoritative and recursive DNS server with a ton of goodies built in. It works out-of-the-box and we use it like normal DNS so there's no "gotchas" to configuring it. It also happens to be dockerized, of course.

### What about Pi-hole?

Pi-hole is a great solution for a dns-based/network-wide adblock but, IMO, it's a poor "full-fat" DNS server. Its primary purpose is for blocking ads, not authoritative DNS administration so it's missing many of the features Technetium offers for complete control over your network's DNS. Namely, for our use case, it does not support [wildcard in local DNS records](https://technitium.com/dns/) without modifying the underlying dnsmasq instance which is outside the scope of pi-hole configuration.

If you have an existing Pi-hole configuration and _really really_ do not want to switch to Technitium (it can do the same full ad-blocking with upstream DNS like Pi-hole) you can manage your domains **without the benefit of wildcards** by using Pi-hole's Local DNS features. [Here's another article explaining how to use those features.](https://www.techaddressed.com/tutorials/using-pi-hole-local-dns/#dns) The TL;DR for completing this tutorial with Pi-hole is:

* Local DNS -> DNS Record
  * **Domain:** `MY_DOMAIN.com`
  * **IP Address:** `Reverse Proxy Local IP`
* Local DNS -> CNAME Records
  * For each subdomain add a CNAME pointing back to the same domain
  * **Domain:** `subdomain.MY_DOMAIN.com`
  * **Target Domain:** `subdomain.MY_DOMAIN.com`

### Setup and Configure Technitium

#### Create Technitium Container

Make a copy of the official Technitium [`docker-compose.yml`](https://github.com/TechnitiumSoftware/DnsServer/blob/master/docker-compose.yml) on your machine. My recommended changes:

* uncomment `network_mode: "host"`
  * ensures technitium gets all the ports it needs and
  * it has access to all the correct bound network interfaces if you decide to restrict access using this later
* replace the `config` volume with a dir on your host machine so that the instance data is portable
  * useful if you decide to run a [failover instance](https://www.reddit.com/r/technitium/comments/s91oo5/comment/htk9jnt/?share_id=h9k5AnKjVGm3wsXguIMmM&utm_content=2&utm_medium=android_app&utm_name=androidcss&utm_source=share&utm_term=1)

Now create/start the container

```shell
# from ~/stacks/technitium dir
docker-compose up -d
```

You'll be required to setup an admin user/password after connect the first time you connect to the web interface at `http://HOST_IP:5380`

#### Configuring Technitium

There are [numerous configurable features](https://technitium.com/dns/help.html) but we are only interested in minimum settings required for server our reverse proxy.

##### Settings -> General -> DNS Server Local End Points
{: data-toc-skip='' .mt-4 }

These are the interfaces IP addresses Technitium will listen for DNS record requests on. Since your network is private and secure (right??) the easiest way to set this is up is to listen on everything. Once you have confirmed your configuration is fully working interfaces can be removed and the setup tested to ensure its still working as expected.

The middle IP address should be the IP address of the host machine on your LAN.

```
0.0.0.0:53
192.168.0.42:53
[::]:53
```

#### Create DNS Zone

Now we will configure a new DNS record for your LAN-only domain so Technitium knows where to point machine when they ask for DNS records about it.

Navigate to **Zones** tab and select **Add Zone**

* **Zone:** `MY_DOMAIN.com`
* **Primary Zone**
* Select **Add** to create the new Zone

Navigate to the newly created Zone in the list, then select **Add Record**:

* **Name:** `@`
* **Type:** `A`
* **IPv4 Address:** `Reverse Proxy Host Machine IP`
* Then **Save**

select **Add Record** once more:

* **Name:** `*`
* **Type:** `A`
* **TTL:** `3600`
* **IPv4 Address:** `Reverse Proxy Host Machine IP`
* Then **Save**

And we're done! Technitium is now configured to point any requests, for any subdomain, to your reverse proxy.

### Configure Network DNS

Lastly, you will need to configure your LAN's DHCP server to provide the IP address of the host Technitium is running on as a DNS server. This is usually done in your router and is left as an exercise to the reader. 

You can, however, test everything works first by manually setting the DNS server value on your own machine first.

> After making the DHCP change all clients on your network will need to release/renew their leases before the new DNS change takes affect.
{: .prompt-info }

## We did it, Reddit!
{: data-toc-skip='' .mt-4 }

Ok for real this time it's done! The magic is inside the computer! You can now create subdomain proxies manually or using [SWAG's presets](https://docs.linuxserver.io/general/swag/#preset-proxy-confs) to point to any container or service you have running and will be able to access them from any machine on your LAN!

However, if you are not satisfied with copy-pasting proxies for every service you have running and would rather have it automated read on...

## Step 4: Auto Generating Subdomains

[Linuxserver](https://www.linuxserver.io/) docker containers, which SWAG is built on, support add-on [mods](https://docs.linuxserver.io/general/container-customization/#docker-mods) provide additional functionality to their containers with the inclusion of one or two additional ENVs. They are extremely awesome. Particularly for us, the [Auto-proxy mod](https://github.com/linuxserver/docker-mods/tree/swag-auto-proxy) adds scripting to SWAG to generate subdomain proxy files based on [docker labels](https://docs.docker.com/config/labels-custom-metadata/) found on containers running on the same docker host SWAG is on.

I've taken the liberty of enhancing this mod enable generating these proxy files from _multiple_ docker hosts, not just on the same machine as SWAG. My mod (pull request), I've named [auto-proxy-multi](https://github.com/FoxxMD/docker-mods/tree/swag-auto-proxy-multi) provides additional functionality:

* smart guessing for remote host Web port
* per-host TLD
* per-host suffix or prefix container

to allow effective mixing of public/private proxying as well as multiple same-name containers based on the host the container is located at.

Since our tutorial only deals with a single Docker host we will not use most of these settings but the full documentation for these can be found at the github repository: [https://github.com/FoxxMD/docker-mods/tree/swag-auto-proxy-multi](https://github.com/FoxxMD/docker-mods/tree/swag-auto-proxy-multi)

"Recipes" for multi-host scenarios and other use-cases can be found at the end of this tutorial.

### Configuring SWAG Mod

Modify `docker-compose.yml` for SWAG from [Step 2](#step-2-setup-and-configure-reverse-proxy) to include these environmental variable:

```yaml
environment:
  - DOCKER_MODS=linuxserver/mods:universal-docker|foxxmd/auto-proxy-multi
  - AUTO_PROXY_HOST_TLD=MY_DOMAIN.com
```
{: file='~/stacks/swag/docker-compose.yml'}

and restart the container. The mods will download and install without interaction and can be monitored in the logs.

### Configuring Containers

Refer to [auto-proxy labels](https://github.com/FoxxMD/docker-mods/tree/swag-auto-proxy-multi?tab=readme-ov-file#labels) for more information on configuring individual containers. To enable a container to have a subdomain proxy auto generated for it add the label `swag=enable` to the container and restart it. After ~60s SWAG will pick up the change and the container will then be available at `container_name.MY_DOMAIN.com`.

![Judge Judy](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExdGdtdG9taGswZnlmMXhtbm5uMHdhZHlkOGVkamtzcTFsdHBidnRkdyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mvqyWf1zhuyB2/giphy.gif){:height="300" }
_I'm David Blaine and the Cheez-its are your containers, it's *magic*_

There you have it. LAN-only SSL with no private network details leaked and auto generated subdomain proxies, all using portable docker containers. Enjoy bragging to all your publicly-exposed loser-friends using cloudflare tunnels!

## Recipes

The following are _very_ succinct approaches and tips for doing more with your newfound setup. I'll expand on these if requested.

### Additional Domain Validation with SWAG

To have SWAG generate certificates for additional domains (IE you host more than one domain from the same reverse proxy) add the following environmental variables to the [SWAG docker-compose.yml](#step-2-setup-and-configure-reverse-proxy)

```yaml
environment:
  - ONLY_SUBDOMAINS: false
  - EXTRA_DOMAINS: "*.MY_EXTRA_TLD.COM,MY_EXTRA_TLD.COM"
```
{: file='~/stacks/swag/docker-compose.yml'}

Add _even more_ domains by separating with a command in `EXTRA_DOMAINS` following the same formula.

> If you use additional (public) domains and have subdomains you want to remain LAN-only it is critical the `server_name` directive in their proxy files **is not `*`**. Explicitly specify the domain like `server_name: subdomain.my_interal_tld.com;` and if use auto-generated proxies ensure [per host TLD](https://github.com/FoxxMD/docker-mods/tree/swag-auto-proxy-multi?tab=readme-ov-file#subdomains-and-tld) is configured.
{: .prompt-warning }