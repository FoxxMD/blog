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

It consists of a landing page that:

* lists all Sources/Clients, with some basic stats and a slew of link-buttons
  * Sources show an emulated Player, if player state is available
* a live log

![old dashboard](assets/img/msupdate/old-dashboard.jpg){: width="700" }

Navigating to Discovered/Scrobbled tracks shows a static page with a simple list of all Plays *in-memory* with some simple formatting.

![old recently played](assets/img/msupdate/old-recentlyplayed.jpg){: width="700" }

Finally, navigating to Failed Scrobbles renders a simple list of the track and mono-font display of some of the attributes of an error stored on the track.


![old recently played](assets/img/msupdate/old-failed.jpg){: width="700" }

You've probably already guessed but this site does not handle small/mobile screens very well. It is *readable* but certainly not a good experience.

![old dashboard mobile](assets/img/msupdate/old-dashboardmobile.jpg){: width="400" .w-25 .normal}
![old recently played mobile](assets/img/msupdate/old-recentlyplayedmobile.jpg){: width="400" .w-25 .normal}
![old failed mobile](assets/img/msupdate/old-failedscrobblesmobile.jpg){: width="400" .w-25 .normal}

