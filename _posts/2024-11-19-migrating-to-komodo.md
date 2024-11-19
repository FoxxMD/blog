---
title: Migrating To Komodo
description: >-
  Moving from Dockge to Komodo and how to think like a lizard
author: FoxxMD
date: 2024-11-19 12:00:00 -0400
categories: [Tutorial]
tags: [docker, compose, dockge, portainer, komodo, git]
pin: false
---

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