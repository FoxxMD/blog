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

### Neglected Frontend

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

## Implementation Part One: Backend

### Choosing a Database

Database choice actually began with researching ORMs for typescript. Though MS could be pulled off with pure SQL there are enough relationships between Source/Client, Plays, duplicates, etc... that not having to manage all of these joins manually was a priority on my list.

I have used [TypeORM](https://github.com/typeorm/typeorm) in the past and it was *fine* but I was looking for something that was moving a little faster and didn't require decorators.

I experimented with [Kysely](https://www.kysely.dev/) for a while but that lack of stronger ORMs capabilities eventually steered me away. Eventually, I settled on [Drizzle](https://orm.drizzle.team/) for a few reasons:

* [lack of dependencies](https://orm.drizzle.team/docs/overview#headless-orm)
* unopinionated design with regard to entity configuration
* transparent [data type](https://orm.drizzle.team/docs/column-types) marshalling
  * IE [`Date` objects are converted to sqlite `number`](https://orm.drizzle.team/docs/sqlite/column-types#integer) out of the box
* [custom types](https://orm.drizzle.team/docs/sqlite/custom-types) make it easy to marshal json with specific conversion requirements at the database boundary
* for [operations](https://orm.drizzle.team/docs/sqlite/data-querying) it offers both
  * [ORM-like CRUD convenience functions](https://orm.drizzle.team/docs/sqlite/rqb) with relational updates
  * and granular, [query-builder-to-SQL methods](https://orm.drizzle.team/docs/sqlite/select) for more control
* typescript is a first-class citizen and *so many* types and type-builders are available out-of-the-box
  * Makes typing arguments outside of drizzle functions much easier and somewhat composable

#### Database

Once I settled on Drizzle I needed to choose what [database](https://orm.drizzle.team/docs/sqlite/connect-overview) MS would actually use.

One of MS's features that I wanted to preserve was its lack of external state *outside the container*. I distinctly remember, as a beginning self-hoster, appreciating projects that kept all data "in one place" rather than requiring separate containers with their own volumes to hold database data or queues or whatever. Knowing there was one folder where *everything* that was needed to run the application lived made it easier to backup and transfer my app to somewhere else.

Even with MS's expanded scope it's still not big enough to need this separate container mentality, so to preserve this beginner-friendly encapsulation I wanted to use a serverless database that could fully be stored a file/folder right in the MS configuration directory. This narrowed my choices to **sqlite** and the upstart [**pglite**](https://pglite.dev/).

> To evaluate these databases, and drizzle itself, I wrote connection and db building logic as independent modules and then implemented a [test suite](https://github.com/FoxxMD/multi-scrobbler/blob/fab2e4938de35713868ecd048b4e793890c71b68/src/backend/tests/database/drizzle.test.ts) with [mocha](https://mochajs.org/) and [chai](https://www.chaijs.com/) to test all of the basic facets I would be using:
>
> * database creation and IoC
> * database backup and migration
> * Play creation and updating with type marshalling
> * search and filtering
>
> This saved me from needing to rewrite any of MS core logic before evaluating that drizzle + the chosen db would be suitable for the job.
{: .prompt-info }

I initially implemented the test suite with **sqlite** as the database. This went fairly smoothly after doing *some* digging around in the drizzle github discussions for more niche uses of custom types and query filter typing.

Then, [I tried out pglite](https://github.com/FoxxMD/multi-scrobbler/pull/593) as it is a very attractive proposition. A full postgres database in a single folder that only needs a client, no server, and can use almost all postgres extensions?? My initial testing was very promising: the startup time and performance was almost equivalent to sqlite but with much better space-saving characteristics on disk due to json being converted to JSONB.

However, the memory usage with pglite was [3-4x](https://github.com/FoxxMD/multi-scrobbler/pull/588#issuecomment-4431828405) higher than the same scenarios with sqlite due to (obviously) needing to embed the entire pglite engine in memory. If MS was a much more sophisticated application that took full advantage (or needed) many of the extensions to operate this cost could have be justified, but it does not need them and so, sadly, pglite was off the table. 

**Thus, I settled on sqlite as the backing database for MS.**

Let me set the record straight, though, sqlite is no slouch: its performance is above and beyond what is required by MS, even when handling 10's of thousands of Plays. This is bolstered by the fact that Koito, a scrobble server I actually use, [migrated *from* postgres *to* sqlite.](https://github.com/gabehf/Koito/releases/tag/v0.1.8) Clearly, if it's good enough for Koito it's good enough for MS.

![sqlite bird](assets/img/msupdate/sqlite.png){: width="500" }

### Syncing Source-of-Truth Entities

The first hurdle for actually migrating to a database was ensuring that entities that are generated *from config* on each startup match up to the entities stores *in the database*. Specifically, [Sources](https://docs.multi-scrobbler.app/configuration/sources/) and [Clients](https://docs.multi-scrobbler.app/configuration/clients/) are created from [configuration](https://docs.multi-scrobbler.app/configuration/#configuration-types) that is considered the source-of-truth for the application. If configuration for `Source A` changes in file, how do we ensure that the representation of `Source A` in the database is associated with the changed entity that is created at startup? This affects more than just the Source shown in the web UI: all Plays, queued scrobbles, and transformers are associated with a Source/Client as is all of their historical data.

The solution was simple but required a breaking change. We would introduce an atomic [`id`](https://docs.multi-scrobbler.app/updating/upgrade-path/0140/#configuring-ids) that must be included in configuration for each Source/Client. Regardless of what other properties change in the config, this id will always determine what database entity the generated config entity is associated with.

To make this breaking change *somewhat* backwards compatible I fallback to using the Source/Client `name` property as the ID. With the drawback of this being that the user must define any future config as the id used at the time they migrated to MS 0.14.0 >=.

### Play Serialization

On the issue of converting Plays/Scrobbles to be useable for both the database and the MS domain logic I settled on a compromise of keeping Plays as plain, JSON serializable objects in both memory and the database.

Converting Plays to a fully normalized database entity where artists, albums, and other meta properties were separate entities would have been a *massive* rewrite in the domain where Plays are currently one plain object:

```jsonc
{
  "data": {
    "title": "Foo",
    "artists": ["Guy 1", "Guy 2"], // convert these to rows in deduplicated table
    "album": "Bar" // convert this to row in a deduplicated table, associate with artists
  },
  "meta": {
    "source": "Jellyfin", // convert this to row in a deduplicated table
    "url": "http://yourJelly/..."
  }
}
```

While normalized tables would be more space efficient and closer to the schema downstream scrobble services like Koito use, Multi-Scrobbler *is not* a full-blown scrobble server and I did not want to design it to be as such. It should be able to hold a months' worth of data, not years or decades. Space efficiency is *good* but the main priority is moving that space out of memory and on to disk, not optimizing for disk usage. The cost of optimizing for disk would have been a much longer rewrite of all domain logic to treat the Play object as separate entities for each of the above properties. Too high a cost at the current time.

On the database side, this is actually not a huge drawback. Since plays are serializable, and queryable, as plain JSON we can take advantage of [sqlite's built-in json functions](https://sqlite.org/json1.html) to query facets of play data directly in the database, when needed.

### Queues and Querying Lists

The main implementation effort took place here. As [mentioned above](#backend-architecture), all of MS's access for "lists of Plays" is done under the assumption of immediate, in-memory access.

This was an issue even before the frontend redesign: users with heavy listening activity or chronically degraded services were reported large memory increases as queues got backed up with 100s of Plays waiting to be processed or backlogged. All of these Plays needed to stay in memory, which was convenient for querying/manipulating them but terrible for end users.

This was addressed in two phases:

#### Historical Scrobble Querying

Historical (duplicate) scrobble matching was previously accomplished by querying and storing an in-memory list of the most recent scrobbles from downstream clients. If a candidate scrobble was outside the time range of this initial list (which is updated as scrobbles are made) then it was *dropped*, or matching could be bypassed entirely by config and forced to scrobble. In order to allow a longer time range more scrobbles would need to be queried and held in memory. The trade-off between better historical matching was linear memory growth.

This was approach was [re-written](https://github.com/FoxxMD/multi-scrobbler/releases/tag/0.12.0) so that all Clients implement a paginated, time-range queryable API surface. The generic scrobble process can request any arbitrary time-range and get back a list of scrobbles, from the downstream api, that occurred during that time. This list is then queried for duplicates and cached for a short time in an LRU cache.

This allowed historical matching any time range without the memory penalty and removed one structure from the list of in-memory lists that needed to be culled.

The second part of this matching relies on matching against any scrobbles *specifically seen by MS*, rather than rely on downstream api responses. The matching logic was preserved but the method of "getting the existing list" was rewritten to use a similar API that queries the Plays in the database associated with the client and returns a relevant time range for the candidate scrobble.

#### Queued Plays

Initially, I investigated using existing queue libraries backed by file, or sqlite, like [workmatic](https://github.com/litepacks/workmatic) but eventually decided against using any of them because they all had the same drawback: the jobs in queue could not be easily queried. There is the possibility of many Plays being queued for processing for a non-trivial amount of time and I wanted the frontend redesign to be able to display which Plays were queued and what state they were in.

So I rolled my own, simple, queue system. MS stores all Plays in the database, regardless of what queue or state they are in. Then, they get associated to a specific [`queue_state` entity](https://github.com/FoxxMD/multi-scrobbler/blob/fab2e4938de35713868ecd048b4e793890c71b68/src/backend/common/database/drizzle/schema/schema.ts#L138) that dictates which queue they are in, what the status of processing is, and when it was created/seen (to determine queue order).

A function that queries the database for Plays with this `queue_state` and `queueStatus=queued` is used to "pop" the Play off the queue and feed it into the Source/Client processing logic. At the end of processing the `queueStatus` is **always** updated so that the next query will always return a different Play.

```ts
let nextQueued = await this.playRepo.getQueueNext(CLIENT_INGRESS_QUEUE);
if(nextQueued !== undefined) {
    while (nextQueued !== undefined) {
        // processes Play
        // and in try-catch finally block
        // updates `queueStatus` based on result
        await this.processQueueCurrentScrobble(nextQueued, signal);
        nextQueued = await this.playRepo.getQueueNext(CLIENT_INGRESS_QUEUE)
    }
    this.emitEvent('queueEmptied', {});
}
```

This replaces the in-memory queue "list" entirely and makes it so our queue length no longer affects memory consumed.

![have you tried tables](assets/img/msupdate/queue_table.png){: width="500" }

### Data Retention

As mentioned in the [section on Play serialization](#play-serialization), I am very intentionally *not* trying to position MS as a full scrobble server replacement. There are many excellent services that do this much better than MS, like [Koito](https://koito.io/) and [Listenbrainz](https://listenbrainz.org/), and more radically different implementation like [teal.fm](https://docs.multi-scrobbler.app/configuration/clients/tealfm/) that MS could never be a substitute for.

This intentional design choice means compromises can be made in how data is stored that allow more development convenience at the expense of on-disk data usage. However, a decision still needed to be made about how to address this data retention in order to prevent storing data indefinitely.

I decided to implement a two-tier retention policy that strikes a balance between space reclamation and usefulness for troubleshooting issues.

Both policies are set using simple, user-friendly time intervals strings like `50 minutes` or `7 days`.

The first policy is **compaction**. This policy deletes associated debug data like original input payload, transform step diffs and inputs, and duplicate matching breakdowns. This is the data you would want if you were troubleshooting while a Play didn't behave the way you expect, but it's not essential for just viewing that a scrobble happened with basic timeline events.

The second policy is **deletion**. This is a full deletion of the Play and all associated data.

Together, these policies allow a lenient way to reclaim space without sacrificing troubleshooting for immediate issues EX:

* compact after `5 days` => you have 5 days to check spot check all Plays to see that activity is working as expected. If not, make a copy of the debug data for creating a github issue
* delete after `2 weeks` => you have 2 weeks to see all history with basic timeline events and essential scrobble data like title/artist/album etc...

 To keep MS aggressive on space use in the worst-case scenario I defaulted these policies to `3 days` compaction and `7 days` deletion. But these can be updated by the user with simple ENV or file configuration globally or per Source/Client.

## Implementation Part Two: Frontend

### My Achilles Heel

I'll be the first to admit that my UI/UX and design skills *are not great*.

I'm not so bad as to fill the stereotype of *"unstyled html with every button and field on the same page"* engineer but visual creativity is a challenge for me. I usually rely on exhaustive component frameworks like [antd](https://ant.design/) to do the heavy lifting on UI and then I slap together whatever work on the page.

Shamefully, the majority of my frontend implementations have been born from a vague idea in my mind where I design *and implement* at the same time without any thought for layout/design ahead of time. There is very little iteration.

### Design First

With this redesign I was determined to do things The Right Way™️ so that my efforts aren't wasted on rewriting later, my users get actual improvements in experience, and I can gain the skills necessary to implement future projects without as much pain.

The first step for this was already done: my UI/UX design friend had already [sat me down](#user-first-design-requirements) and helped me hammer out a rough outline of the design along with (not so) gently challenging my assumptions about how to design for UX.

Now, I wanted to put this design into practice in a way that I could iterate on without needing to do the full implementation inside the codebase. After some research, I landed on using [**Storybook**](https://storybook.js.org/) for this process, mainly because it [already supported integration](https://storybook.js.org/docs/builders/vite) with my existing frontend tooling library, [vite.](https://vite.dev/)

Storybook enabled me to build components in isolation so that I could quickly iterate on how each functioned and rendered without having to wire up a full backend, or dependent components, to make them work.

I used a combination of hand-rolled [data interface fixtures](https://github.com/FoxxMD/multi-scrobbler/blob/fab2e4938de35713868ecd048b4e793890c71b68/src/core/tests/utils/apiFixtures.ts) using [Faker](https://fakerjs.dev/) for randomized data, and [MSW](https://storybook.js.org/docs/writing-stories/mocking-data-and-modules/mocking-network-requests#set-up-the-msw-addon) for mocking API calls so that each storied compoonent could get "real" data that would match the actual, eventual implementation used in MS.

This approach also enabled me to hammer out the API interface the backend would eventually implement, driven by the needs of the frontend.

> Additionally, this helped informed my decision for state and API interaction in the frontend implementation. I was already sticking with React since its what I knew but I found that [Tanstack Query](https://tanstack.com/query) met my needs quite well while being much lighter than something like [RTK Query](https://redux-toolkit.js.org/rtk-query/overview).
{: .prompt-info }

#### Component Library

The last planning step was choosing a component library. I probably spent the most time on this step as there are just *so many* libraries to choose from these days.

Having previously worked with antd I knew I didn't want to go with any library that was as heavily opinionated as it was.

A benefit of libraries like ant is that they are *exhaustive* and will have implementations, or features, missing from more orthogonal libraries, such as fully-featured Tables with filters/sorting baked in. However, the drawback with these libraries is that if you need to do something that is custom or out of scope you are *really out of luck* and they can become incredible difficult to work with.

At the same time, I was wary about diving in to something like [shadcn](https://ui.shadcn.com/) because I did not want to be responsible for every single component and how they are all composed. I know headless ui libraries are *so hot right now* but it seemed like too much work for my scope, where I wanted to create an implementation with a modicum of flexibility but that wouldn't need to be fully bespoke. Remember, [if Multi-Scrobbler is working as intended you shouldn't need to use the web UI at all.](#why-fix-what-isnt-broken) I didn't want to spend a ton of time creating a UI where the ideal usecase is that a user looks at it for 2 minutes for the entire lifetime of the app.

After much hand-wringing and tinkering in different doc playgrounds, I finally settled on [Chakra UI](https://www.chakra-ui.com/). Chakra strikes a good balance, for me, between allowing users to compose components and providing an opinionated framework. It is built on [Ark UI](https://ark-ui.com/), a headless ui library like shadcn, but provides a batteries-included UI/UX experience that can be tailored when needed.

### Timeline Trial By Fire

With tooling for frontend decided and a library chosen the next step was start implementing the design.

I decided to start with the hardest, and more important, element of the design: the [Play Timeline](#play-timeline). This is the linchpin of all the user stories and planning I had done so if Chakra couldn't handle this then it wasn't up to the job for the rest of the app.

From sketch:

![sketch rough](assets/img/msupdate/timeline-rough-sketch.jpg){: width="300" .normal}
![sketch detailed](assets/img/msupdate/timeline-detailed-sketch.jpg){: width="300" .normal}

To implementation:

![implementation1](assets/img/msupdate/ms-timeline.png)
![implementation-error](assets/img/msupdate/ms-mbemptyquery.png)

This worked out quite well! Transform steps are a nested timeline within the main Play events timeline. For both, using [`@pierre/diffs`](https://github.com/pierrecomputer/pierre) to visualize line-by-line differences and [`json-diff-ts`](https://github.com/ltwlf/json-diff-ts) to apply changes between steps in order to visualize the final rendered gives users a clear display of how their scrobble data changes over time.

After trialing the timeline, the rest of the redesign *mostly* fell in to place with much iteration and more feedback from my design friend.

### Landing Page

The landing page retained some of its old look, with summaries of Source/Client being listed in a *now* responsive design that is friendly for both mobile and desktop.

![old dashboard](assets/img/msupdate/old-dashboard.jpg){: width="600" }
_old landing_
![new dashboard](assets/img/msupdate/ms-componentlist.png){: width="600" }
_new landing on mobile_
![new dashboard desktop](assets/img/msupdate/ms-componentlistdesktop.png){: width="800" }
_new landing on desktop_
![live indicators](assets/img/msupdate/ms-liveupdates.png)
_real time update indicators_

Critically, though, all of the actions from the old landing are gone, as well as the logs. One of the lessons learned from my design friend was the concept of [**progressive disclosure**](https://en.wikipedia.org/wiki/Progressive_disclosure): only present the information that is required for the current task a user is doing.

The old landing displayed summaries, logs, and actions all together without any thought for what the user would need to be doing. This meant that the page (Source/Client cards) were cramped and full of potentially unneeded information.

Now, the new landing page presents the user with a way to quickly see only relevant summary information (state of Source/Client, live update indicators) with the option to navigate to a new screen that presents more detailed information and actions *for only the component they care about*.


#### Logs

The Logs UX is another implementation of progressive disclosure. Most users don't immediately need Logs to be accessible as they present noisy data that is largely only useful for troubleshooting purposes.

In the old UI logs were always visible at the bottom of the landing page. They were not (and still aren't really) mobile-friendly but were there, regardless.

Now, they are accessible through a button in the header and present as a floating window that can be accessed *from anywhere in the app*. Logs are now *more* accessible but also *less intrusive*. If a user knows they want them, they are there when they need them. Otherwise, they'll never be in the way.

![app header](assets/img/msupdate/ms-header.png)
_Logs "terminal" button always visible in the header_

![logs](assets/img/msupdate/ms-logs.jpg){: width="800" }
_Float Logs window_

### Source/Client Details

There was no details page to compare from the old ui, so here is the new ui presented without context:

![source client details](assets/img/msupdate/ms-componentdetailed.png)
_The details page for a Spotify Source_

More progressive disclosure here: Instead of displaying all possible actions for a Source/Client (restart, stop, authenticate, etc...), a primary (common) action is displayed contextually next to the current state of the component (`Running` -> `Power Off button`). A menu button allows choosing a secondary action.

### Play Lists

In the old UI the Plays for a Source/Client were on different pages separated by type (scrobbled, failed).

![old recently played](assets/img/msupdate/old-recentlyplayed.jpg){: width="700" }
_Recently played Plays on a Source in the old UI_

Now, all associated Plays are unified into a single view with the type of Play represented by a colorful state badge. The type of Play can be filtered, along with time played at, and other attributes, in a virtual list with infinite loading for easier navigation on mobile.

This gives users a cognitively easy way to check on any specific Play, or EX see only problematic Plays by filtering by Failed, without having to leave the current view.

![plays list](assets/img/msupdate/ms-playlist.jpg){: width="700" }
_Filtering by failed scrobbles_

### Play Details

Once again, progressive disclosure reveals only the required information to make a decision without overwhelming the user. 

The unexpanded Play shows a summary of the track data and state. The state badge also shows a primary action if the state contextually needs it.

Within an expanded Play, relevant information is surfaced if necessary based on the state of the Play.

![failed played](assets/img/msupdate/ms-playfailed.png){: width="700" }
_Play badge shows retry button when in failed state, surfaces error, and indicates what section error occurred in_

This is a *huge* improvement over the old UI which showed only a preview of the error without any context.

![old failed](assets/img/msupdate/old-failed.jpg){: width="600" }

## Closing Thoughts

A seemingly straight-forward new feature, *showing the user a timeline of events we already persist*, turned out to be a monumental task.

I couldn't have planned for this eventuality from the very beginning but the warning signs were there for a long time. I dragged my feet for *years* on tackling this architecture issue and when it finally showed its face it was a much larger beast than had I dealt with it early.

At the same time, Multi-Scrobbler's backend architecture was in flux for a large part of its early life. Additionally, the ORM/DB library scene in typescript has taken massive leaps in maturity and feature sets in the last few years. Had I decided to implement a database design earlier I may have locked myself into a design for MS that would have been rigid and slowed development as well as being hampered by the immature tools of the time. So it's hard to say *when* was the right time to tackle this challenge. Though *now* is always better than *never*.

Despite the above whinging, I truly enjoyed climbing this mountain. It gave me the opportunity to re-think a non-trivial project at 1000ft level and then learn how to actually implement that refactor without having to burn everything down. I haven't had a chance to do a surgical refactor like this, it was a learning experience.

Additionally, I finally got to try my hand at *proper* design-first implementation with real-world tools (Storybook) and iterate on development for the frontend in a way I haven't been able to before. I learned so much about developing APIs based on design needs and felt like I got a real glimpse of what it means to be a "frontend developer".

**If you are a developer reading this**, I implore you to get your hands dirty in your next big refactor. Gen AI assistance has been a huge boon for velocity, especially in indie project, but doing everything *manually* lets you sharpen your skills and learn new lessons you wouldn't get by just letting Claude plan and refactor your code. There's a balance to be struck between hand-rolling every function and letting 10 sub agents commit over your entire worktree.

**If you are a multi-scrobbler user**, I hope this was an insightful read into what it takes to keep your scrobbles flowing frictionlessly! If this gave you any ideas about how MS could be better, or what else you would like to see it doing in the future, please don't hesitate to drop a [feature request](https://github.com/FoxxMD/multi-scrobbler/issues/new?template=02-feature-request.yml) in the github issues! I'm looking forward to hearing from you. 🎵
