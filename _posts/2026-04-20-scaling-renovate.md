---
title: Renovate + Komodo - Updating at Scale in a Large Homelab
description: >-
  Renovate rules and Komodo actions for managing updates in a 50+ stack homelab
author: FoxxMD
categories: [Tutorial]
tags: [docker, renovate, komodo]
pin: false
mermaid: false
date: 2026-04-20 08:41:00 -0400
---

## Intro

If you are already in the [Komodo ecosystem](./migrating-to-komodo) you have probably run across across [Nick Cunningham's guide](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo) on setting up [Renovate Bot](https://docs.renovatebot.com/) to manage docker image updates in your compose stacks.

Nick's guide is *excellent* for getting all the infrastructure set up for this scenario but stops a little short of providing an *exhaustive*, opinionated way of actually configuring Renovate to be used in your lab. Yes, it does [provide a renovate config](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo#configure-renovate-in-the-repo) with a few rules that do work well for a trivial use case but this config becomes unwieldy quickly as the number of stacks in your repo grows.

This guide builds on top of Nick's fantastic starting point: **I present further configuration for Renovate and Komodo that will help you keep the noise level low in a lab with 100+ compose stacks.**

### Prerequisties

If you aren't already familiar with the above topics or don't have everything set up you will need these pieces of infrastructure in place first (in this order):

* [Komodo](./migrating-to-komodo) configured with [Stacks](./migrating-to-komodo#creating-stacks) utilizing [Git Repo(s)](./migrating-to-komodo#creating-stacks)
  * Renovate will work best with the monorepo strategy described in the links above, but it's also useable with per-repo stacks if you want to do that.
* Not *strictly* necessary but using Komodo, forgejo + webhooks, and the optional registry proxy-cache will be much easier if you have some kind of [reverse proxy](./migrating-to-traefik/) set up with all of these services tied into it. That will also require [DNS for the reverse proxy](./redundant-lan-dns), however you want to implement it.
  * This guide will assume you have this configured. If you do not then anywhere you see an example address like `https://subdomain.example.com` you'll need to substitute it for the respective `http://serviceHostIp:port` in your set up.
* (Using Nick's guide) [Forgejo](https://nickcunningh.am/blog/how-to-setup-and-configure-forgejo-with-support-for-forgejo-actions-and-more), [Forgejo Actions](https://nickcunningh.am/blog/how-to-setup-and-configure-forgejo-with-support-for-forgejo-actions-and-more#setting-up-forgejo-actions), and [Renovate Bot as a repo connected to Actions](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo#setting-up-renovate)

## Limiting Deployments on Komodo to Non-Critical Stacks

Nick's guide uses Forgejo webhooks on your repository to trigger a [Komodo Procedure](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo#create-a-procedure-in-komodo) to run. The Procedure is a `Batch Deploy Stack If Changed` action that targets *all* Stacks. There are two issues with this.

### The Problem

#### Forgejo Webhooks Triggers are Not Granular

Forgejo webhooks can be enabled to trigger on *any* push to the repository or *any* PR state change (opened, closed, synchronized, etc...). From the UI you cannot control any other conditions on these types of triggers. What this means in practice is that:

* You *cannot* only trigger on repo push events **only from the renovate bot**
  * EX You make changes in Komodo to a stack and write the contents -> This commits to the repo (as your user) -> triggers webhook
  * This is undesired! We only want webhooks triggered if we are merging commits from renovate bot, not just for any random change we make in Komodo
* PR state changes cannot be specified
  * EX You close a PR without merged -> triggered webhook
  * We really only want to trigger if a PR is successfully merged, not for every single rebase, comment, etc...

So even though our intent is to only have Forgejo trigger Komodo deployments when we merge a PR from Renovate Bot our Forgejo webhook triggers are too broad and there's nothing we can really do about it from the repo ui.

#### Komodo Procedure can re-deploy Critical Infrastructure

While the `Batch Deploy Stack If Changed` action *is smart enough* to only re-deploy stacks that have new image updates or have changes to their compose.yaml contents there are still many scenarios where we might not want this happen. Using the procedure config from Nick's guide, using `*` as a target, *every stack that has pending changes will be re-deployed*. That potentially includes:

* the Forgejo instance
* your reverse proxy
* DNS
* periphery containers
* etc...

These are stacks that we depend on to sucessfully deploy other stacks. You don't want Forgejo restarting while Komodo is trying to pull from it for a deployment somewhere else!

While we can change the target of `Batch Deploy Stack If Changed`, it is *inclusive*. It's not feasible to specify every single stack that could be deployed as we'd have to update it every time we add a new Stack to Komodo. And once the number of stacks is non-trivial this becomes impractical.

### The Solution

We can address both of the above issues by writing our own [Komodo **Actions**](https://komo.do/docs/automate/procedures#actions) to

1. **filter webhook triggers to only renovate bot and**
2. **trigger a `Batch Deploy Stack If Changed` with targets based on Tags.**

#### 1. Tag Critical Infra

**Tags** are presented as a visual-organization tool in Komodo but they can be used for much more than that: Tags are surfaced as a property of all Komodo Resources when querying the API. We can therefore use these as a signal to *exclude* resources from being deployed.

First, you'll need to tag the relevant resources, in the Komodo UI:

* Create a new Tag
  * **Settings** -> **Tags** -> click **+ New Tag** button
  * Name the tag `critical-infa` -> **Create**
* Tag your Stacks
  * Open the **Stacks** page
  * Find each Stack that you consider critical infrastructure and open the Details page for it
    * Below the Stack title click on the plus (+) button next to **Tags** and add the tag you created above

Nice! Now all your Stacks are tagged, we will use this in the Action created below.

#### 2. Create `Batch Deploy If Changed Except` Action

Create a new Komodo **Action** named `batch-deploy-changed-and-exclude` and copy-paste the contents of the (expanded) block below:

<details markdown="1">

<summary>Batch Deploy If Changed Except Contents</summary>

```ts
// add values to each filter to NOT re-deploy if stack contains X
const REPOS = ARGS.REPOS === undefined ? [] : ARGS.REPOS.split(','); // Stack X Repo 'MyName/MyRepo' includes ANY part of string Y from list
const SERVER_IDS = ARGS.SERVER_IDS === undefined ? [] : ARGS.SERVER_ID.split(','); // Stack X Server '67659da61af880a9d21f25be' matches string Y from list
const TAGS = ARGS.TAGS === undefined ? [] : ARGS.TAGS.split(','); // Stack X Tags A,B,C like 'myCoolTag' matches string Y from list
const STACKS = ARGS.STACKS === undefined ? [] : ARGS.STACKS.split(','); // Stack 'my-cool-stack' matches ANY part of string Y from list
const SERVICES = ARGS.SERVICES === undefined ? [] : ARGS.SERVICES.split(','); // Stack X Service 'my-cool-service' includes ANY part of string Y from list
const IMAGES = ARGS.IMAGES === undefined ? [] : ARGS.IMAGES.split(','); // Stack X Image 'lscr.io/linuxserver/socket-proxy:latest' includes ANY part of string Y from list

// if ARGS.COMMIT is not present and `true` then this action will only "dry run" the changes
// it will log to console what it *would* do but will not actually execute any changes
const commit = ARGS.COMMIT === 'true';

// used for getting common values found in two different lists
const intersect = (a: Array<any>, b: Array<any>) => {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    return Array.from(intersection);
}

// formats stack names nicely in console out
const formatColumns = (arr: string[], numCols: number) => {
  if (!arr || arr.length === 0) return "";

  // Calculate the width of each column (based on longest string in that column)
  const colWidths = Array.from({ length: numCols }, (_, colIndex) => {
    let maxWidth = 0;
    for (let i = colIndex; i < arr.length; i += numCols) {
      if (arr[i].length > maxWidth) maxWidth = arr[i].length;
    }
    return maxWidth;
  });

  // Build the output row by row
  const rows = [];
  for (let i = 0; i < arr.length; i += numCols) {
    const rowItems = arr.slice(i, i + numCols);
    const row = rowItems
      .map((item, colIndex) => item.padEnd(colWidths[colIndex]))
      .join("  "); // 2-space separator between columns
    rows.push(row.trimEnd());
  }

  return rows.join("\n");
}

const availableUpdates = await komodo.read('ListStacks', {});

let userTags: string[] = [];
let tagsList: Types.ListTagsResponse;
if(TAGS.length > 0) {
  tagsList = await komodo.read('ListTags', {});
  userTags = tagsList.filter(x => TAGS.includes(x.name)).map(x => x._id.$oid);
}

const excluded: string[] = [];

const candidates = availableUpdates.filter(x => {
  if(REPOS.length > 0 && REPOS.some(x => x.info.repo.includes(x))) {
      excluded.push(`${x.name} => repo`);
      return false;
  }
  if(SERVER_IDS.length > 0 && SERVER_IDS.includes(x.info.server_id)) {
    excluded.push(`${x.name} => server`);
    return false;
  }
  if(TAGS.length > 0 && intersect(userTags, x.tags).length > 0) {
    const intersectedTags = intersect(userTags, x.tags);
    excluded.push(`${x.name} => tags ${tagsList.filter(x => intersectedTags.includes(x._id.$oid)).map(x => x.name).join(',')}`);
    return false;
  }
  if(STACKS.length > 0 && STACKS.some(y => x.name.includes(y))) {
    excluded.push(`${x.name} => stack`);
    return false;
  }
  if(SERVICES.length > 0) {
    const s = x.info.services.map(x => x.service);
    if(s.some(x => SERVICES.some(y => x.includes(y)))) {
      excluded.push(`${x.name} => service`);
      return false;
    }
  }
  if(IMAGES.length > 0) {
    const s = x.info.services.map(x => x.image);
    if(s.some(x => IMAGES.includes(y => y.includes(s)))) {
      excluded.push(`${x.name} => image`);
      return false;
    }
  }
  return true;
});

if(excluded.length > 0) {
  console.log(`Excluded ${excluded.length} Stacks:\n${formatColumns(excluded, 3)}`);
}

console.log(`\n${commit === false ? '[DRY RUN] ' : ''}Will deploy ${candidates.length} if changed:
${formatColumns(candidates.map(x => x.name), 3)}`);

if(commit) {
  await komodo.execute('BatchDeployStackIfChanged', {pattern: candidates.map(x => x.id).join(',')});
}
```
{: file='Action File'}

</details>

In short, this Action:

* Gets *all* Stacks on *all* Servers in your Komodo instance
* Iterates through each one
  * If the Stack has a property found in one of the lists of variables from the top of the file -- `REPOS`, `SERVER_IDS`, `TAGS`, `STACKS`, `SERVICES,` and `IMAGES` -- then it is **excluded** from the list of Stacks that may be deployed
* At the end, all Stacks that *did not match* one of those properties is used as the target of a `BatchDeployStackIfChanged` API call
  * Only if `ARGS.COMMIT = true`

The top-of-file variables are parsed from **Arguments** which means they not hardcoded and can be passed by other actions/procedures/komodo api calls.

So, this Action gives us a way to `Deploy Stack If Changed` where we can exclude all of our Stacks tagged with `critical-infra`.

> This action is generic! We are using it in this scenario only for excluding by tags but you can use it for *anything* by using the other Arguments/Variables defined at the top.
> 
> EX You could also make a duplicate of the Action and change the api call executed from `BatchDeployStackIfChanged` to `StartAllContainers` to try to start all containers after restarting a server, but exclude ones with heavy IO.
{: .prompt-tip}

#### 3. Create Procedure to Batch Deploy and Exclude Critical Infra

If you already created a [Batch Deploy Procedure using Nick's guide](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo#create-a-procedure-in-komodo) you should modify it to match this one, now.

Create a new Komodo **Procedure** named **Update On PR Merge** and add a new Stage, specifying the Action we just created `batch-deploy-changed-and-exclude`, with args for our critical infrastructure tag: `{ "TAGS": "critical-infra" }`

![pr merge procedure](assets/img/renovate/procedure.png)

**Save** the Procedure.

> This could technically be achieved from our Forgejo Webhook Action by directly executing the `batch-deploy-changed-and-exclude` action with `komodo.execute` but I prefer to use a Procedure as it lets you easily expand/modify the behavior later to include other Stages/Actions.
{: .prompt-info}

#### 4. Create Forgejo-Webhook-Filtering Komodo Action

Create a new Komodo **Action** named `Renovate Git Commit` and copy-paste the contents of the (expanded) block below:

<details markdown="1">

<summary>Batch Deploy If Changed Except Contents</summary>

```ts
// ARGS
// RENOVATE_USER => username of the renovate bot
// BASE_BRANCH => branch being merged into
// PROCEDURE_ID => id of procedure to trigger
// COMMIT => bool, whether to trigger procedure

const body = ARGS.WEBHOOK_BODY;
const commit = ARGS.COMMIT === 'true';

const {
  commits = []
} = body;

if(commits.length > 0) {
  const {
    ref,
  } = body;

  if(ARGS.RENOVATE_USER === undefined) {
    throw new Error('RENOVATE_USER arg must be defined!');
  }

  if(ARGS.BASE_BRANCH !== undefined) {
    if(!ref.includes(ARGS.BASE_BRANCH)) {
      console.log(`Base Branch wanted '${ARGS.BASE_BRANCH} but found ${ref}, ignoring this webhook event.'`);
      return;
    }
  } else {
    console.log('No Base Branch check required.');
  }

  const renovateCommits = commits.filter(x => {
    const {
      author: {
        username: authorUser
      } = {},
      committer: {
        username: commitUser
      } = {}
    } = x;
    return authorUser === ARGS.RENOVATE_USER || commitUser === ARGS.RENOVATE_USER;
  });

  if(renovateCommits.length === 0) {
    console.log(`No commits by username ${ARGS.RENOVATE_USER}`);
    return;
  }

  console.log(`Found ${renovateCommits.length} by username ${ARGS.RENOVATE_USER}:\n${renovateCommits.map(x => x.message).join('\n')}`);

  const pid = ARGS.PROCEDURE_ID;
  console.log(`${commit === false ? '[DRY RUN] ' : ''} Triggering procedure ${pid}`);
  if(undefined === pid) {
    throw new Error('Cannot trigger procedure because no ID was provided as arg PROCEDURE_ID');
  }
  if(commit) {
    komodo.execute('RunProcedure', {procedure: pid});
  }
}
```
{: file='Action File'}

</details>


This Action:

* Recieves a Forgejo Webhook event and parses the body
* If it's a commit event (checks for `commits`)...
  * Checks that at least one commit was made by the Renovate Bot
  * and optionally checks it was committed to a specific branch (like `main`)
* If all conditions are met and `ARGS.COMMIT === 'true'` then it executes a procedure based on passed argument value

So, this Action filters all Forgejo Webhooks sent to it and only triggers a procedure if it contains a commit made by our Renovate Bot user.

The top-of-file variables are parsed from **Arguments** which means they not hardcoded and can be passed by other actions/procedures/komodo api calls. However, you *should* set **Default Arguments** in this Action as it will be triggered directly by Forgejo (which cannot specifically pass Komodo Arguments). Under the Action File section, add/modify this contents to Arguments:

```
PROCEDURE_ID=69d54b1d82f3ae56abf97d88 # the procedure ID from step 3, get it from the procedure's page URL
RENOVATE_USER=renovate-bot # the username of the renovate bot on your forgejo instance
#BASE_BRANCH=main # uncomment this and specify branch to trigger only if commits are in this branch
COMMIT=true
```
{: file='Arguments'}

Make sure **Key Value** type is set from the Argument dropdown.

Finally, we need to add this Action's webhook to Forgejo. This is the same step as in [Nick's guide](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo#create-a-procedure-in-komodo):

* At the bottom of the Action File...
  * Enable **Webhook Enabled** and **Save**
  * Copy the **Webhook URL - Run** value
    * Make sure you know your Webhook Secret value as well
* Open your Forgejo Repo -> Settings -> Webhooks
  * Add new Webhook as *Gitea* style, use the URL value from above and add Komodo secret
  * Enable for Custom Events...
    * Check box for **Push**

#### Summary

Hooray! You've done it. To summarize the chain of events, now:

* Renovate Bot makes a PR to your repo
* You commit/merge the PR
* Forgejo triggers the webhook because of the Push event
  * This sends the commit event payload in the request to Komodo
* Komodo Action `Renovate Git Commit` recieves the webhook body
  * Checks that the at least one commit came from Renovate Bot and is to the right branch
  * Executes Procedure from Step 3
* Komodo Procedure executes `batch-deploy-changed-and-exclude` Action with arguments for `critical-infra` tag
  * Komodo runs **Batch Deploy Stack If Changed** on all Stacks except those with the `critical-infra` tag

So, we now:

* avoid spamming Komodo Action webhook with any/all push/pr actions from our repo
* only re-deploy changed Stacks that don't include the Stacks we potentially need to make the deployments happen in the first place

## Reducing Renovate PR Noise

Nick's guide [provides a good starting point](https://nickcunningh.am/blog/how-to-automate-version-updates-for-your-self-hosted-docker-containers-with-gitea-renovate-and-komodo#configure-renovate-in-the-repo) for renovate config by showing that some packages can be ignored or clamped based on version matching. However, any further config it left up to the reader. While his example is a good starting point the config as described is not sufficient to make good use of renovate bot for a non-trivial lab, like once you get past 20 stacks.

### The Problem

#### No Project Context

The default PR/commit title template for Renovate only tells you the *image* that is being updated and to what version. This is fine when Renovate is being used in a single-project setting where there is maybe only one `compose.yaml` stack with a few images, but in the homelab monorepo where there can be many dozens of stack files this is not helpful at a glance:

![no stack context](assets/img/renovate/nocontext.png)
_What stack do each of these images belong to? What folder? Which project?_

To get this context you need to 1) open the PR page and 2) switch to the Files Changed view. This is too many steps when you just want an at-a-glance view or are reviewing many opened PRs.

#### No Version Bump Context

The above screenshot reveals another issue. *What kind of update is this?* Minor? Major? Patch bump? The PR details page does describe this, but that means opening every single PR. Not useful for skimming new PRs to see what needs to be triaged.

#### Updates for Common Dependencies Pinned by Project

Though some projects do a [good job](https://github.com/immich-app/immich/blob/f909648bce8cf181512f388072abb6d1141f8a23/docker/docker-compose.yml#L52) of pinning their dependencies to specific digests or patch versions, most do not. You'll often find projects that only specify a major version like `postgres:14` or `redis:8`.

Usually, it's inferred by these projects that this version must stay the same. Even if the dependency can be updated to the next major version with breaking compatibility, the project may still depend on the version in their compose.yaml stack for some specific behavior.

Additionally, many projects in the selfhosted community use the *same, known, common dependencies* in this style. Dependencies like databases, cache, and queues are common in projects found in the homelab. With the Renovate config given in Nick's guide, all of these dependencies get PRs to bump major/minor versions when we really do not want them. It adds a ton of noise and alarm fatigue to have to constantly close these.

### The Solution

#### Better PR Titles and Labels

First, in your repo create new labels for the different type of version updates, like this:

![repo labels](assets/img/renovate/labels.png)
_Version Update type labels added to the repo for PRs/Issues_

Next, in your `renovate.json` add to the `docker-compose` object:

{% raw %}
```json
"prBodyNotes": [
  "Updates for stacks in `{{packageFileDir}}`."
]
```
{: file='docker-compose in renovate.json'}
{% endraw %}

and in the `docker-compose.packageRules` list **at the beginning** at the following entry:

{% raw %}
```json
{
  "matchPackageNames": [
    "/.*/"
  ],
  "addLabels": [
    "{{updateType}}"
  ],
  "commitMessageExtra": "in stack {{packageFileDir}} from {{currentVersion}} to {{#if isPinDigest}}{{{newDigestShort}}}{{else}}{{#if isMajor}}{{prettyNewMajor}}{{else}}{{#if isSingleVersion}}{{prettyNewVersion}}{{else}}{{#if newValue}}{{{newValue}}}{{else}}{{{newDigestShort}}}{{/if}}{{/if}}{{/if}}{{/if}}",
  "enabled": true
}
```
{: file='docker-compose.packageRules in renovate.json'}
{% endraw %}

This will modify PR titles, add labels new PRs, and include a searchable folder name in the PR body:

![PRs with labels](assets/img/renovate/context.png)
_PRs specify where compose file is located, from version, and version label_

The `commitMessageExtra` property modifies our PRs titles so that they include

* the folder path to the `compose.yaml` where the image is located (`in stacks stack/karakeep`)
* the current version of the image immediately proceeding the proposed version update (`from 1.6.2 to 1.42.1`)

and `addLabels` makes Renovate add a label with the version update type (`minor`). If you chose distinctive colors then it is now easy to see at a glance what type of version update is being proposed.

#### Disable Updates for Common Dependencies

To fix [PR noise from common dependencies](#updates-for-common-dependencies-pinned-by-project) we can disable updates types based on package regex patterns. Add these two entries **at the end** of your `docker-compose.packageRules` list:

```json
{
  "description": "Common images that may have breaking changes between any non-patch versions (will only open patch PRs)",
  "matchPackageNames": [
    "/influxdb/",
    "/mysql/",
    "/mongo/",
    "/elasticsearch/",
    "/keydb/",
    "/rabbitmq/",
    "/mariadb/",
    "/etcd/"
  ],
  "matchUpdateTypes": [
    "major",
    "minor"
  ],
  "enabled": false
}
```
{: file='docker-compose.packageRules in renovate.json'}

```json
{
  "description": "Common images that may have breaking changes between major versions (will only open patch/minor PRs)",
  "matchPackageNames": [
    "/couchdb/",
    "/redis/",
    "/valkey/",
    "/postgres/",
    "/postgis/",
    "/pgadmin/",
    "/clickhouse/",
    "/grafana/"
  ],
  "matchUpdateTypes": [
    "major"
  ],
  "enabled": false
}
```
{: file='docker-compose.packageRules in renovate.json'}

This will ensure that PRs are only opened for these images if the version update is both backwards compatible and unlikely to break the main service's usage of the dependency. I assigned these by going to each dependency's website and verifying their version update policy, or defaulting to patch-only if no policy was found.

> If you have specific versions of any of these you want to override per project then add another entry to `packageRules` **after** the above entries and use either [`matchPackageNames`](https://docs.renovatebot.com/configuration-options/#packagerulesmatchpackagenames) or [`matchFileNames`](https://docs.renovatebot.com/configuration-options/#packagerulesmatchfilenames) to match your specific scenario.
{: .prompt-tip}

#### (Optional) More Noise Reducton

To further reduce PR noise you can add these other options to `renovate.json`:

##### Major Dependency Approval

Make sure [Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/) is enabled at the top-level of your `renovate.json`

Use [`dependencyDashboardApproval`](https://docs.renovatebot.com/key-concepts/dashboard/#require-approval-for-major-updates) to redirect all major version bumps to the dependency dashboard. This will make Renovate list the update in the dashboard *first*, where you can then enable it via checkbox to have Renovate create the PR for it the next time it is run. Add to `docker-compose` object:

```json
"major": {
  "dependencyDashboardApproval": true
}
```
{: file='renovate.json'}

##### Minimum Release Age

Use [`minimumReleaseAge`](https://docs.renovatebot.com/configuration-options/#minimumreleaseage) to also redirect PRs to the Dependency Dashboard. Setting a time value for this option means that all *unique* version updates that would become PRs are instead added to the Dashboard if the *last* digest update for that version is newer than Time X.

EX `"minimumReleaseAge": "4 day"` means if the digest for `redis:9` was created less than 4 days ago then PR will be opened and instead it will be shown on the Dashboard as a Pending Update.

Add to the top-level:

```json
"minimumReleaseAge": "4 day"
```
{: file='renovate.json'}

##### Alpine Preset

Add [`workarounds:doNotUpgradeFromAlpineStableToEdge`](https://docs.renovatebot.com/presets-workarounds/#workaroundsdonotupgradefromalpinestabletoedge) to the `renovate.json` `extends` list to prevent PRs that try to upgrade alpine images.

## (Optional) Reducing Registry API Calls with Caching

If you have a *very large* homelab, say 50+ stacks or 70+ images total, you may want to consider adding a caching layer between Renovate and upstream registries.

Dockerhub already has pretty restrictive rate limiting and quotas per day. Using a caching layer, especially if you end up pinning many images to digests, can help speed up Renovate's duration and drastically reduce calls to the registry and avoid rate limiting. This is especially useful when first creating your renovate config as you may be invoking Renovate many times to observe created PRs and iterating on your config.

> If you don't want to go to the trouble of caching during initial renovate config iteration/setup then I would suggest creating a *testing* repository to have Renovate run on. Include only a few stacks with all the image update scenarios you want to detect and use that to iterate on config building, rather than using your entire homelab monorepo as the testing grounds.
{: .prompt-tip}

When Renovate is fetching updates it is making plain HTTP/S calls to the upstream registries[^no-docker-daemon-proxy] so we will use [CNCF's `distribution`](https://distribution.github.io/distribution/) image as a [pull through cache](https://distribution.github.io/distribution/recipes/mirror) in order to cache image manifest information from [each upstream registry](https://distribution.github.io/distribution/recipes/mirror/#gotcha) we want to cache for.

[^no-docker-daemon-proxy]: IE It will not use the Docker Daemon API so we can't use existing docker registry proxies transparently, unfortunately.

In this example I am using `distribution` as a cache for Dockerhub and setting up the container behind Traefik as the reverse proxy. In a docker compose stack:

```yaml
services:
  dockerio-distribution-mirror:
    image: distribution/distribution:latest
    networks:
      - traefik_overlay
      - default
    volumes:
      # file store for cached data
      - ./distribution-proxy/registries/dockerio:/var/lib/registry    
    labels:
      traefik.enable: true
      # URL to be used for dockerhub registry mirror
      traefik.http.routers.distribution-docker.rule: Host(`registry-docker.example.com`)
      traefik.http.services.distribution-docker.loadbalancer.server.port: 5000
      traefik.docker.network: traefik_overlay
    environment:
      REGISTRY_PROXY_REMOTEURL: https://registry-1.docker.io # the upstream registry to cache
      REGISTRY_PROXY_USERNAME: foxxmd
      REGISTRY_PROXY_PASSWORD: ${DOCKERHUB_PASSWORD}
      REGISTRY_PROXY_TTL: 12h # how long to cache manifests for
      REGISTRY_TAGS_MAXTAGS: 10000 # REQUIRED for use with renovatebot

      # valkey service and config below is optional
      REGISTRY_REDIS_ADDRS: "[distribution-valkey:6379]"
      REGISTRY_STORAGE_DELETE_ENABLED: true
      REGISTRY_STORAGE_CACHE_BLOBDESCRIPTOR: redis
  distribution-valkey:
    image: valkey/valkey:9.0.3
    networks:
      - default
    volumes:
      - ./distribution-proxy/redis:/data
```      

Next, in `renovate.json` we add [`registryAliases`](https://docs.renovatebot.com/configuration-options/#registryaliases) to `docker-compose` to tell Renovate that when it sees the `docker.io` registry in an image it should instead use our mirror:

```json
"registryAliases": {
  "index.docker.io": "registry-docker.example.com",
  "docker.io": "registry-docker.example.com"
}
```
{: file='docker-compose in renovate.json'}

EX: For `image: docker.io/library/redis:7` it should instead use `registry-docker.example.com/library.redis:7`

Finally, we give an explicit hint to Renovate what the default registry is by configuring [`registryUrls`](https://docs.renovatebot.com/configuration-options/#registryurls). Without this config Renovate will still try to use `docker.io/...` when no registry prefix is present.[^registryAliasExplicit]

[^registryAliasExplicit]: The `registryAliases` config above only tells it what to do when the prefix is *explicitly* in the image.

Add to **the beginning** of `packageRules`:

```json
{
  "matchDatasources": ["docker"],
  "registryUrls": [
    "https://registry-docker.example.com"
    ]
}
```
{: file='docker-compose.packageRules in renovate.json'}

> To cache for more registries you will need to:
>
> * Add an additional compose service for each registry
> * Add a new mapping to `registryAliases`
{: .prompt-tip}

## Extras

### Unlimited PRs

![Unlimited Power](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExdXpqZ2dmeTA2Nm5ueHQ4a3Vpd3F3N2JpODQ2Y2R4bXlmZXFzaWVvciZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/hokMyu1PAKfJK/giphy-downsized.gif){: height="100" }

To get Renovate to open all valid PRs (PRs not filtered by things like [major updates](#major-dependency-approval) or [minimum age](#minimum-release-age)) you need to add both `prHourlyLimit` *and* `prConcurrentLimit` to `renovate.json`:

```json
"prHourlyLimit": 0,
"prConcurrentLimit": 0
```
{: file='top-level in renovate.json'}

### Uncommon Version Pattern Detection

Add the [`workarounds:bitnamiDockerImageVersioning`](https://docs.renovatebot.com/presets-workarounds/#workaroundsbitnamidockerimageversioning) preset to `extends` to help with versioning for bitnami images.

[bpbradley](https://github.com/bpbradley) contributed this extremely useful version detection for [linuxserver.io](https://www.linuxserver.io/) images. Add to `packageRules`:

```json
{
  "description": "Linuxserver tag parsing",
  "versioning": "regex:^(?<compatibility>.*?)-(?<major>v?\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)[\\.-]*r?(?<build>\\d+)*-*r?(?<release>\\w+)*",
  "matchPackageNames": [
    "/^(ghcr.io\\/linuxserver\\/|lscr.io\\/linuxserver\\/).*/"
  ]
}
```
{: file='docker-compose.packageRules in renovate.json'}

### Full Renovate Config

This is the *full* `renovate.json` config I am using on my Komodo monorepo. It includes everything discussed in this post.

**You will need to modify it for your repository before use** (things like `assignee` and updating/removing the [cache rules](#optional-reducing-registry-api-calls-with-caching)) but it can be used as a reference point.

<details markdown="1">

<summary>renovate.json</summary>

{% raw %}
```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "config:recommended",
    "workarounds:bitnamiDockerImageVersioning",
    "workarounds:doNotUpgradeFromAlpineStableToEdge"
  ],
  "dependencyDashboard": true,
  "dependencyDashboardTitle": "Renovate Dashboard",
  "assignees": [
    "foxxmd"
  ],
  "labels": [
    "renovate"
  ],
  "configMigration": true,
  "prHourlyLimit": 0,
  "prConcurrentLimit": 0,
  "minimumReleaseAge": "4 day",
  "docker-compose": {
    "major": {
      "dependencyDashboardApproval": true
    },
    "pinDigests": true,
    "vulnerabilityAlerts": {
      "addLabels": [
        "security"
      ]
    },
    "hostRules": [
      { "matchHost": "docker.io", "concurrentRequestLimit": 2 },
      { "matchHost": "ghcr.io", "concurrentRequestLimit": 2 },
      { "matchHost": "gcr.io", "concurrentRequestLimit": 2 },
      { "matchHost": "lscr.io", "concurrentRequestLimit": 2 }
    ],
    "prBodyNotes": [
      "Updates for stacks in `{{packageFileDir}}`."
    ],
    "registryAliases": {
      "index.docker.io": "registry-docker.example.com",
      "docker.io": "registry-docker.example.com"
    },
    "packageRules": [
      {
        "matchDatasources": ["docker"],
        "registryUrls": [
          "https://registry-docker.example.com"
          ]
      },
      {
        "matchPackageNames": [
          "/.*/"
        ],
        "addLabels": [
          "{{updateType}}"
        ],
        "commitMessageExtra": "in stack {{packageFileDir}} from {{currentVersion}} to {{#if isPinDigest}}{{{newDigestShort}}}{{else}}{{#if isMajor}}{{prettyNewMajor}}{{else}}{{#if isSingleVersion}}{{prettyNewVersion}}{{else}}{{#if newValue}}{{{newValue}}}{{else}}{{{newDigestShort}}}{{/if}}{{/if}}{{/if}}{{/if}}",
        "enabled": true
      },
      {
        "description": "Common images that may have breaking changes between any non-patch versions (will only open patch PRs)",
        "matchPackageNames": [
          "/influxdb/",
          "/mysql/",
          "/mongo/",
          "/elasticsearch/",
          "/keydb/",
          "/rabbitmq/",
          "/mariadb/",
          "/etcd/"
        ],
        "matchUpdateTypes": [
          "major",
          "minor"
        ],
        "enabled": false
      },
      {
        "description": "Common images that may have breaking changes between major versions (will only open patch/minor PRs)",
        "matchPackageNames": [
          "/couchdb/",
          "/redis/",
          "/valkey/",
          "/postgres/",
          "/postgis/",
          "/pgadmin/",
          "/clickhouse/",
          "/grafana/"
        ],
        "matchUpdateTypes": [
          "major"
        ],
        "enabled": false
      },
      {
        "description": "Linuxserver tag parsing",
        "versioning": "regex:^(?<compatibility>.*?)-(?<major>v?\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)[\\.-]*r?(?<build>\\d+)*-*r?(?<release>\\w+)*",
        "matchPackageNames": [
          "/^(ghcr.io\\/linuxserver\\/|lscr.io\\/linuxserver\\/).*/"
        ]
      }
    ]
  }
}
```
{% endraw %}

</details>

___

## Footnotes
