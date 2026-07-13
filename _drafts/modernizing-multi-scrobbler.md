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

One of the last features I [highlighted](#multi-scrobbler-today) is relatively new, [**Scrobble Transforms.**](https://docs.multi-scrobbler.app/configuration/transforms/) This feature allows users to configure automated steps to modify their data in any individual Source/Client, before it is sent anywhere else. The steps can be hooked into various "stages" of the data lifecycle allowing very granular control of how the data is modified, when, where, and how.


<details markdown=1>

<summary>Why Would You Do this?</summary>

Some reasons a user might want to do this (and what it would do):

* A Source's service often incorrectly adds data to some field IE `My Title (Album Version)` when the title should just be `My Title`
* ID3 tags in your music collection are dirty or have repeating garbage IE `[YourMusicSource.com] My Artist - My Title` => get rid of `[YourMusicSource.com]`
* Correcting *any* track to match to the "canonical" version found on [Musicbrainz](https://musicbrainz.org/) so all data is normalized

</details>

This feature is powerful and extremely useful for users who want tight control over how their data is presented. However, it also adds a degree of uncertainty to what MS is actually doing. While MS does log everything, the logs are mostly meant for dev debugging, are ephemeral, noisy, and don't present a clear, linear story of what a Transformer is doing.

To put it another way...

**Before Transformers**, all the end user needed to know to have a mental model of MS's behavior was that Input X from Source A was parsed to a Scrobble like `this`.

**After Transformers**, the mental model needs to be able to compute that Input X from Source A was parsed to a Scrobble like `this`, then modified by Transformer Stage 1 to be `this + and this change`, and then modified by Transformer Stage 2 to be `this + and this change - this different change`, etc... getting more complicated for each additional transformer.

### The Siren's Call

It isn't tenable to display this in logs. I wrote a stop-gap JSON debug output, that contained all the steps and their diffs, that users could provide in an issue to help me troubleshoot and this did work for a while...but the root issue still remained.

Many users were creating issues for *relatively easy* transformer problems because their mental model could not follow the full journey of a scrobble through MS without some kind of linear aid.

In order to enable users to help themselves **the UI needed a redesign that could show a user the ordered steps, and results of modification, for scrobble data passing through MS.**

And since the frontend was so old, design-wise, it couldn't hurt to do a full redesign while I was at it, right?...

## User-First Design Requirements

Since these issues stemmed from the user's experience with MS I knew that I wanted to redesign with the user in mind first and foremost. **Ignoring all technical limitations, current architecture, and abilities of the backend, what would a design that solved all of the user's current problems with MS actually look like?**

I didn't need pixel-level detail but I did need the broad strokes for what kind of UI elements and UX would give users the story they needed to understand what MS would doing under the hood.

For this I turned to a close friend who is a professional UI/UX designer. I gathered user stories from github issues and my own perceived design goals and brought her a document that essential said "this is what MS does now, here are the pain points from users, and this is what I think they need".

We sat down one evening and began hammering out a plan. Along the way she challenged many of my assumptions about what the user needed as well as correcting my own biases about how UI should work. At the end of the evening we had the outline of a design that fit those user stories. It was an exciting exercise and had reinvigorated my motivation to get this thing started!

TBD design docs pics

### New Design Features

The primary, new design features that would satisfy the user stories were:

#### Detailed Source/Client Information

Displaying a page with detailed information about the current state of a Source/Client. This like a general state, specific activity updates, error display, important configuration, and relevant datetimes' for activity would help provide context to the user about how the Source/Client was currently behaving. Some of this was already present in the current UI in the landing page cards, but it would need to be fleshed out and given more space on its own page.

#### Detailed Plays List

The current UI already had individual pages for recently played/scrobbled but the information displayed is minimal: just the artist/track and when it occurred. The new UI would also need to display:

* *all* data including album, how the artists are separated, when it was ingested and scrobbled, and an alternative view to see the raw data
* any errors that occurred while processing
* most importantly, *a timeline of how the play was processed*

#### Play Timeline

**The most important new feature.** This timeline would show all the steps taken to ingest, parse, and modify the data, before it was sent to a Client or finally scrobbled.

This would give the users the context they needed to match their mental model with what MS was actually doing. It would allow them to iterate on configuration in order to get transformers to behave as they expect as well as diagnose when steps/services did not behave normally.

## Cost of Redesigning

As the dust settled and I got to thinking about what it would truly take to implement this redesign the reality began to set in.

![Arrested Development](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExdnpsdGJnbXIzYjJ1dzY5MGtpOTZxY3JzM2UxNGl4dnF4c29ncDdqYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/qMDvt69lEC448/giphy-downsized.gif){: width="450" }

### Memory Crisis

Due to the [initial, intentionally small scope](#humble-beginnings) I had designed MS to operate almost entirely with *in-memory* state. All Plays/Scrobbles, all of their data associated data, the state of that data within each Source/Client, state of each Source/Client, everything...it's all stored in-memory. The exceptions to this were for long-lived service auth tokens, some api calls, and [*queued scrobbles*](https://github.com/FoxxMD/multi-scrobbler/releases/tag/0.10.0) which had been implemented so that un-scrobbled data would not be lost across restarts.

The [Play Timeline](#play-timeline) feature required that the majority of the data above always be available. Additionally, to complete this timeline, the [debug data](#the-sirens-call) stop-gap I had written would also need to be made permanent. **The size of this data could be 2-5x larger than the Play itself due** to needing to persist all of the ingress data for a Play and all of the responses from transformers like Musicbrainz.

Worst-case scenario for this meant a single Play could be 6-15kb of plain JSON which, when represented as native objects, could be hundreds of kb. Some MS power users can listen to 100 tracks a day. So, to keep one week of data in-memory for 1x Source + 1x Client = 1400 Plays:

* A conservative 100kb of native objects = 140mb
* Marshaling all Plays to/from JSON for each operation needed, so keeping them at 15kb = 20mb

Only one week of Plays history for the minimal usecase would mean 20mb with a significant rewrite + cpu usage for serialize/deserialize, or 140mb for native access. Yikes. And this does not include any queued Plays or Plays stored for duplicate matching. Now imagine having 4-6 Source/Clients and wanting to keep history for a month. The required memory would have been unacceptable.

The other issue here is that restarting MS would wipe out all this history! I considered storing all Plays in the cache, alongside the queued scrobbles, but this meant either a) unserializing everything on start which still incurs the memory problem or b) unserializing when needed but keeping track of everything that was cached.

**If only there was some kind of disk-based, indexed cache storage system where I could persist data?**

**Yeah, it's called a database.**

![gordan ramsey idiot sandwhich gif](https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExZXp2OXM0MTJ3YnYwN2V3eGZram1scDh1aTdteTg4YnNvYjVsd3E1ZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3o85xnoIXebk3xYx4Q/giphy.gif){: width="300" }

Hindsight is 20/20 but if I'm being honest I should have known this would happen from the start. All of the scrobble Clients MS interfaces with use a database for storing this data. It was inevitable that MS would need this flexibility, too. The migration from in-memory to database should have happened soon after MS's MVP, but it did not and here we are now.

**So, a database would solve the issue of ballooning memory and enable long-term storage of Plays with all the data I needed to render a timeline. But how to go about implementing this database usage in MS?**

### Backend Architecture

As mentioned in the previous section, MS was implemented with the assumption that all data is accessible immediately in-memory. That means that queues, lists of Plays, etc.. are tightly coupled to, and being accessed as, native data types.

```js
function checkForDupes(scrobble) {

  // existingScrobbles is an in-memory array
  // and it is using javascript's array .find method to look for dupes
  const dupe = this.existingScrobbles.find(x => x.title === scrobble.title && x.time === scrobble.time);

  return dupe;

}
```

Moving to a database would mean many of these structures would need to be moved behind database api calls with more restrictive scope in order to get just a subset of data.

```js
function checkForDupes(scrobble) {

  // get subset of possible matches from stored plays
  const candidates = this.db.findTimeRange.({before: scrobble.time.subtract('5', 'min'), after: scrobble.time.add('5', 'min')});
  if(candidates.length === 0) {
    return undefined;
  }
  const dupe = candidates.find(x => x.title === scrobble.title && x.time === scrobble.time);
  return dupe;

}
```

It would also mean that modifying Play data was no longer a simple property assignment operation but would require an update to a database entry.

 ```js
function transform(scrobble) {
  // in memory, properties can be re-assigned before passing back. 
  // or re-assign entire variable
  // 
  // for non-db context this is all that is needed
  const transformed = this.transformScrobble(scrobble);

  scrobble.input = transformed.input;
  scrobble.data = {
    ...scrobble.data,
    artists: transformed.data.artists
  }

  return scrobble;
}

// for db implementation
// additionally need to call this in the right context instead the above
// so that the database is in sync
function transformAndUpdate(scrobble) {
  const transformed = this.transform(scrobble);

  this.db.update(transformed.id, {data: transformed});
}
```

**The core design of MS would not need to be altered drastically but the database implementation would touch almost every part of the existing code.** And all of this would need to be done *before* UI could be wired into the backend.

**The true cost of this redesign was *huge*. Not insurmountable or extremely cognitively difficult, but *wide* in its scope and implementation.**
