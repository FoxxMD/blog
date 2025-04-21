---
title: Migrating To Komodo
description: >-
  Moving from Dockge to Komodo and how to think like a lizard 🦎
author: FoxxMD
date: 2024-11-19 12:00:00 -0400
categories: [Tutorial]
tags: [docker, compose, dockge, portainer, komodo, git]
pin: false
---

## Submitted for your approval

![Rod Sterling](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExYTBqbm9hano0cm5ndmhhZ2NrcDRjOXQ3eDBkaWU4OWU5MTY3czBrciZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/fsXvkV3xXVtTO/giphy.gif)

Consider this scenario and tell me if I'm personally attacking you:

You are new to self hosting or maybe have been in the game for awhile. Your journey into this niche started with running plain docker containers from command line. Or perhaps you have some compose files lying around. After collecting a few services here and there you realized it would be better to have a GUI for managing these so you did your homework and got Portainer or Dockge running. 

Time passes and you now have a handful or even a sizable collection of compose files and ad-hoc containers running. Perhaps you added a few Raspberry Pi's to your humble lab and now you are connecting Portainer to multiple nodes or SSH'ing in to pull image updates, start containers, edit compose files, etc...

At some point you start to get the feeling there's a better way to manage all of these services. 

Maybe you even had a bad experience with a machine crashing or corrupted/formatted drive and lost some of those services and their configurations. Maybe it wasn't a bad experience but you still needed to wipe the machine and copy over all of your manually backed up compose files. Or maybe you're just looking at the 20+ services with 100s of lines of compose config or long-running ad-hoc containers and feeling uneasy because...did you backup everything? What about that change you made last week to that one file? What if you upgrade hardware and have to do all of this setup all over again, won't that take forever? Or why is it so much manual work to move one compose stack from one machine to another. Is it really always as laborious as needing to copy all these files and run all the commands again?

Ok...so you start doing your homework again but it's not as clear cut this time. There's Kubernetes but man this looks so enterprise-y. Rancher? You need to setup storage devices, balancers, networking? All you want is a better way to manage all your machines and backup your stacks/configuration. This seems way too much work for that!

So maybe you start a git repo, clone it on each machine, and start manually committing changes if/when you remember to do so. 

Or maybe you don't do anything at all. It's a hobby after all and it's working as-is. The jump from plain-ol files with Dockge to enterprise-level setup seems overwhelming and like too much effort.

And so you're back where you started. Even with the git stuff you're still doing a bunch of manual work to keep track of changes and adminster your lab. 

Why isn't there anything in middle? A compromise between plain-ol compose files/ad-hoc containers and crazy enterprise setups?

Well there is. It's called **Komodo**.

## What Is Komodo?

