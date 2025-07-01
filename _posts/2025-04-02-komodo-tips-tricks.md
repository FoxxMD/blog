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

### How can I customize systemd Periphery Agents?

The komodo repository describes where [systemd **service units** are placed](https://github.com/moghtech/komodo/tree/main/scripts#periphery-setup-script) when using the [official install script.](https://komo.do/docs/connect-servers#install-the-periphery-agent---systemd)

Properties like the Working Directory and [Komodo Environmental Variables](https://komo.do/docs/connect-servers#configuration), specific to Komodo, can be added to the Service Unit to configure the Periphery Agent without having to add these to your global environment.

To make these modification use a [**drop-in** file](https://unix.stackexchange.com/a/468067) so that your modifications survive any future Periphery install script updates.

Create and edit a drop-in for the service:

```shell
systemctl edit periphery.service
```
(add `--user` if that is how it was installed)

Or manually create it at `/etc/systemd/system/periphery.service.d/override.conf` (path based on install location mentioned in **service units** link above)

Use this file like a regular systemd service definition. Anything here will add to, or override, properties in the existing `periphery.service` unit. EX:

```
[Service]
Environment="PERIPHERY_ROOT_DIRECTORY=/home/myUser/komodo"
Environment="PERIPHERY_DISABLE_TERMINALS=true" 
```

Reload systemd config and restart Periphery after making any changes:

```shell
systemctl daemon-reload
systemctl restart periphery.service
```

### Systemd Periphery stops after closing SSH?

Likely you installed Periphery using `--user`. Depending on your OS, it may exit all processes *started by that user* when that user logs out IE closes SSH connection. Use [`loginctl enable-linger`](https://docs.oracle.com/en/operating-systems/oracle-linux/8/obe-systemd-linger/) to enable processes started by your user to continue running after the sessions has closed:

```shell
sudo loginctl enable-linger yourUsername
```

### How can I automate stack updates?

Komodo has built-in checking for image updates on a Stack. These need to be enabled on each Stack. Find the configuration at

> **Stack** -> **Config** section -> **Auto Update** -> **Poll For Updates**

The interval at which Stacks/Images are polled for updates can be configured using the env `KOMODO_RESOURCE_POLL_INTERVAL` or `resource_poll_interval` variable found in the [Komodo Core configuration](https://komo.do/docs/setup/advanced#mount-a-config-file).

Stacks can be automatically updated using **Auto Update** or **Full Stack Auto Update** toggles also found in the Stack's Config section.

#### Updating Specific Stacks

For simple stack matching based on name, wildcard, or regex (no lookbehind/backtracing) create a [**Procedure**](https://komo.do/docs/procedures#procedures) and use a **Batch Deploy** stage with your desired target.

For more advanced filtering create an **Action** using the snippet below. Fill out the arrays at the top of the snippet with your **exclude** filter values.

<details markdown="1">

<summary>Action Snippet</summary>

```ts
// add values to each filter to NOT re-deploy if stack contains X
const REPOS = []; // Stack X Repo 'MyName/MyRepo' includes ANY part of string Y from list
const SERVER_IDS = []; // Stack X Server '67659da61af880a9d21f25be' matches string Y from list
const TAGS = []; // Stack X Tags A,B,C like '67b8cb3ce8d02869dd500af6' matches string Y from list
const STACKS = []; // Stack 'my-cool-stack' matches ANY part of string Y from list
const SERVICES = []; // Stack X Service 'my-cool-service' includes ANY part of string Y from list
const IMAGES = []; // Stack X Image 'lscr.io/linuxserver/socket-proxy:latest' includes ANY part of string Y from list

const intersect = (a: Array<any>, b: Array<any>) => {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    return Array.from(intersection);
}

const availableUpdates = await komodo.read('ListStacks', {
  query: {
    specific: {
      update_available: true
    }
  }
});

const candidates = availableUpdates.filter(x => {
  if(REPOS.length > 0 && REPOS.some(x => x.info.repo.includes(x))) {
      return false;
  }
  if(SERVER_IDS.length > 0 && SERVER_IDS.includes(x.info.server_id)) {
    return false;
  }
  if(TAGS.length > 0 && intersect(TAGS, x.tags).length > 0) {
    return false;
  }
  if(STACKS.length > 0 && STACKS.some(y => x.name.includes(y))) {
    return false;
  }
  if(SERVICES.length > 0) {
    const s = x.info.services.map(x => x.service);
    if(s.some(x => SERVICES.some(y => x.includes(y)))) {
      return false;
    }
  }
  if(IMAGES.length > 0) {
    const s = x.info.services.map(x => x.image);
    if(s.some(x => IMAGES.includes(y => y.includes(s)))) {
      return false;
    }
  }
  return true;
});

console.log(`Redeploying:
${candidates.map(x => x.name).join('\n')}`);

// comment out the line below to test filtering without actually re-deploying anything
await komodo.execute('BatchDeployStack', {pattern: candidates.map(x => x.id).join(',')});
```

Example: To re-deploy any stacks with image updates available EXCEPT any stack/service that contains the word `periphery`, modify the top arrays to contain:

```ts
const STACKS = ['periphery'];
const SERVICES = ['periphery'];
```

</details>

> Since v1.17.2 Both Actions and Procedures can now be [scheduled to run with CRON](https://github.com/moghtech/komodo/releases/tag/v1.17.2).
{: .prompt-tip}

#### Advanced Update Automation

See Nick Cunningham's post: [**How To: Automate version updates for your self-hosted Docker containers with Gitea, Renovate, and Komodo**](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo)

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

Komodo does not do anything "smart" when cloning the repo for the Stack, even if it knows the Run Directory. It's not possible for it to know if you only use files from that directory for the Stack.

<details markdown="1">

<summary>Why Isn't it Smarter?</summary>

The issue is the feasibility of covering all use cases vs complexity of the "smartness" involved.

The use-case you may have considered is

> Komodo only needs to know about the files inside **Run Directory**

which is fine when everything inside `compose.yaml` refers to published images or volumes/bind mounts with absolute paths. But consider this example:

>`compose.yaml` uses relative bind mounts to folders a few parents up and sideways...
>
>```yaml
>services:
>  myService:
>  # ...
>    volumes:
>     - ../../common-data/secrets:/secrets:ro
>```

Ok...so cloning only **Run Directory** won't cover this. So Komodo should implement code that instead parses all `volumes`, both short-hand syntax above and [long-hand syntax](https://docs.docker.com/reference/compose-file/services/#volumes) to look for relative paths, parse those, and then include those when cloning. It's a bit more complicated but possibly still doable.

But what about this scenario?

> `compose.yaml` uses `build` instead of `image` and dockerfile/context is at a relative path
>
>```yaml
>services:
>  myService:
>    build:
>      context: ../../master-folder/
>      Dockerfile: ../docker/myservice.Dockerfile
>```
>
> AND the `Dockerfile` copies files from another relative directory
>
>```dockerfile
>FROM nginx:alpine
>
>COPY ../common-nginx /var/nginx/html
>```

So, in order for Komodo to cover this use-case it needs to also:

* Check for `build` instead of `image`
  * Parse relative paths in `context`
  * Parse relative paths in `Dockerfile`
* Parse the `Dockerfile`
  * Look for any `COPY` or `ADD` directives, check those for relative paths, and make sure to copy everything from those folders

This is way more complexity. And it's just scratching the surface of what is possible with the compose specification.

Covering all use-cases may be possible but its a lot of work and maintenance. But there is a simpler and completely fool-proof approach to making sure all of these use-cases work: **clone the entire repository.**

This is already "how it works". For any project built from a dockerfile/compose.yaml file that is based on a git repo it must be possible to build it if the repo is cloned, so this is exactly what Komodo does. It may not look smart but its actually the simplest solution to covering all use-cases.

</details>

<details markdown="1">

<summary>Example of Git Repo and Komodo Stack Directory Structure</summary>

Git Repo

```
.
├── stacks/
│   ├── immich/
│   │   └── compose.yaml
│   └── frigate/
│       ├── compose.yaml
│       └── compose-nvidia.yaml
└── resources/
    └── servers.toml
```

Komodo config defines root directory (for Komodo) at `/opt/komodo` and you create a Stack named **immich** that uses the git repo from above with run directory `stacks/immich`...

<details markdown="1">

<summary>Immich Stack TOML example</summary>

```toml
[[stack]]
name = "immich"
[stack.config]
server = "myServer"
git_account = "GitUser"
repo = "GitUser/komodo"
run_directory = "stacks/immich"
environment = """
"""
```
</details>

Directory structure on host running **immich** stack:

```
.
└── opt/
    └── komodo/
        └── stacks/
            └── immich/
                ├── stacks/
                │   ├── immich/
                │   │   └── compose.yaml
                │   └── frigate/
                │       ├── compose.yaml
                │       └── compose.nvidia.yaml
                └── resources/
                    └── servers.toml
```

The directory stucture is `komodo root directory` + `komodo stacks` + `stack name` + `git repo`

```
/opt/komodo      /stacks        /immich      /stacks/immich
komodo root dir  komodo stacks  stack name   git repo + run directory
```

</details>

If you are concerned about cloning/pulling the same repo for each Stack see [Stacks in Monorepo vs. Stack Per Repo](#stacks-monorepo-vs-individual) below.

### How do I view logs in real time? {#realtime-logs}

Komodo doesn't support "true" realtime log viewing yet but "near realtime" logging can be enabled by toggling the **Poll** switch on any Log tab. [Dozzle](https://dozzle.dev/) is a good alternative if you need consolidated, realtime logging for all containers with rich display, search, regex filtering, etc...

### How do I shell/exec/attach to a container? {#shell-container}

Starting with [**v1.17.4**](https://github.com/moghtech/komodo/releases/tag/v1.17.4) Komodo has the ability to open fully-featured, persisted shells on each connected *server* as well as exec'ing into containers. Make sure to read the release notes for what type of *server* terminal is available to you, based on the type of perihery agent installed. The TLDR:

* periphery docker container => shell is inside container and can interact with docker daemon but not host
* periphery systemd (root) => logs in (like SSH) as `root` on host, access to host system and docker daemon
* periphery systemd (user) => logs in (like SSH) as `user` running periphery systemd service, access to host and docker daemon

Expand the sections below for instructions on how to use both:

<details markdown="1">

<summary>Server Shell</summary>

To access the terminal navigate to the **Server** details page from any Stack/Resource/Server and open the **Terminals** tab to create a new Terminal.

From this terminal any container can be exec'd in to by using normal docker commands IE

```shell
docker container exec -it my-container-name /bin/sh
```

> Install this [fuzzy search => exec into container script](#container-exec-shortcut) as an alias for the logged in user to make exec'ing into a container easier IE
>
> ```shell
> $ dex sonarr
> # Found media-sonarr-1
> /app #
> ```
{: .prompt-tip}

This terminal can also be used for general shell access.

</details>

<details markdown="1">

<summary>Container Shell</summary>

Navigate to any **Container** details page from a Stack or `Server -> Docker -> Container` details list. **Note** that the Container details page is NOT the same as the Stack or Service page IE to access a Container from a Stack:

* Navigate to the Stack page (has `/stacks/` in url)
* Switch to the **Services** tab
* Click on any Service in the list (now has `/service/` in url)
* In the Service header click the link with the green cube (![komodo container icon](/assets/img/komodo/komodo-container-icon.png)) icon
  * url should now have `/container/` in url

From the container details click on the **Terminal** tab to open a terminal and automatically exec into the container. The shell used to exec can be changed from the dropdown on the right side.

</details>

### Environmental Variables/Secrets don't work! {#env-and-variables}

This is likely a misunderstanding of how [Compose file interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/#env-file) and [environmental variables in Compose](https://docs.docker.com/compose/how-tos/environment-variables) work. Please read [**this guide**](../compose-envs-explained) for a better understanding of how `.env` `--env-file` `env_file:` and `environment:` work in Docker *as well as* how [Komodo fits into them.](../compose-envs-explained#komodo-and-envs)

### How do I deploy a service that doesn't have a published Docker Image? {#no-published-docker-image}

#### Dockerfile exists and no modification needed {#stack-build-context}

If the service has a project git repository with a `Dockerfile` and you know the project is "ready" and just needs to be built from the Dockerfile ([example](https://github.com/logdyhq/logdy-core)) then this can be done within your `compose.yaml` file! Compose's build `context` supports directories or a [**URL to a git repository**](https://docs.docker.com/reference/compose-file/build/#context) so:

```yaml
services:
  logdy:
    build:
      # can use a specific branch like logdy-core.git#myBranch
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

This is the same as the Same-Machine Stack but requires setting up a local registry that Komodo can push to and your other machines can pull from. Popular, self-hosted git repo software like [Forgejo](https://forgejo.org/docs/latest/user/packages/container/) and [Gitea](https://docs.gitea.com/usage/packages/container) have registries built in and are easy to use but Docker requires registries to be secure-by-default (no HTTP) and covering reverse proxies or modifying the Docker Daemon are out the scope for this FAQ. You may want to check out my post on [LAN-Only DNS](../redundant-lan-dns) and [Traefik](../migrating-to-traefik) for where to get started.

### Is there a Homepage widget? {#homepage-widget}

There is no officially integrated [Homepage](https://gethomepage.dev/) [widget](https://gethomepage.dev/widgets/) yet but [stonkage](https://github.com/stonkage) has created a [Custom API widget](https://gethomepage.dev/widgets/services/customapi/) template to [display Total/Running/Unhealthy/Stopped Stacks:](https://github.com/stonkage/fantastic-broccoli/blob/main/Komodo%2Freadme.md)

First, You'll need an **API Key and Secret** for a Komodo User. (Settings -> Users -> Select User -> Api Keys section)

> I would recommend creating a new "Read Only" Service User. Give it only permissions for Server/Stack Read. Create the API Key and copy the Secret as it will not be shown again.
{: .prompt-tip}

<details markdown="1">

<summary>Custom API Widget Template</summary>

```yaml
 - Komodo:
      icon: sh-komodo.png
      description: Docker
      widget:
        type: customapi
        url:  <YOUR KOMODO URL>/read/
        refreshInterval: 15000
        method: POST
        headers:
          content-type: application/json
          x-api-key: <YOUR KOMODO KEY>
          x-api-secret: <YOUR KOMODO SECRET>
        requestBody:
          type: GetStacksSummary
          params: {}

        display: block
        mappings:
          - field: total
            label: Total Stacks
            format: number
          - field: running
            label: Running
            format: number
          - field: unhealthy
            label: Unhealthy
            format: number
          - field: down
            label: Stopped
            format: number
```

</details>

### How do I use the API?

Komodo has official [Rust and Typescript clients](https://komo.do/docs/api) for programmatic usage anywhere outside of Komodo. Inside Komodo, the Typescript Client can be used in an [**Action** Resource](https://komo.do/docs/procedures#actions) (which can then be composed as part of a larger [**Procedure** Resource](https://komo.do/docs/procedures)). When using the client within these mentioned Resource it does not need to be authenticated. Additionally, Actions and Procedures can be run on a schedule configured within Komodo.

See the [available modules](https://docs.rs/komodo_client/latest/komodo_client/api/index.html#modules) for all possible functions and example arguments that can be used with the client libraries.

#### Raw HTTP

The API can also be called as a normal HTTP request. [The API documentation](https://docs.rs/komodo_client/latest/komodo_client/api/index.html) describes everything required to build a request.

> I recommend using `X-Api-Key` and `X-Api-Secret` for authentication. To get these you will need to create an Api Key for a user, located in Komodo UI under `Settings -> Users -> (User Detail) -> Api Keys`
>
> I also recommend creating a new **Service** user for API usage. Remove or restrict premissions to **Read** based on how you will use the API.
{: .prompt-tip}

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

### Docker Data Agnostic Location

One of the benefits to Komodo is being able to re-deploy a stack to any Server with basically one click. What isn't so easy, though, is moving (or generally locating) any persistent data that needs to be mounted into those services. 

If you use named volumes and have a backup strategy already this is a moot point but if you are like me and use [bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) I found a good approach is to use a host-specific ENV as a directory prefix when writing compose files. 

This has the advantage of making the compose bind mount location agnostic to the host it is on and makes moving data, or rebuilding a host, much easier since compose files don't need to be modifed if the data location changes parent directories.

An example:

```yaml
services:
  my-service:
    image: #...
    volumes:
      - $DOCKER_DATA/my-service-data:/app/data
```
{: file='compose.yaml'}

As long as `DOCKER_DATA` is set as an ENV on each host then the compose file becomes storage location agnostic. It doesn't matter whether you use `/home/MyUser/docker` or `/opt/docker` or whatever.

To do this you'll need to set this ENV in either the shell used by Periphery (`.bashrc` or `.profile`), set in the Periphery's docker container ENVs, or set it in the [systemd configuration](https://www.baeldung.com/linux/systemd-services-environment-variables) for a [systemd periphery agent.](https://github.com/mbecker20/komodo/blob/main/scripts/readme.md#periphery-setup-script)

<details markdown="1">

<summary>Setting ENV for systemd periphery</summary>

**For systemd periphery** check which [`periphery.service` install path](https://github.com/moghtech/komodo/tree/main/scripts) you used and then add a folder `periphery.service.d` with file `override.conf` with the contents:

```
[Service]
Environment="DOCKER_DATA=/home/myUser/docker-data"
```

and then restart the periphery service

EX

```
/home/foxx/.config/systemd/user/periphery.service <--- systemd unit for periphery
/home/foxx/.config/systemd/user/periphery.service.d/override.conf  <--- config to provide `Environment`
```

</details>

<details markdown="1">

<summary>Setting ENV for docker periphery</summary>

**For docker periphery** container make sure you add `DOCKER_DATA` to your environment:

```yaml
services:
  periphery:
    image: ghcr.io/moghtech/komodo-periphery:latest
    # ...
    environment:
      # ...
      DOCKER_DATA: /home/myUser/docker-data
```

and then restart the periphery container.

</details>

### Monitoring Services with Komodo and Uptime Kuma

[Uptime Kuma](https://uptime.kuma.pet/) has the _Docker Container_ monitor type but using Komodo's API has the advantage of being able to monitor a Stack/Service status **independent of what Server it is deployed to and what the container name is.**

#### Prerequisites

You'll need an **API Key and Secret** for a Komodo User. (Settings -> Users -> Select User -> Api Keys section)

I would recommend creating a new "Read Only" Service User. Give it only permissions for Server/Stack Read. Create the API Key and copy the Secret as it will not be shown again.

#### Create Uptime Kuma Monitor

Create a new Monitor with the type `HTTP(s) - Json Query`

##### HTTP Options

* Method: `POST`
* Body Encoding: `JSON`

##### Body

Visit the Stack in Komodo UI and copy the ID after `/stacks/` from the URL. Use it in `stack` value below:

```json
{
    "type": "ListStackServices",
    "params": {
        "stack": "67913976afe9cffd0fa1f963"
    }
}
```

##### Headers

Use the Api Key and Secret created earlier:

```json
{
    "X-Api-Key": "YourKey",
    "X-Api-Secret": "YourSecret"
}
```

##### URL

```
http://YOUR_KOMODO_SERVER/read
```

##### Json Query / Expected Value

To monitor **all** services in the stack and report UP only if **all** are running

* Json Query: `$count($.container[state!='running'].state ) = 0`
* Expected Value: `true`

To monitor a **specific** service in the stack and report UP if it is running

* Json Query: `$[service="SERVICE_NAME_FROM_COMPOSE"].container.state`
* Expected Value: `running`
  
___


[^dm]: Please do not DM me unless we have discussed this prior. I get way too much discord DM spam and will most likely ignore you. @ me on the Komodo server instead.
