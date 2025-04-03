---
title: Komodo FAQ, Tips, and Tricks
description: >-
  Everything you wanted to know but were afraid to ask 🦎
author: FoxxMD
date: 2025-04-02 15:00:00 -0400
categories: [Tips and Tricks]
tags: [docker, compose, komodo, git, homelab]
pin: false
---

A semi-organized list of FAQs, tips, and tricks for using Komodo. This is a follow-up to my [migration guide and Introduction for Komodo](../migrating-to-komodo)

This is living guide that will be updated as Komodo is updated and community knowledge is consolidated. For feedback, contributions, and corrections:

* [PRs are welcome](https://github.com/FoxxMD/blog)
* Use the Giscuss widget at the bottom of the post with your Github account
  * Or directly comment on the [discussion](https://github.com/FoxxMD/blog/discussions) thread for this post
* Available in the [Komodo Discord](https://discord.gg/DRqE8Fvg5c) **only**[^dm] as `FoxxMD`

## FAQ

### Can Komodo Core update itself? {#komodo-core-update}

Yes! If using [systemd Periphery agent](https://komo.do/docs/connect-servers#install-the-periphery-agent---systemd) you can re-deploy a Stack with Komodo Core without issue. If you are using the Docker agent it's recommended to keep the periphery and core services in different stacks so the UI continues to work during deployment, but not necessary.

### Can Periphery Agents updates be automated? {#periphery-automated-update}

Not from within Komodo the same way Core be can updated, unfortunately. However, if you are familiar with [Ansbile](https://docs.ansible.com/ansible/latest/getting_started/introduction.html) there several playbooks available from the community to automate this process:

* from mbecker (Komodo creator) [https://github.com/moghtech/komodo/discussions/220](https://github.com/moghtech/komodo/discussions/220)
* from bpbradley [https://github.com/bpbradley/ansible-role-komodo](https://github.com/bpbradley/ansible-role-komodo)

### How do I send alerts to platforms other than Discord/Slack? {#other-alert-endpoints}

You will need to create an Alerter that uses the **Custom** endpoint with a service that can ingest it and forward it to your service.

I have developed a few Alerter implementations for popular notification platforms:

* [ntfy](https://github.com/FoxxMD/deploy-ntfy-alerter)
* [gotify](https://github.com/FoxxMD/deploy-gotify-alerter)
* [discord](https://github.com/FoxxMD/deploy-discord-alerter) (more customization than built-in discord)
* [apprise](https://github.com/FoxxMD/deploy-apprise-alerter) (can be used to notify to any of the [100+ providers apprise supports](https://github.com/caronc/apprise/wiki#notification-services) including email)

And the Komodo community is creating more implementations too:

* [telegram](https://github.com/mattsmallman/komodo-alert-to-telgram) uses Cloudflare Workers
* *(more to be added)*

Generally, these are standalone **Stacks** you can run on Komodo. After the Stack is deployed, create a new Alerter with a Custom endpoint and point it to the IP:PORT of the service to finish setup.

#### How do I stop Komodo from sending transient notifications? {#debounce-notifications}

You may find Komodo sends notifications for *unresolved* events like `StackStateChange` when it is redeploying a Stack. Or it sends alerts for 100% CPU when it's only a temporary spike. 

For ntfy/gotify/discord/apprise implementations I developed you can use [`UNRESOLVED_TIMEOUT_TYPES` and `UNRESOLVED_TIMEOUT`](https://github.com/FoxxMD/deploy-gotify-alerter/blob/main/README.md?plain=1#L52) to "timeout" temporary events: If the event of `type` is `unresolved` and the alerter sends another event of the same `type` **before** `timeout` milliseconds then it cancels sending the notification.

#### My notification service isn't listed here! How do I get it to work? {#alerter-development}

First, you should check if it's supported by [apprise](https://github.com/caronc/apprise/wiki#notification-services). If it is then use the apprise implementation from above as that is probably the easiest route.

If it is not supported by apprise or you want to build your own then check out my repository where I implemented notification Alerters, [https://github.com/FoxxMD/komodo-utilities](https://github.com/FoxxMD/komodo-utilities). The repo uses VS Code Devcontainers for easy environment setup and each implementation uses the official [Komodo Typescript API client](https://komo.do/docs/api) to make things simple. It should be straightforward to fork my repo, copy-paste one of the existing implementations, and modify [`program.ts`](https://github.com/FoxxMD/komodo-utilities/blob/main/notifiers/gotify/program.ts) to work with your service.

### Run Directory is defined but the entire repo is downloaded? {#run-directory-repo}

In a **Stack** config the **Run Directory** only determines the working directory for Komodo to run `compose up -d` from. 

Komodo does not do anything "smart" when downloading the repo, even if it knows the Run Directory. It's not possible for it to know if you only use files from that directory for the Stack.

If you are concerned about cloning/pulling the same repo for each Stack see [Stacks in Monorepo vs. Stack Per Repo](#stacks-monorepo-vs-individual) below.

### How do I view logs in real time? {#realtime-logs}

Komodo doesn't support "true" realtime log viewing yet but "near realtime" logging can be enabled by toggling the **Poll** switch on any Log tab. [Dozzle](https://dozzle.dev/) is a good alternative if you need consolidated, realtime logging for all containers with rich display, search, regex filtering, etc...

### How do I shell/exec/attach to a container? {#shell-container}

Komodo does not yet support container exec but it a [popular requested feature.](https://github.com/moghtech/komodo/issues/75) As an alternative Dozzle now supports [shell/attach to container](https://dozzle.dev/guide/shell) or I have created a [bash script for "fuzzy search and attach to container"](#container-exec-shortcut) that can be used as a shortcut.

### Environmental Variables/Secrets don't work! {#env-and-variables}

This is likely a misunderstanding of how [Compose file interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/#env-file) and [environmental variables in Compose](https://docs.docker.com/compose/how-tos/environment-variables) work. Please read [**this guide**](../compose-envs-explained) for a better understanding of how `.env` `--env-file` `env_file:` and `environment:` work in Docker *as well as* how [Komodo fits into them.](../compose-envs-explained#komodo-and-envs)

### How do I deploy a service that doesn't have a published Docker Image? {#no-published-docker-image}

#### Dockerfile exists and no modification needed {#stack-build-context}

If the service has a project git repository with a `Dockerfile` and you know the project is "ready" and just needs to be built from the Dockerfile ([example](https://github.com/logdyhq/logdy-core)) then this can be done within your `compose.yaml` file! Compose's build `context` supports directories or a [**URL to a git repository**](https://docs.docker.com/reference/compose-file/build/#context) so:

```yaml
services:
  logdy:
    build:
      context: https://github.com/logdyhq/logdy-core.git
      # only needed if not in root dir and named Dockerfile
#      dockerfile:  Dockerfile
```
{: file='compose.yaml'}

#### Dockerfile needs modification {#dockerfile-inline}

Docker Compose also allows inlining [`Dockerfile` contents](https://docs.docker.com/reference/compose-file/build/#dockerfile_inline) so if it's a simple setup it can be yolo'd:

```yaml
services:
  myService:
    build:
      context: . # or use a git URL to build with a repository
      dockerfile_inline: |
        FROM baseimage
        RUN some command
```
{: file='compose.yaml'}

#### My setup is more complex... {#stack-build-image}

If you need to keep better track of your changes, want to build the image before the stack is deployed, or want n+1 machines on your network to able to use the same build then you need to **build and publish the image** rather than building it inline in the stack.

##### Standalone Container

If the use-case is building one image that can be deployed to **one, standalone container** than the convenient way to do this is to:

* setup a local [Builder](https://komo.do/docs/build-images/builders) and configure a Build without any Image Registry (not publishing externally)
* Build the image
* Create a [Deployment](https://komo.do/docs/resources#deployment) with the [Komodo build you just made](https://komo.do/docs/deploy-containers/configuration#attaching-a-komodo-build)

##### Same-Machine Stack {#same-machine-stack-image}

If you want to keep everything in a **Stack** then

* follow the same steps above (Builder, configure Build)
* On the Build...
  * Make sure to set **Image Name**
  * Add an **Extra Arg** `--load`

This will push the built image to the **local registry on the machine where the Builder ran.** You can then use the Image Name in a Stack deploy **to that same machine only**.

##### Any-Machine Stack {#any-machine-stack-image}

This is the same as the Same-Machine Stack but requires setting up a local registry that Komodo can push to and your other machines can pull from. Popular, self-hosted git repo software like [Forgejo](https://forgejo.org/docs/latest/user/packages/container/) and [Gitea](https://docs.gitea.com/usage/packages/container) have registries built in and are easy to use but Docker requires registries to be secure-by-default (no HTTP) and covering reverse proxies or modifying the Docker Daemon are out the scope for this FAQ. You may want to check out my post on [LAN-Only DNS + HTTPS + Reverse Proxy with NGINX](../lan-reverse-proxy-https) for where to get started. (Traefik version coming soon!)

## Tips and Tricks

### Stacks in Monorepo vs. Stack Per Repo {#stacks-monorepo-vs-individual}

There are valid reasons to use individual repositories per stack such as organizational preference, webhook usage for deployment, permissions, large/binary files, etc...

But with majority *text-based* repositories concerns regarding data usage and performance (clone for new stack or pull repo on each deployment) are not usually valid.

**The Reciepts 🧾**

My own monorepo for Komodo contains **100+ stacks** (folders) ranging from full *arr/Plex sized stacks to single service test stacks. 

A full clone of this repository is **2MB on disk.** Benchmarking a full clone of this monorepo against a repo containing only a few text files, both from github, on my Raspberry Pi 4:

```
Benchmark 1: git clone https://github.com/FoxxMD/[myrepo] myMonoRepoFolder
  Time (abs ≡):        884.1 ms               [User: 306.9 ms, System: 216.4 ms]
 
Benchmark 1: git clone https://github.com/FoxxMD/compose-env-interpolation-example mySimpleFolder
  Time (abs ≡):        389.9 ms               [User: 150.7 ms, System: 107.4 ms]
```

So, **800ms** for the full monorepo and only ~500ms slower than an almost empty repo. On a low power ARM machine. The subsequent pulls to update the repo on redeployment is in the tens of milliseconds.

If you are critically space constrained the size on disk for each stack may be a valid reason to go with per-stack repos but otherwise even an RP4 with a 512GB sd card is not going to have an issue with this setup.

### Shell-into-Container Shortcut {#container-exec-shortcut}

The bash script below can be used to "fuzzy search" for containers by name and then exec into a shell in that container.

<details markdown="1">

<summary>Example Usage</summary>

```shell
$ dex
Usage: CONTAINER_FUZZY_NAME [SHELL_CMD:-sh]
```

```bash
$ ./dex.sh sonarr
# Found media-sonarr-1
/app #
```
{: file='One container only or exact match'}

```bash
$ ./dex.sh test
Found: test-new-app-1
Found: test-1
More than one container found, be more specific
```
{: file='Multiple, no match'}

```bash
$ ./dex.sh sonarr /bin/ash
# Found container media-sonarr-1
/app #
```
{: file='Shell with custom command'}

</details>

<details markdown="1">

<summary>Bash Script</summary>

```bash
#!/bin/bash

# * Does a fuzzy search for container by name so you only need a partial name
#   * If there is more than one container with partial name it will print all containers
#     * And if one is an exact match then use it otherwise exit
#   * If there is only one container matching it execs
# * Second arg can be shell command to use, defaults to sh
# EX
# ./dex.sh sonarr
# ./dex.sh sonarr bash
#
# Can be set in a function in .bashrc for easy aliasing

if [[ -z "$1" ]]; then
  printf "Usage: CONTAINER_FUZZY_NAME [SHELL_CMD:-sh]\n"
else

  names=$(docker ps --filter name=^/.*$1.*$ --format '{{.Names}}')
  lines=$(echo -n "$names" | grep -c '^')
  name=""

  if [ "$lines" -eq "0" ]; then

    printf "No container found\n"

  elif [ "$lines" -gt "1" ]; then

    while IFS= read -r line
    do
      printf "Found: %s\n" "$line"
      if [ "$line" = "$1" ]; then
        name="$1"
      fi
    done < <(printf '%s\n' "$names")

    if [[ -z "$name" ]]; then
      printf "More than one container found, be more specific\n"
    else
      printf "More than one container found but input matched one perfectly.\n"
    fi

  else
      name="$names"
      printf "Found: %s\n" "$name"
  fi

  if [[ -n "$name" ]]; then
    docker container exec -it $name ${2:-sh}
  fi

fi
```
{: file='dex.sh'}

Save this script and `chmod +x` it on each machine, then add it as an alias to the appropriate user's `.bashrc` to make it a command line shortcut:

```
alias dex="~/dex.sh"
```
{: file='~/.bashrc'}

</details>

___


[^dm]: Please do not DM me unless we have discussed this prior. I get way too much discord DM spam and will most likely ignore you. @ me on the Komodo server instead.