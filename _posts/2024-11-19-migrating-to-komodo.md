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
name = "test-stack"
description = "stack test"
deploy = true
[stack.config]
server_id = "server-prod" # server from resource above
file_paths = ["mongo.yaml", "compose.yaml"]
git_provider = "git.mogh.tech"
git_account = "mbecker20"
repo = "mbecker20/stack_test"
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

Komodo does not have a way to create standalone containers that way Portainer does. It expects you to create stacks ([docker compose](https://docs.docker.com/reference/compose-file/) `compose.yaml` files) for everything you want to manage. It _does_ support starting/stopping existing containers but that's not really what it's there for.

Komodo wants you to _declaratively_ define what is it you want to run, rather than _imperatively_ creating it for you the way Portainer->Containers does.

This is not limited to standalone containers, either. If you have existing stacks running on a machine Komodo will not automatically surface them in the UI the way dockge does when pointed to a folder full of compose files. While Komodo can manage existing stacks/compose files you will still need to "create" the stack in Komodo and tell it where the files are before it can take over management.[^import]

This requirement of explicitly specify all your infrastructure applies to all other Resources in Komodo. At the moment this is a fact of life.

However this should not deter you! Getting all of your lab into a well-defined configuration is something you've been striving for, remember? Do a little bit at a time so it isn't overwhelming. Komodo can co-exist with whatever you've been using up till now so there's all-or-nothing rush.

#### Unopinionated Resource Storage

The second hurdle is that there is no Best Way™️ to store and backup all of your Resources. Komodo offers three ways to get/set resources:

* Modify directly in UI (Komodo will write to a directory of your choice under its control)
* Files on Server (existing files you point, it cannot edit them)
* Git Repo (pull from a repo and optionally write to it if you have access)

You can choose which method to use for each Stack and, actually, every Resource individually in Komodo. You could have some Stacks be from existing compose files on your machine and some pull from a Git Repo. Meanwhile, the Komodo Resource sync writes directly to a folder you have mapped somewhere else.

The issue is that these are all valid ways to use Komodo and you have to make the difficult decision of choosing what approach you want to do before you start creating any Resources at all. You should long and hard about what you want to do because going back to modify everything later might end up being a big hassle.

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

## Migrating

### Choosing A Storage Strategy

I knew I wanted to get all of my stacks and containers backed up somewhere other than my machine. Komodo's full power is taking advantage of a **Git Repo**-based resources so that they can be committed when you save anything in the UI so I knew this is what I wanted. It makes backup coupled to changes so it's basically set-and-forget at the cost of having a potentially noisy git log if you make lots of little changes or tinker with a stack. This was a comprise I thought was worth the peace of mind.

I do use [unraid](https://unraid.net/) and considered standing up Gitea with docker but since we're talking about basic text, github offers free private repos, and I wasn't going to be storing sensitive info there anyways I opted for github so that the backup was truly offsite.

All of my Resources and Stacks would then be Git Repo based.

### Git Repo

I went with a monorepo for all my resources. I like this over individual repos per resource so that I can more easily see a "combined" git log of all the changes I've made over my entire lab. The cost for this choice is that every new Resource requires having `Run Directory` defined rather than just `Repo`.[^template]

The structure of my repo looks like:

```
stacks/
├── server1/
│   ├── immich/
│   │   └── compose.yaml
│   └── frigate/
│       ├── compose.yaml
│       └── tesnor.compose.yaml
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

### Converting Standalone Containers

The majority of my services were containers created with Portainer. To turn each of these into a stack I used [docker-autocompose](https://github.com/Red5d/docker-autocompose) as a docker container to generate a compose file to output:

```shell
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock ghcr.io/red5d/docker-autocompose container_name
```

which can then be copy-pasted into a new stack in Komodo with the corresponding `Run Directory` for the service.

Alternatively, use one of these [shell scripts](https://github.com/Red5d/docker-autocompose/issues/50) to generate files for each running container. Then move each file into the correct folder in your repo folder and commit. Then create new stacks for each in Komodo pointing to the correct `Run Directory`.

docker-autocompose tends to create verbose files, however. Labels, default environment variables (exposed from Dockerfile), and dropped security permissions can all be pruned from the files -- but it is a good starting point.

___

[^import]: There has been much discussion in the Komodo discord about ways and future improvements to make "importing" existing stacks or containers easier. Nothing tangible yet but it seems likely there will be gains with this approach in the future.
[^template]: It's possible to use a ["template pattern"](https://github.com/mbecker20/komodo/issues/191#issuecomment-2481540600) to create a partially filled out Resource with most of these things defined already, though I haven't used this personally.