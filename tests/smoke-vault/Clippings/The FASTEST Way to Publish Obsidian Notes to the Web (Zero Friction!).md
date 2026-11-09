---
title: "The FASTEST Way to Publish Obsidian Notes to the Web (Zero Friction!)"
source: "https://www.youtube.com/watch?v=4t3J8m7Z_jE"
author:
  - "[[Paul O'Malley]]"
published: 2026-03-08
created: 2026-11-08
description: "Stop wasting time copying your Obsidian notes into Google Docs or messing around with complex Git repositories just to share a single page.In this tutorial, we’re looking at JotBird—a revolutionary"
tags:
  - "clippings"
---
![](https://www.youtube.com/watch?v=4t3J8m7Z_jE)

Stop wasting time copying your Obsidian notes into Google Docs or messing around with complex Git repositories just to share a single page.  
  
In this tutorial, we’re looking at JotBird—a revolutionary "zero-friction" web publishing service and Obsidian plugin created by Matt Cone. Whether you need to shoot a quick script to a client, share meeting minutes with your team, or send a draft to a friend, JotBird turns any note into a live, shareable URL in literally seconds.  
  
⌚ Timestamps:  
0:00 - Why publishing Obsidian notes is usually tedious  
0:46 - What is JotBird? (Zero-friction web publishing)  
1:14 - Initial Setup: Installing via the BRAT plugin  
2:23 - How to add the JotBird GitHub repository path  
3:10 - The Workflow: 3 ways to publish instantly  
5:03 - Managing links & "Magic" Front Matter properties  
6:29 - Automatic Image Hosting (No more broken links!)  
7:38 - Advanced Formatting: Callouts, Mermaid diagrams, and LaTeX  
8:40 - Ephemeral Sharing: Privacy, expiration, and pricing  
9:54 - Summary and Outro  
  
Links & Resources Mentioned:  
JotBird Website: https://www.jotbird.com/obsidian  
BRAT Repository Path: jotbirdhq/obsidian-jotbird  
Markdown Guide by Matt Cone: https://www.markdownguide.org/  
  
If you found this helpful, please give the video a thumbs up and subscribe for more Obsidian tips and productivity workflows!  
  
#Obsidian #JotBird #Productivity #PKM #SecondBrain #NoteTaking #Markdown #ObsidianPlugins #WorkflowAutomation  
Music from #Uppbeat  
https://uppbeat.io/t/wooll/summerend-w-kainbeats

## Transcript

### Why publishing Obsidian notes is usually tedious

**0:02** · Welcome to this brief guide on how to publish Obsidian Notes to the web using JotBird.

**0:12** · Have you ever wanted to share just one specific Obsidian note with someone right now, but stopped because the process was just too tedious?

**0:21** · Setting up a full blog, messing around with git repositories, or paying for a heavy web hosting service just to share the meeting minutes can be incredibly frustrating.

**0:31** · Or worse, you end up just opening up a Google Doc and simply copying and pasting your note over in order to share it from there.

**0:38** · Which, let's be honest, means you may as well have not used Obsidian at all at that point.

**0:44** · Well, today we're looking at JotBird.

### What is JotBird? (Zero-friction web publishing)

**0:47** · JotBird is a zero-friction web publishing service and Obsidian plugin created by Matt Cone, the author of the authoritative Markdown Guide.

**0:57** · It operates on a really unique premise - disposable instant web pages.

**1:03** · In this tutorial, I'm going to show you exactly how to bypass all that messy setup and turn any note into a live, shareable URL in literally seconds.

**1:13** · Let's dive in.

### Initial Setup: Installing via the BRAT plugin

**1:16** · Before we get to the magic of one-click publishing, we do need to do a tiny bit of setup.

**1:22** · So while the barrier to entry for hosting your notes is absolutely zero, JotBird is incredibly new.

**1:29** · So at the time of recording this, it has only just been submitted to the Obsidian Community plugin directory and is currently waiting in the queue to be officially vetted.

**1:39** · Because of this, until it gets the official green light, we need to install it using a fantastic tool called BRAT.

**1:46** · That stands for the Beta Reviewer's Auto-Update Tool.

**1:51** · If you haven't used it before, it's essentially a backdoor that allows you to install and automatically update plugins directly from GitHub before they hit the main store.

**2:02** · If you don't already have BRAT installed, simply head over to your Obsidian settings, click on Community Plugins and search for BRAT.

**2:12** · Go ahead and hit install, and make sure that you enable it once it's done.

**2:19** · Once you've got BRAT running, scroll down your settings sidebar and open up the BRAT menu.

### How to add the JotBird GitHub repository path

**2:25** · Right here at the top, you'll see a button that says Add Beta Plug-in.

**2:29** · Click that and a small dialog box will pop up.

**2:33** · All you need to do is paste in the JotBird GitHub repository path, which is JotBirdhq/obsidian-JotBird.

**2:42** · I'll have that in the description for you to copy and paste to make it easier.

**2:47** · Hit add and BRAT will pull the plugin directly from GitHub, install it and keep it updated automatically for you.

**2:55** · Once JotBird is officially approved in the store, you won't need to do this step, but for now it's a very quick and painless workaround.

**3:05** · Right, now that we have JotBird installed and enabled, let's look at the actual workflow.

### The Workflow: 3 ways to publish instantly

**3:11** · The absolute best part about this tool is that you don't even need an account to start using it.

**3:16** · There's no sign up screen, no email verification, it just integrates directly into your native Obsidian interface.

**3:25** · When you want to publish a note, JotBird gives you three different ways to do it, depending on how you like to work.

**3:32** · So for those of us who like using the mouse, you'll notice a brand new dedicated bird icon sitting right over here in your left ribbon.

**3:41** · Just click that and give it a couple of seconds and your note is instantly live on the web.

**3:47** · If you prefer to keep your hands on the keyboard, you can open up your command palette and type in "publish current note" and hit enter.

**3:56** · Or alternatively, you can right click on any file and select the publish option straight from the context menu.

**4:04** · It is honestly brilliant.

**4:06** · It completely replaces that tedious old workflow of copying everything, opening up a browser, creating a new Google doc, pasting it all in and then hopefully being able to quickly fix the broken formatting.

**4:19** · This is incredibly handy if you just need to shoot a quick script over to a client for review, share ad hoc meeting minutes with your team, or just send a quick draft to a friend.

**4:31** · Now let's talk about what actually happens under the hood when you click that publish button.

**4:36** · JotBird immediately copies the live link straight to your clipboard so that you can paste it into a message, but it also does something very clever.

**4:46** · It writes data back into your notes front matter.

**4:50** · If you look right up here in the files properties, you'll see that JotBird has automatically injected two new fields.

**4:58** · You have the live URL and the specific date that the link will expire.

### Managing links & "Magic" Front Matter properties

**5:03** · But here is where the UI gets truly brilliant.

**5:07** · Right next to the JotBird link property, you'll see that there are three little interactive buttons.

**5:13** · The first one looks like a cloud with an arrow pointing into it.

**5:17** · Let's say that you just shared a note, but then you immediately spot a typo or you need to add an extra quick paragraph.

**5:25** · Instead of pulling the page down and generating a whole new link, you just make your changes in Obsidian, come up here and click this cloud button.

**5:34** · It pushes your local changes straight to the existing live page immediately.

**5:40** · The second button is a little clipboard icon just in case you need to copy the URL again.

**5:46** · And the third button is the trash can.

**5:49** · If you want to pull a page down manually before it expires, simply click this.

**5:54** · You'll get a quick confirmation dialog box to make sure that you didn't click it by accident.

**5:59** · But once you hit confirm, JotBird unpublishes the page from the web, and this is my favorite part, it automatically cleans up and removes those properties from your Obsidian front matter.

**6:10** · You never end up with any leftover junk data clogging up your files, which works exceptionally well if you're building out a Dataview dashboard or an Obsidian Base to track all of your active shared links.

**6:26** · Now, if you've ever tried copying and pasting markdown files into other tools or platforms, you know that the text usually survives, but the images always break.

### Automatic Image Hosting (No more broken links!)

**6:36** · This is because Obsidian points to local files that are on your hard drive, which the web obviously can't see.

**6:43** · JotBird solves this major headache by automatically handling all of the image hosting for you.

**6:49** · Let's look at the demo note that I'm publishing here today.

**6:52** · If we scroll down to the bottom, right below my diagrams, I've embedded a local image of Master Chief from Halo Infinite.

**7:00** · This is a game that I have very casually sunk well over 1200 hours into, so please don't judge me too harshly.

**7:07** · But when you publish this note, JotBird scans your file, finds any local images, like Master Chief here, and automatically uploads them to JotBird servers in the background.

**7:18** · There is absolutely no need to configure messy Imgur API links or set up complicated Amazon S3 buckets.

**7:26** · Whether you are sharing a massive step-by-step tutorial filled with software screenshots or just showing off your favorite Spartan, JotBird ensures the final web page looks exactly like your Obsidian note.

### Advanced Formatting: Callouts, Mermaid diagrams, and LaTeX

**7:40** · Because Matt Cone, the creator of JotBird, is also the author of the authoritative Markdown Guide, he understands how this syntax works at a fundamental level.

**7:50** · As a result, JotBird handles the more complex Obsidian-specific parts of your notes beautifully.

**7:57** · Take a look at this demo content.

**7:59** · If you use standard Obsidian callouts for information blocks or warnings, they don't just appear as plain text online.

**8:07** · They render with their appropriate colorful styling and icons.

**8:12** · It also has native support for mermaid diagrams.

**8:15** · So if you've mapped out complex flowcharts or sequence diagrams, they work right out of the box.

**8:22** · It even supports full MathJax and Latex rendering, meaning complex scientific or mathematical equations will display perfectly formatted.

**8:32** · If you're sharing academic notes, technical documentation, or coding snippets with colleagues, you don't have to compromise on your formatting at all.

### Ephemeral Sharing: Privacy, expiration, and pricing

**8:42** · And finally, let's talk about permanence and pricing, because JotBird takes a slightly different approach here.

**8:50** · Their model is built around the idea of ephemeral sharing.

**8:54** · By default, your links will eventually expire.

**8:57** · This is actually a fantastic feature for privacy and for reducing digital rot, meaning you don't leave a trail of sensitive or outdated notes floating around the internet forever.

**9:08** · If you use the plugin completely anonymously as a guest, which costs $0, your links and hosted images will expire after 30 days.

**9:18** · If you do want a bit more control though, you can sign up for a free account.

**9:23** · This still costs $0, but it gives you a browser dashboard to manage your shared links, cross-device syncing, and bumps your link expiration up to 90 days.

**9:33** · If you decide you want to use JotBird for permanent documentation, a portfolio, or a lightweight blog where links never die, you can upgrade to the pro account for $29 a year.

**9:44** · It's a really flexible, fair model that scales depending on whether you just want to share a temporary code snippet or host something for the long term.

### Summary and Outro

**9:54** · And there you have it!

**9:56** · JotBird is essentially the fastest, lowest friction way to get an Obsidian note onto the web.

**10:02** · With automatic image hosting, rich formatting support, and intelligent front matter tracking, it handles all of the heavy lifting for you.

**10:10** · I highly encourage you to go grab the guest tier for free, try publishing a note, and see how clean the default theme looks on mobile.

**10:18** · You can find the JotBird link in the description below.

**10:22** · So happy note sharing, and I'll catch you in my next video.

**10:29** · Thanks for watching!

**10:30** · If you'd like to see more content like this, be sure to check out the channel.

**10:34** · And if you like what you see, don't forget to hit that subscribe button.