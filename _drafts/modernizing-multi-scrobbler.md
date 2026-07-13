---
title: Modernizing Multi-Scrobbler
description: >-
  Paying down technical debt on a 6-year-old project
author: FoxxMD
categories: [Rabbit Hole]
tags: [database, react, api, typescript, development]
pin: false
mermaid: true
---

![Arrested Development](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExdnpsdGJnbXIzYjJ1dzY5MGtpOTZxY3JzM2UxNGl4dnF4c29ncDdqYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qMDvt69lEC448/giphy-downsized.gif){: width="450" }

## Humble Beginnings

[**Multi-Scrobbler**](https://docs.multi-scrobbler.app/) (MS) is a dockerized application I wrote to solve an (initially) simple problem: monitor apps I listen to music with (**Sources**) and forward my listening behavior to the services I used to record that activity (**Clients**). The act of recording this history is colloquially, in the hobby, called **scrobbling**.

MS started life as a sparse, dev-only program; the [MVP](https://github.com/FoxxMD/multi-scrobbler/tree/be7f8828bd3a33b7c31d6c1c644da4a5320b4888) had no UI, no state of any kind, only monitored Spotify, and could only scrobble to [Maloja](https://github.com/krateng/maloja), my self-hosted scrobble server of choice 6 years ago. It was really just a hacked-together javascript script with a single purpose.

Even though I published the code it was only designed with myself in mind. Because of this I intentionally kept the design as small in scope as possible. No persistence of state/data. No debugging data or diagnostics. No documentation. Configuration was environmental variables only. It was *not user friendly* or designed to scale, but it worked for what I needed it to do.

## Multi-Scrobbler Today

Fast-forward 6 years. MS has gained a steady following among the niche audience of self-hosters who are also music enthusiasts (or personal data hoarders). With the increased attention came requests for monitoring more services and more features. Some highlights for MS now:

* **700,000+ image pulls** from Dockerhub and Github
* Supports **29** music sources and **8** services for recording, or broadcasting, that listening activity
* Extensive, partially self-documenting [documentation](https://docs.multi-scrobbler.app/) with configuration builder
* Test suite with 400+ tests
* A semi-live web dashboard for monitoring basic status and stats of configured Sources/Clients
* Technical Features:
  * Deduplication (matching) of scrobble before sending to individual services
    * Using multiple string similarity algorithms, temporal comparisons, and weighted scoring based on Source/Client types
  * Emulated (state machine) for Source Players to accurately detect paused/stopped/playing/resumed listening sessions
  * Graceful degradation and self-healing for service monitoring based on if errors occur due to network issues
  * Scrobble Queues to throttle requests to Client services
  * Retry queues so data is not lost due to network/auth issues and can be automatically, or manually, pushed later
  * [Transformation pipelines](https://docs.multi-scrobbler.app/configuration/transforms/) to automatically correct, or enrich, scrobbles in-flight using services like [Musicbrainz](https://docs.multi-scrobbler.app/configuration/transforms/musicbrainz/)

Needless to say, MS has far outgrown the design assumptions I made for it 6 years ago!

## Neglected Frontend

Of the features listed above, the web dashboard was one of the [first features added](https://github.com/FoxxMD/multi-scrobbler/releases/tag/0.3.6) and has also been the least updated. Since it's inception the *design* has barely changed, despite being ported from expressjs templates to basic react + tailwind.

It consists of a:

* A landing page with lists all Sources/Clients, with some basic stats and a slew of link-buttons
  * Sources show an emulated Player, if player state is available
  * a live log
* one page for displaying recently played/scrobbled per Source/Client
* one page for displaying failed scrobbles per Client

![old dashboard](assets/img/msupdate/old-dashboard.jpg){: width="700" }
_Landing page_

![old recently played](assets/img/msupdate/old-recentlyplayed.jpg){: width="700" }
_Navigating to Discovered/Scrobbled tracks shows a static page with a simple list of all Plays *in-memory* with some simple formatting._

![old recently played](assets/img/msupdate/old-failed.jpg){: width="700" }
_Navigating to Failed Scrobbles renders a simple list of the track and mono-font display of some of the attributes of an error stored on the track._

You've probably already guessed but this site does not handle small/mobile screens very well. It is *readable* but certainly not a good experience.

![old dashboard mobile](assets/img/msupdate/old-dashboardmobile.jpg){: width="400" .w-25 .normal}
![old recently played mobile](assets/img/msupdate/old-recentlyplayedmobile.jpg){: width="400" .w-25 .normal}
![old failed mobile](assets/img/msupdate/old-failedscrobblesmobile.jpg){: width="400" .w-25 .normal}

## Why Fix What Isn't Broken?

Despite its lack of charm and modern functionality, the frontend _does work_. Moreover, MS is designed to be a "set and forget" application: once it's configured you should not need to visit the UI for any ongoing maintenance or updates. The ideal scenario for an end user is that they get everything setup and then never look at it again. So then why update anything at all? The effort vs. reward for a new UI is low considering how little users will actually be using it.

### Pipelines are Cool But...

One of the last features I [highlighted](#multi-scrobbler-today) is relatively new, [**Scrobble Transforms.**](https://docs.multi-scrobbler.app/configuration/transforms/) This feature allows users to configure automated steps to modify their data in any individual Source/Client, before it is sent anywhere else. The steps can be hooked into various "stages" of the data lifecycle allowing very granular control of how the data is modified, when, where, and how. Some reasons a user might want to do this (and what it would do):

* A Source's service often incorrectly adds data to some field IE `My Title (Album Version)` when the title should just be `My Title`
* ID3 tags in your music collection are dirty or have repeating garbage IE `[YourMusicSource.com] My Artist - My Title` => get rid of `[YourMusicSource.com]`
* Correcting *any* track to match to the "canonical" version found on [Musicbrainz](https://musicbrainz.org/) so all data is normalized

This feature is powerful and extremely useful for users who want tight control over how their data is presented. However, it also adds a degree of uncertainty to what MS is actually doing. While MS does log everything, the logs are mostly meant for dev debugging, are ephemeral, noisy, and don't present a clear, linear story of what a Transformer is doing.

To put it another way...

**Before Transformers**, all the end user needed to know to have a mental model of MS's behavior was that Input X from Source A was parsed to a Scrobble like `this`.

**After Transformers**, the mental model needs to be able to compute that Input X from Source A was parsed to a Scrobble like `this`, then modified by Transformer Stage 1 to be `this + and this change`, and then modified by Transformer Stage 2 to be `this + and this change - this different change`, etc... getting more complicated for each additional transformer.

### The Siren's Call

It isn't tenable to display this in logs. I wrote a stop-gap JSON debug output, that contained all the steps and their diffs, that users could provide in an issue to help me troubleshoot and this did work for a while...but the root issue still remained.

Many users were creating issues for *relatively easy* transformer problems because their mental model could not follow the full journey of a scrobble through MS without some kind of linear aid.

In order to enable users to help themselves **the UI needed an update that could show a user the ordered steps, and results of modification, for scrobble data passing through MS.**