[Komodo](https://komo.do/docs/intro) is a self-hosted **resource** management application and web-based GUI. 

Resources, in this context, cover many aspects of your homelab:

* Containers
* Stacks (compose files and services therein)
* Servers (all of your machines running docker)
* Repositories (where your configurations live)
* [...and so much more](https://komo.do/docs/resources)

It provides the same kind of functionality you are use to with Portainer and Dockge. [From the docs:](https://komo.do/docs/intro)

> With Komodo you can:
>
>   * Connect all of your servers, and alert on CPU usage, memory usage, and disk usage.
>   * Create, start, stop, and restart Docker containers on the connected servers, and view their status and logs.
>   * Deploy docker compose stacks. The file can be defined in UI, or in a git repo, with auto deploy on git push.
>   * Build application source into auto-versioned Docker images, auto built on webhook. Deploy single-use AWS instances for infinite capacity.
>   * Manage repositories on connected servers, which can perform automation via scripting / webhooks.
>   * Manage all your configuration / environment variables, with shared global variable and secret interpolation.
>   * Keep a record of all the actions that are performed and by whom.
>
> There is no limit to the number of servers you can connect, and there will never be. There is no limit to what API you can use for automation, and there never will be. No "business edition" here.

### Resources

The "killer feature" of Komodo, though, is that all of the above can be described [as its own **Resource** that Komodo uses to define how it behaves](https://komo.do/docs/sync-resources), the proverbial **Infrastructure As Code**. If you're familiar with the [Terraform](https://www.terraform.io/) or [AWS CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html) then this should be familiar territory for you, but for the rest of us consider this simple example:

Your compose files describe how a stack should be created with individual containers, networking, envs...but how do you describe which compose files run on which servers? How do you describe which servers should be used and how to connect to them? 

With Komodo a [Server](https://komo.do/docs/resources#server) (machine that runs docker) is a resource:

```toml
[[server]]
name = "server-prod"
description = "the prod server"
tags = ["prod"]
[server.config]
address = "http://localhost:8120
region = "AshburnDc1"
enabled = true
```

And so is each [Stack](https://komo.do/docs/sync-resources#stack) that should run on that Server:

```toml
[[stack]]
name = "media-arrs"
description = "Sonarr, Radarr, and the other *arrs"
deploy = true
[stack.config]
server_id = "server-prod" # server from resource above
file_paths = ["mongo.yaml", "compose.yaml"]
git_provider = "git.mogh.tech"
git_account = "mbecker20"
repo = "mbecker20/media-arrs"
```

Both of the above configurations:

* can be generated after configuring everything in the web GUI OR
* can be used by Komodo to create the resource (server, stacks) if they don't already exist!

### This is it, Chief

Sounds cool! Right? But here's the _real_ kicker. Komodo deeply integrates with git. 

Those compose stacks? Can be pulled from a public/private repository. Komodo can pull new changes and auto deploy anything that has changed. It can also _directly write to the repo_ for the files that change (think dockge compose editor but commit to repo instead of a regular file.) 

And the "infra as code" resources? Yep. That too can be synced to a git repo. It's bi-directional -- pull _from_ the repo to invoke changes to Komodo or commit _to_ the repo when you make changes in Komodo.

Suddenly, all of your stacks can be seamlessly backed up **as well as** the exact topology of all your docker deployments (on which servers). This, alongside the convenience of a central management interface and easy editing of compose files, env interpolation, secret management, etc...

This is, Chief. This is the middle ground you've been looking for.

![zoolander](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExOXN5cWw0MmdtZXFucDh5N3Z5cGF1bXQ0aXIwNmlqNjl5MnV3YzQ1NiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/V2AkNZZi9ygbm/giphy.gif)

### So What's the Catch?

So here's the rub. To fully take advantage of Komodo and all the shinyness described above you're going to have to face two gauntlets.

#### Declarative Infrastructure

To think like a lizard 🦎 you're going to have to change the way you think about creating and managing docker containers/stacks. This is going to be most difficult if you aren't heavily using compose stacks already.

Komodo wants you to _declaratively_ define what is it you want to run, rather than _imperatively_ creating it for you the way Portainer->Containers does.

This is not limited to standalone containers, either. If you have existing stacks running on a machine Komodo will not automatically surface them in the UI the way dockge does when pointed to a folder full of compose files. While Komodo can manage existing stacks/compose files you will still need to "create" the stack in Komodo and tell it where the files are before it can take over management.[^import]

This requirement of explicitly specify all your infrastructure applies to all other Resources in Komodo. At the moment this is a fact of life.

However this should not deter you! Getting all of your lab into a well-defined configuration is something you've been striving for, remember? Do a little bit at a time so it isn't overwhelming. Komodo can co-exist with whatever you've been using up till now, there's no all-or-nothing rush to switch over.

#### Unopinionated Resource Storage

The second hurdle is that there is no Best Way™️ to store and backup all of your Resources. Komodo offers three ways to get/set resources:

* UI Defined -- Komodo will write to a subfolder in its own (controlled) directories
* Files on Server -- existing files/folders on a host, outside of Komodo's own directories, you point to
* Git Repo -- pull from a repo and optionally write to it if you have access

You can choose which method to use for each Stack _as well as_ every Resource individually in Komodo.

The problem is that these are all valid ways to use Komodo and you have to make the decision of choosing what approach you want to do before you start creating any Resources. You should think long and hard about what you want to do because going back to modify everything later might end up being a big hassle, [though possible to do in bulk.](#converting-resource-storage-type)

In the guide below I will be using Git Repo for _everything_ but feel free to do it however you want.

![levar burton](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExcGU2b3B4Zmd4eXA1ODhleXlrOG54cmxkcDFybXM4M2N0NWdiOHFvMCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/fWfCYufxVgthCxLIHv/giphy.gif){: width="300" }

## Migration Context

This guide will detail the opinionated approach I took to migrate wholly to Komodo. It won't suit everyone's needs and could definitely be done better. It can be used as a step-by-step but ideally it's a reference for how could approach migrating that you should modify to work for your own setup.

#### Lab Topology prior to migrating

* 5 servers
  * Unraid with a mix of containers and compose projects
  * 2x servers using Portainer only for standalone containers
  * 1 server using a mix of compose files with Dockge and Portainer for a few standalone containers
* 60+ containers across 20+ stacks
* 1 private github repo with ~10 stacks committed

#### Migration Goals

* Convert all standalone containers to compose stacks
* Commit all stacks to git repo for backup
  * Configure in a way that allowed me to edit on Komodo and commit to repo on save
  * Move all docker/compose secrets out of `.env` files so they aren't committed
* Commit all Komodo resources to git repo for backup
* Configure Komodo and stacks in way that files are user-accessible from the host
  * I prefer to use [bind mounts](https://docs.docker.com/engine/storage/bind-mounts/) over docker volumes so that in the event I need to debug or edit things manually the files aren't hidden away. It also makes backing up persistent data easier IMO.

## Migrating

### Choosing A Storage Strategy

I knew I wanted to get all of my stacks and containers backed up somewhere other than my machine. Komodo's full power is taking advantage of a **Git Repo**-based resources so that they can be committed when you save anything in the UI so I knew this is what I wanted. It makes backup coupled to changes so it's basically set-and-forget at the cost of having a potentially noisy git log if you make lots of little changes or tinker with a stack. This was a comprise I thought was worth the peace of mind.

I use [unraid](https://unraid.net/) and considered standing up Gitea with docker but since we're talking about basic text, github offers free private repos, and I wasn't going to be storing sensitive info there anyways I opted for github so that the backup was truly offsite.

All of my Resources and Stacks would then be Git Repo based.

##### Git Repo

I went with a monorepo for all my resources. I like this over individual repos per resource so that I can more easily see a "combined" git log of all the changes I've made over my entire lab. The cost for this choice is that every new Resource requires having `Run Directory` defined rather than just `Repo`.[^template]

The structure of my repo looks like:

```
stacks/
├── server1/
│   ├── immich/
│   │   └── compose.yaml
│   └── frigate/
│       ├── compose.yaml
│       └── tensor.compose.yaml
├── server2/
├── server3/
├── server4/
├── server5/
└── common/
    └── glances/
        └── compose.yaml
komodo/
└── resources/
    └── main.toml
```

Every machine gets its own folder in `stacks` and stacks that aren't machine specific (volumes) can be places in `common`. Komodo gets its own folder for resource TOML files.

### Setup Komodo

#### Create Komodo Core

I chose to setup Komodo [Core](https://komo.do/docs/setup/mongo) using MongoDB. This stack runs on my most stable machine since it will be the brains of the operation.

#### Create Komodo Periphery Agents

~~I created [Periphery agents on all other servers as containers](https://komo.do/docs/connect-servers#install-the-periphery-agent---container). The agent can be installed natively using systemd but I like keeping everything contained to docker so there is less to think about.~~

UPDATE: After using Komodo for 3+ months I have changed to using [systemd agents](https://komo.do/docs/connect-servers#install-the-periphery-agent---systemd). I have zero security concerns about using Periphery with user-level access to the Docker daemon and using the non-docker agent makes Docker interactions simpler, IMO.

After each agent is created it's a simple process to add as a [Server](https://komo.do/docs/resources#server) resource in the komodo core interface.

<details markdown="1">

<summary>A Note on Security and Non-Root Periphery</summary>

I prefer to use containers with a non-root user and generally don't like giving unfettered access to `docker.sock`. _This is entirely optional_ but you can chose to run Periphery as non-root and provide access to docker via [docker-socket-proxy](https://github.com/linuxserver/docker-socket-proxy).

Periphery image can _mostly_ be run normally just by specifying `user` in the compose file but I found this wasn't entirely sufficient. When Komodo uses git it needs to set the email/name for the git user which is normally set (I think) under `root` but when run as non-root this is no longer the case. The solution to this is [supplying a `home` directory inside the container](https://github.com/mbecker20/komodo/issues/128#issuecomment-2423471703) which can be done by building your own periphery image inline.

In summary, here is an example compose file for a non-root Periphery container using docker-socket-proxy that would be run on one of your servers:

<details markdown="1">

```yaml
services:
# ... other services like komodo core, maybe
socket-proxy:
    image: lscr.io/linuxserver/socket-proxy:latest
    environment:
      - ALLOW_START=1
      - ALLOW_STOP=1
      - ALLOW_RESTARTS=1
      - AUTH=1 #optional, enable for pushing builds to registry and increasing pull rate limits
      - BUILD=1 #required to build images
      - COMMIT=0 #optional
      - CONFIGS=0
      - CONTAINERS=1 #required to manage containers
      - DISABLE_IPV6=0
      - DISTRIBUTION=1 #required for image digest and registry info
      - EVENTS=1 #required for core communication
      - EXEC=1 #required for 'exec' into container, future use
      - IMAGES=1 #required to manage images
      - INFO=1
      - NETWORKS=1 #required to manage networks
      - NODES=0
      - PING=1 #required for core communication
      - POST=1 #required for WRITE operations to all other permissions
      - PLUGINS=0 #optional
      - SECRETS=0
      - SERVICES=0
      - SESSION=1
      - SWARM=0
      - SYSTEM=1 #optional, enable for system stats in dashboard
      - TASKS=0
      - VERSION=1 #required for core communication
      - VOLUMES=1 #required to manage volumes
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /run

  komodo-periphery:
    restart: unless-stopped
    #image: ghcr.io/mbecker20/periphery:latest # use ghcr.io/mbecker20/periphery:latest-aarch64 for arm support
    build:
      context: .
      dockerfile_inline: |
        FROM ghcr.io/mbecker20/periphery:latest
        USER 1000:1000
        WORKDIR /home/myUser
        ENV HOME=/home/myUser
    ports:
      # only necessary if not in same stack as komodo-core
      - 8120:8120
    volumes:
      # setup your stacks and repos volumes here
    depends_on:
      - socket-proxy
    environment:
      # THE KEY to making periphery access docker without docker.sock
      DOCKER_HOST: tcp://socket-proxy:2375
    labels:
      komodo.skip: # Prevent Komodo from stopping with StopAllContainers
```
{: file='compose.yaml'}

</details>

</details>

#### Setup Git Provider

Before Stacks can be created we need to setup a Provider in Core so that Komodo knows what Git platform to pull/push from and who it is acting on behalf of.

In Komodo, navigate to `Settings -> Providers -> Git Accounts` and then create a **New Account**. You'll need to create a new [access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) on github that has permissions to read/write the [repo you created for komodo.](#git-repo) After creating the token the Git Account in Komodo will have these inputs:

* Domain `github.com`
* Username `your github username`
* Token `token created for repo`

### Creating Stacks

Now that we have Komodo Core and Periphery agents setup on all our servers, and git configured, we can start creating [Stack](https://komo.do/docs/resources#stack) Resources. These are the bread & butter of Komodo and what you are probably here for. A Stack is docker `compose.yaml` file(s) and the associated configuration needed to deploy them:

* what server to deploy to
* where to find stack files (git repo and relative directory to files)
* ENV variables that should be passed to compose

To create a new Stack navigate to `Stacks` in Komodo Core and click **New Stack**. Give the stack a name and create it.

> If you have existing compose projects running on the server that you will deploy to, then use the name of the folder (if any) the compose files are located in. Komodo will parse that the stack is already running so you don't need to redeploy.
{: .prompt-tip }

We now need to configure the new Stack so it points to our Git repo so it can find (or create) compose files for our project. In the newely created Stack under `Config`:

* Source
  * Git Provider: `github.com`
  * Account: username from dropdown you created in the [Git Provider](#setup-git-provider) step
  * Repo: For github this is `username/repo-name` like you'd see in the URL when viewing your repo on github.com
  * Run Directory: This will be dependent on how you structured your [Git Repo](#git-repo) from earlier
    * EX: `server1/immich`

After configuring these settings **Save** your Stack. 

Now, in the **Info** tab:

* If the Run Directory and compose files already exist you will now see them in the `Info` tab
* If they did not exist you will see a placeholder editor and `Initialize File`. Click + Confirm this now to create and commit a blank compose file to the repo

Additionally, if the stack was already running and you followed the tip above you should also see the Stack status as `Running`.

#### Populating Stack from Existing Projects

##### Docker Compose

If you have existing projects that use `compose.yaml`/docker compose you have several options for setting up your stack, most of which were [briefly mentioned above.](#so-whats-the-catch) How you decide to get them into the Stack is really up to you:

* Outside of komodo [structure your git repo](#git-repo) and commit your existing projects before creating Stacks. Then, when the Stack is created with the correct Run Directory it'll auto-populate everything for you
* Create the Stack and then manually copy-paste your existing `compose.yaml` contents into Stack `Info` and **Save** to commit to the repo using Komodo

Before starting and re-deploying the newely created Stack read the [environmental variable section below.](#environmental-variables-and-secrets)

##### Converting Standalone Containers

If you have containers that were created with `docker run...` or something like Portainer you will now need to convert them to compose projects. To turn each of these into a stack I used [docker-autocompose](https://github.com/Red5d/docker-autocompose) as a docker container to generate a compose file to output. Run this on the machine the container you want to convert is running on:

```shell
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/red5d/docker-autocompose container_name
```

This can then be copy-pasted into a new stack in Komodo with the corresponding `Run Directory` for the service.

Alternatively, use one of these [shell scripts](https://github.com/Red5d/docker-autocompose/issues/50) to generate files for each running container. Then move each file into the correct folder in your repo folder and commit. Then create new stacks for each in Komodo pointing to the correct `Run Directory`.

docker-autocompose tends to create verbose files, however. Labels, default environment variables (exposed from Dockerfile), and dropped security permissions can all be pruned from the files -- but it is a good starting point.

Before stopping/destroying your old containers and starting the new Stack read the [environmental variable section below.](#environmental-variables-and-secrets)

#### Environmental Variables and Secrets

The **Environment** section in your Stack's `Config` tab will pass ENVs to the _compose_ command used to create the stack. Note that this is different than ENVs passed to each service: the Stack `Environment` variables are [only for use in `compose.yaml`](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/) unless you explicitly set them in each service's `environment:` section or use [`env_file: .env`](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/#use-the-env_file-attribute).

<details markdown="1">

<summary>Example of this difference</summary>

```yaml
services:
  my-service:
    image: acoolname/myimage:${VERSION}
    # ...
    environment:
      MyCoolEnv: Foo
```
{: file='compose.yaml'}

```
VERSION=1.2.3-rc
```
{: file='Stack Environment'}

* `my-service` will pull the image `acoolname/myimage:1.2.3-rc` 
* it will have `MyCoolEnv=Foo` available in the container
* it will NOT have `VERSION=1.2.3-rc` available in the container

Alternatively:

```yaml
services:
  my-service:
    image: acoolname/myimage:${VERSION}
    # ...
    environment:
      MyCoolEnv: Foo
      MyOtherEnv: ${VARFUN}
```
{: file='compose.yaml'}

```
VERSION=1.2.3-rc
VARFUN=Bar
```
{: file='Stack Environment'}

* `my-service` will pull the image `acoolname/myimage:1.2.3-rc` 
* it will have `MyCoolEnv=Foo` available in the container
* it will have `MyOtherEnv=Bar` available in the container

</details>

> A more thorough explanation of how Docker Compose handles variables and ENVs, along with runnable example compose files, [can be found here.](../compose-envs-explained) If you do not have a good grasp of `.env` `--env-file` `environment:` and `env_file:` usage/hierarchy in Docker Compose I would **highly recommend** reading it as it will save you a headache later.
{: .prompt-tip }

Komodo stores the contents of `Environment` in a `.env` located next to the created compose files for the Stack. Additionally, if you use [Resource Sync](#resource-sync) it will store the contents alongside the rest of the Stack configuration so it is best to **not** put sensitive data in Environment and instead use [Secrets interpolation to pass that data through ENV.](https://komo.do/docs/variables)

##### Using Secrets

In Komodo Core navigate to `Settings -> Variables` and hit **New Variable**, then give it a name. In the new Variable set the value and toggle as a secret to hide it's value in logs.

Then, in your Stack's `Environment` interpolate the secret as an ENV by wrapped the secret name in double brackets `[[]]`:

* Secret Name: `IMMICH_DB_PASS`
* Secret Value: `MyCoolPass`

```
VERSION=1.2.3-rc
DB_PASSWORD=[[IMMICH_DB_PASS]]
```
{: file='Stack Environment'}

Now your secret will be interpolated into the ENV value when the stack is deployed.

#### Cutover New Stack

Now that the Stack [configured for your repo](#creating-stacks), is [populated](#populating-stack-from-existing-projects) with a compose file, and has [ENV/Secrets set](#environmental-variables-and-secrets) it's time to fully move management of the project to Komodo.

If you had an existing stack with the same project name you might already be done (based on Stack status), otherwise the process is simple:

* stop your old compose project/container
* Deploy Komodo Stack

If you have container names explicitly specified you may need to complete destroy (`compose down` or `docker container rm`) the old project before the new one can be deployed.

And now you're done! Up until cutover your old project can continue to be used without any conflict with Komodo. This makes migration easy to do in a piecemeal fashion -- just migrate one project at time when you have the energy to do so.

Now...to take full advantage of Komodo we want to commit the _topology_ of our deployments to git so that our entire stack ecosystem can be recreated from scratch even if Komodo Core is destroyed. Enter [Resource Sync](#resource-sync)

### Resource Sync

This is the true "killer feature" [mentioned in the intro.](#this-is-it-chief) With [Resource Sync](https://komo.do/docs/sync-resources) Komodo will generate a plain text representation of all our Stacks and Servers which can be then be synced to a git repo (or pulled to make Komodo create/modify Resources).

#### Limiting Scope

Komodo makes use of Tags across all Resource which makes it easy to filter when searching in the UI _but also_ as a way to limit when or on what actions things are taken. I only want Stacks and Server resources to be synced (omitting Secrets) so lets create a Tag and tag all our Stacks/Servers with it:

* In Komodo Core navigate to `Settings -> Tags` and create a **New Tag**
* Iterate through each Stack and Server in Komodo Core and click the `+` sign next to Tags on the details of each (usually right below Name at the top of the page), then add your Tag

#### Create Resource Sync

In Komodo Core navigate to `Syncs` and create **New Resource Sync**. 

In the new sync under `Config` Choose Mode: `Git Repo` and fill out the **Source** information the same way you did for a [Stack](#creating-stacks).

Now, under **Resource Paths** add a new Path to a file you want to store the sync information in. For instance, to create a new file at the root of the repository use `main.toml`. If you used [Tags for limiting scope](#limiting-scope) specify this in the **Match Tags** section.

Next, ensure that these config toggled are **Enabled**:

* General -> **Managed**
* General -> **Delete Unmanaged Resources** (Optional)
* Include -> **Sync Resources**

Now **Save** and then **Initialize** the file.

You should now see that the Sync status is **Pending**. If not, click **Refresh.** Pending means that there is a difference between the current configuration of all (tagged) Resources in Komodo Core and the configuration found in the repository (under `main.toml`). The difference, at this point, is that there is nothing in `main.toml`. You can see this in the `Info` tab.

Switch to the new **Pending** tab (next to Info). There are two more tabs available here, **Execute** and **Commit**. Switching between the two will show you the two modes that the Resource sync can be used in.

* **Execute** will **pull configuration from** your resource file (in the repo `main.toml`) and cause Komodo to modify/create/delete all matching resources to match what is in the file.
  * This is what you would use if you had an existing Resource Sync file and were rebuilding your lab
* **Commit** will **commit current Komodo configuration to** your resource file in the repo (`main.toml`) so that it reflects the current state of Komodo and all (tagged) Resources.
  * This is what you want if you want to **backup** your lab's configuration to repo

Switch to the **Commit** tab and then click **Commit Changes** to backup your configuration. After execution you'll see your current configuration reflected in the `Info` tab.

You should do this after making any resource changes (Adding Stacks, updating Environment, etc..) to make sure your backed up configuration stays up to date. Now you'll have the ability to re-deploy your entire lab with one click!

## Conclusion

Congratulatious on migrating to the way of the lizard 🦎! It takes effort to get to this point, though not _difficult_ just time consuing, but it's well worth the energy! You can sleep peacefully at night knowing all of your cool services are backed up as well as how and where you deployed them. Next time you have a catastrophic hardware failure and a drive dies you can easily get back to normal operation by just installing a periphery agent and executing a Resource Sync. So easy!

This guide covers a basic setup but Komodo is so much more than just Stacks. Builders, Deployments, Actions, Alerters...they all make lab automation easier and all can be synced/backed up just like Stacks. Take the time to explore the rest of the Komodo ecosystem and learn how to fully utilize it. If you have questions or need more guidance check out [Github Issues](https://github.com/mbecker20/komodo/issues?q=sort%3Aupdated-desc+is%3Aissue+is%3Aopen) or join the (very active) [Discord server](https://discord.gg/DRqE8Fvg5c).

## Additional Tips and Notes

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

### Converting Resource Storage Type

While not a first-class feature, it is possible to convert Resources between UI Defined, Files on Server, and Git Repo based storage without having to manually recreate them in the UI. There should be better support for this in [version 1.17](https://discord.com/channels/1272479750065094760/1272479750065094763/1340120174224740425) but it's still not "official" by any metric.

First, make sure the Resources you want to convert are backed by a [Resource Sync](https://komo.do/docs/sync-resources#resource-sync). You should be able to see your Resource in the created TOML of the Sync like so (example of a files-on-server Resource):

```toml
[[stack]]
name = "test"
[stack.config]
server = "myServer"
files_on_host = true
run_directory = "path/to/stack"
# ... maybe more stuff here

[[stack]]
name = "test2"
# ...
```
{: file='sync.toml'}

Next, make (or find an example of) a Resource of the type you want to convert to. The example below is a Git Repo resource:

```toml
[[stack]]
name = "test"
[stack.config]
server = "myServer"
run_directory = "path/to/stack"
git_account = "MyUser"
repo = "MyUser/my-repo"
```

You can see that the diference between the files-on-server and git-repo resource are only two lines, `repo` and `git_account`. Assuming the `run_directory` is the same (it likely wouldn't be) then all you'd need to do is add those two lines to each Stack to convert in your sync toml. It will still require some manual work but with a decent text editor you could use bulk find-and-replace, regex, or multi-cursor to cut down the repetitive actions.

After making your edits, save the sync toml. Then, refresh the Sync Resource in Komodo. You should see a large list of changes appear. Do **Execute Changes** to have Komodo re-deploy all your stacks with the updated storage type.

### Alternatives for Komodo's Missing Features

Komodo is in active development and while the goal is to have good feature parity with Portainer/Dockge it is still missing some conveniences. Komodo's author is _hard_ at work implementing missing features and the speed of development is quite frankly insane but in the meantime try these out to make up for missing features:

#### Real-time Logging

Use [Dozzle](https://dozzle.dev/) to monitor logging for containers and stacks. It supports merging all stack containers together as well as monitoring containers from multiple machines.

#### Notifications

Komodo uses [Alerter](https://komo.do/docs/resources#alerter) resources to handle notifications for all types of things: Host metrics (cpu, mememory, storage levels), image updates, deploy failures, etc...

It has built-in support for Slack and Discord but if you want more options you need to use the **Custom** endpoint along with an app that can ingest the Alerter payload.

I have written several apps to expand notification support to popular self-hosted notification platforms and included some nice QoL features:

* Map Komodo Alert Severity (ok, warning, critical) to notification priority
* Add Alert Severity to notification title
* Add resolved status to notification title
* Filter by resolved status
* Debounce based on resolved status (wait for X seconds and cancel notification if alert is resolved within time)

Available platforms:

* [ntfy](https://github.com/FoxxMD/deploy-ntfy-alerter)
* [gotify](https://github.com/FoxxMD/deploy-gotify-alerter)
* [discord](https://github.com/FoxxMD/deploy-discord-alerter) (more customization than built-in discord)
* [apprise](https://github.com/FoxxMD/deploy-apprise-alerter) (can be used to notify to any of the [100+ providers apprise supports](https://github.com/caronc/apprise/wiki#notification-services) including email)

___

[^import]: There has been much discussion in the Komodo discord about ways and future improvements to make "importing" existing stacks or containers easier. Nothing tangible yet but it seems likely there will be gains with this approach in the future.
[^template]: It's possible to use a ["template pattern"](https://github.com/mbecker20/komodo/issues/191#issuecomment-2481540600) to create a partially filled out Resource with most of these things defined already, though I haven't used this personally.