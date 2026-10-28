# Cookie Sessions — Firebase Hosting Edition

This edition follows the public hosting model used by Wheel of Names: **a static web interface on Firebase Hosting** with **Google Cloud Firestore** for real-time storage. The chocolate-chip cookie wheel is drawn **inside the page** by the original Wheel of Names renderer (vendored under its Apache 2.0 license) with the original cover artwork. There is no iframe and no call to wheelofnames.com at runtime. Community members submit their own songs from the public page, one per person, and the wheel draws from host-added and community songs alike.

## What is (and isn't) self-contained

- **The voting site UI and logic** live in `public/index.html`. The wheel is `public/cookie-wheel.mjs` plus the vendored renderer in `public/vendor/wheel-of-names/`; the artwork and the saved wheel settings are in `public/assets/`. No build step.
- **One server-side piece:** the `discordLogin` Cloud Function in `functions/` (Node 22, `europe-west1`). It trades a Discord OAuth code for a Firebase custom token, and only for members of the community's Discord server. Cloud Functions require the Firebase **Blaze** plan.
- `firebase.json` and `firestore.rules` are deployment and access-control configuration, not running code.
- Firebase Hosting, Authentication, and Firestore are **managed online services that you must configure**. Distributed voting with immediate shared results cannot be provided by a standalone offline HTML file.
- Hosting under `your-project.web.app` is possible; you **cannot** deploy to `wheelofnames.com` without being its operator.

## One-time setup

A click-by-click version for non-technical users is in `DEPLOY-GUIDE.md`.

1. Create a Firebase project and register a **Web app**. Nothing to paste: Firebase Hosting serves the app's settings at `/__/firebase/init.json`, which the page loads at startup, so no project key is kept in the repository (the page therefore only works from Hosting or the Firebase emulator, not from a plain local web server). Create a Firestore database in a region of your choice. Upgrade the project to **Blaze** and set a budget alert.
2. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application. Under **OAuth2**, copy the Client ID, reset and copy the Client Secret, and add the redirects `https://<project-id>.web.app/` and `https://<project-id>.firebaseapp.com/` (trailing slash included; the page uses `location.origin + location.pathname`).
3. Put the Client ID in `DISCORD_CLIENT_ID` in `public/index.html`. Put the hosts' Discord user ids in `HOST_UIDS` there **and** in `isHost()` in `firestore.rules`; the rules, not client JavaScript, enforce host privileges.
4. Copy `functions/.env.example` to `functions/.env` and fill `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` (the server id). Store the secret with `firebase functions:secrets:set DISCORD_CLIENT_SECRET`.
5. Deploy:

   ```bash
   npm --prefix functions install
   firebase deploy --only hosting,firestore:rules,functions
   ```

6. Once: enable the **IAM Service Account Credentials API** and give the function's runtime account (the default compute service account, `<project-number>-compute@developer.gserviceaccount.com`) the **Service Account Token Creator** role, so `createCustomToken` can sign. Without it the login fails with `iam.serviceAccounts.signBlob` denied.
7. Disable the **Anonymous** and **Email/Password** providers in Authentication; nothing uses them and the rules refuse them.

## Login with Discord

- Nothing is visible before login: the page shows only a **Log in with Discord** card.
- The button sends the browser to Discord's authorize page (`scope=identify guilds.members.read`, `prompt=none`, and a random `state` kept in `sessionStorage`). Discord returns to the page with `?code&state`; the page removes them from the address bar at once, checks `state`, and calls `discordLogin` with the code.
- `discordLogin` (`functions/index.js`, Discord calls in `functions/discord.js`) exchanges the code, reads `/users/@me` and `/users/@me/guilds/{DISCORD_GUILD_ID}/member`, refuses non-members (404) with a friendly message, and returns `createCustomToken(discordUserId, {member: true, discordName})`. `discordName` is the server nickname, else the global display name, else the username, cut to 32 characters. The Discord access token is used only inside that call.
- The page signs in with `signInWithCustomToken`. The Firebase uid **is the Discord user id**, so hosts are listed by Discord id. Sessions from older versions (anonymous or email) have no `member` claim and are signed out.
- The rules' `isSignedIn()` requires `sign_in_provider == 'custom'` and `member == true`, and every ballot and submission must carry `nickname == request.auth.token.discordName`, so names cannot be typed in or faked.
- Membership is checked at login. A member who leaves the server keeps their session until they log out or a host deletes their user under Authentication → Users.

## Host area, pre-listening, wheel looks, MozartAI covers

- **Host area.** Three tabs follow the evening: *Prepare* (name, wheel look, submissions switch, adding songs, the song list with pre-listening), *Live show* (what to do next, Spin / Close voting, the manual-confirm fallback folded away), *Wrap up* (finish, download CSV, start the next evening, past evenings). The matching tab opens when `night.phase` changes; hosts can switch freely in between. The status line above the tabs is always visible.
- **Pre-listening and notes.** **▶ Listen** on any song opens a card with its comment, link, and, for MozartAI links, an audio player and cover. Notes live in `events/main/hostNotes/{sessionId}_{trackId}` (`text` ≤ 2000, `editedBy` = Discord name, `editedById`, `updatedAt`): shared by all hosts, unreadable for everyone else, stamped with the editor's name by the rules. A host's live panel shows the note while that song plays. Starting a new evening deletes the old notes. **Download all songs** (`songsCsv()`) exports the current song list with links, comments, sender, time sent, and notes at any time; the after-show results export with scores (`csvString()`) and the archive downloads are unchanged.
- **Wheel looks.** `WHEEL_THEMES` in `public/cookie-wheel.mjs` maps a key to a picture in `public/assets/`; the host's choice is `wheelTheme` on the event document, so every page paints the same wheel. A new evening keeps the current look. Picture sources and licenses are in `public/assets/IMAGE-CREDITS.md`; a test checks every theme has a file and a credit.
- **MozartAI covers.** The `mozartLookup` callable (`functions/mozart.js`, members only) turns a `mozartai.com/s/…` or `/song/…` link into title, cover and audio URLs: it follows the share redirect to the song id and asks MozartAI's website API, which only allows mozartai.com in the browser. The asset links expire after about six hours, so they are fetched when needed (cached 30 minutes per function instance and per page), never stored. While a MozartAI song plays, its cover turns on the record at 33⅓ rpm. **This depends on an undocumented MozartAI endpoint** that can change without notice; when it fails, the page falls back to the plain record and the normal link.
- **Caching.** `firebase.json` sends `Cache-Control: no-cache` for all hosted files, so browsers revalidate after each deploy and never mix an old page with a new module.

## Co-hosts, live-show tools, screen-share view

- **Owners and co-hosts.** `HOST_UIDS` (with `OWNER_NAMES`) in the page and `isOwner()` in the rules list the owners. Co-hosts live in `config/hosts` (`ids`, `names`, `updatedBy`): readable by members, written only by owners (signed with their Discord name). The rules' `isHost()` is owner or listed co-host, so co-hosts have every host right except changing that list. Pages listen to `config/hosts` and switch a co-host's page to host mode at once (`applyHostRole()` re-subscribes to song details and notes).
- **Oops buttons.** `closeVoting()` remembers `lastClosedId`; **Re-open voting** (`reopenVoting()`) makes that song live again with its votes. **Skip** (`putBackInJar()`) returns the live song to the queue, makes a community song private again (drops its `revealed` entry), and deletes its votes (hosts may delete ballots) so it gets a fresh round. Finishing the evening clears `lastClosedId`.
- **Play now.** In the pre-listen card, `playNow()` makes a queued song live without a spin, like the last-song shortcut.
- **Host player and voters.** For MozartAI songs, hosts get an audio player under the song title (`showLiveMedia()`), and the live step shows the song length and the names that have voted.
- **Message to everyone.** `banner` on the event document (≤ 140 characters), shown at the top of every page.
- **Screen-share view.** `?view=stage` (opened from the live step) adds `stage-view` to the body: CSS hides the control room, notes, vote form, submit card, and account buttons; the host player stays so the host can play into the shared window.

## Adding a host later

Co-hosts: an owner adds them in **1 · Prepare → Co-hosts**; no deploy. New owners: append the Discord user id to `HOST_UIDS` (and a name to `OWNER_NAMES`) in `public/index.html` and to the list in `isOwner()` in `firestore.rules`, then `firebase deploy --only hosting,firestore:rules`.

All listed hosts can manage the playlist, spin the wheel, close voting, export results, and start new evenings. Playlist updates use Firestore transactions so one host's edit does not overwrite another's, a second host cannot start a round that is already spinning, and a round can only be confirmed once.

## Weekly playback workflow

1. A host logs in with Discord and names the evening. Submissions open at once, so the link can go out a day or two ahead.
2. Community members open the site and use **Submit your song**: title, the song link (MozartAI, Suno, or any https link; kept exactly as entered and opened in a new tab), plus an optional genre and a short comment. One song per person; it can be edited or withdrawn until the wheel picks it. Hosts can also add songs or paste a list in `Song | Creator | URL` format, pause submissions, or remove an entry from Host controls.
3. Share the Firebase Hosting URL to the Discord community. Members log in with Discord; their server name goes on their songs and votes automatically, and voting is a 0–10 slider in half-point steps.
4. The cookie wheel in the **main stage** shows every unplayed song, including submissions that arrived during the event. After signing in, the host uses **Spin the cookie!** beneath it. The spin is stored in Firestore, so **every open page plays the same ten-second animation and lands on the same song**. Viewers cannot interact with the wheel. When only one song is left, the button reads **Play the last song** and voting opens without a spin.
5. When the wheel stops, the stored winner becomes the live track and voting opens, showing its genre and comment. Submitters cannot rate their own song. If no host page was open to finish the round, any host can confirm the selected song in **Host controls → Confirm a winner manually**.
6. The live scoreboard reflects song average and rating count; the current round is marked provisional. **Close voting** to lock a song: the main stage then shows the standings so far, and the sidebar chart stays live. The next spin excludes played songs and includes anything submitted in the meantime.
7. Once every song is closed, the final winner appears. Songs with the same average share a rank (1, 1, 3) and are marked **TIE** on the chart, in the standings, and in the CSV; a shared top spot shows every co-champion. A host can also press **Finish the evening** between songs to show the final rankings early; either way submissions close. The host can export CSV (with genre and comment columns).
8. **Archive & start new evening** in Host controls stores the night's results under its name, deletes that night's submission documents, and creates a fresh evening with the name entered next to the button. Everyone submits again from scratch; the old results stay listed under *Past cookie nights*.

## How the cookie wheel works

- **Renderer.** `public/vendor/wheel-of-names/` holds `WheelPainter.js`, `PieSlice.js`, `FontPicker.js`, `ImageCache.js`, `ImageUtil.js`, `hubSizes.js`, and the needed part of `Util.js` from <https://github.com/momander/wheel-spinner> (commit `003c97439592901a405c3d3495295cef5eea1755`), converted to ES modules with unused bundled imports removed. `LICENSE` and `NOTICE.txt` sit beside the code; keep them. `public/assets/chocolate-chip-cookie.jpg` is the cover image of the original shared wheel and `public/assets/original-wheel-settings.json` records its settings (image wheel, small hub, ten-second spin).
- **Shared spin.** Starting a spin writes one plan into the event document: the frozen list of queued songs (`spinTracks`), the chosen song (`spinTargetId`), `spinStartedAt`, `spinDurationMs`, `spinFinalAngle`, and a fresh `spinId`. The song is chosen with `crypto.getRandomValues` and rejection sampling, so every queued song has the same chance. Every page animates that plan with the same ease-out curve; songs added or removed during a spin do not change the wheel in motion.
- **Finishing a round.** When the countdown ends, the first host page to get there confirms the stored target in a Firestore transaction that checks the phase, the `spinId`, and that the song is still queued. Other host pages see the round is already confirmed and do nothing. Viewer pages never write.
- **Hidden tabs, reduced motion, clocks.** A timer finishes the countdown and the round even when the browser pauses animation frames in a background tab. With the system "reduce motion" preference, the wheel shows its final position immediately and only the countdown runs. The winner never depends on any device clock; if a viewer's clock runs behind the host's, the animation starts when the plan arrives instead of standing still.
- **Limitation.** A host page must be open (in any tab) for the round to finish automatically, because only hosts may write the result. If every host closed the page, reopen it and use **Confirm a winner manually**.

## Community submissions

- Each signed-in visitor may store one entry per evening, written as two documents in one batch under the same id `{sessionId}_{uid}`:
  - `events/main/submissions/…` is public and says only **who** submitted: Discord name, ids, and timestamps. The rules refuse any song field here, and refuse the entry unless its details document exists too.
  - `events/main/songDetails/…` holds **what**: title, https link, optional genre (up to 30 characters) and comment (up to 200). Only the submitter and the hosts may read it.
  - Its track id is `sub_{uid}`, which lets the rules refuse the submitter's own ballot without an extra read.
- **Fresh hearing.** Until a song is played, other visitors see only the submitter's name: the wheel slices, the labels under the wheel, and the stored spin plan all show names, never titles (host-added songs show their "Submitted by" name too, or "Mystery guest"). When a host's page sets a community song live, it copies title, link, genre, and comment into `events/main.revealed`, and from then on everyone sees it on the stage, the chart, the CSV, and the archive. Removed songs are never revealed. Hosts see every song in Host controls so they can moderate.
- The rules allow create and update only while `submissionsOpen` is true on the event document, the evening is not finished, and the song has not been played or removed. Owners may withdraw while the song is queued and no spin is running; hosts may always delete.
- Hosts never edit submission documents. Spinning, confirming, closing, and removing write only to `events/main`: a community song's play status lives in its `trackStatus` map as `live`, `closed`, or `removed`. The page merges host tracks and submissions into one list for the wheel, the queue, the chart, the CSV export, and the archive.
- `submissionsOpen` is set on every new evening. An event document created before this version has no such field, so submissions read as paused until a host presses **Open submissions** or starts a new evening.
- "One per person" means one per Discord account, as with votes.

## Anti-duplicate voting and privacy

Each Discord account of a server member is one Firebase identity. Firestore security rules prevent that identity from submitting more than one ballot per track and prevent updates after the host closes the round. Someone with several Discord accounts on the server still gets several votes; the server's own moderation is the limit.

Scores and nicknames are in Firestore and readable to any logged-in server member to support the client-side leaderboard. Avoid storing confidential details. Firebase Cloud Firestore region and data retention should be selected with your community's privacy expectations in mind.

## Checks and limitations

Run the local checks with `node --test tests/wheel.test.cjs` (Node 22, no packages needed). They load the page script with a simulated DOM, a fake clock, and in-memory Firestore writes, and exercise the real wheel module: slice geometry for every queue size from 1 to 200, the shared animation, host confirmation and host races, manual recovery of old rounds, reduced motion, hidden-tab completion, MozartAI links, community submissions with the own-song vote block, the hidden-until-played song details, and the host pause and remove controls, the Discord login round trip (state check, cleaned address bar, member gate, host list), and the vendored painter. They do not connect to the live Firebase project.

The login function has its own checks against a fake Discord: `npm --prefix functions test` (after `npm --prefix functions install`). They cover the code exchange, the name fallback, refusal of non-members, and Discord errors.

The page was also run in a browser at desktop and phone widths (down to 320 px) against an in-memory stand-in for Firebase: the wheel, artwork, pointer alignment, spin, and voting hand-off behaved as described, with no horizontal scrollbar. **It has not yet been tested against your live Firebase project** because its credentials are not available here; deploy and run through one evening with a second browser before the first real session.

- <https://github.com/momander/wheel-spinner> — Original renderer source
- <https://firebase.google.com/docs/hosting/> — Firebase Hosting
- <https://firebase.google.com/docs/firestore/security/get-started> — Firestore rules
- <https://firebase.google.com/docs/projects/billing/firebase-pricing-plans> — Firebase pricing

## License

- **Cookie Sessions code** (everything not listed below): MIT, see `LICENSE`.
- **Wheel renderer** in `public/vendor/wheel-of-names/`: Apache License 2.0, Copyright 2020 Google LLC, see the `LICENSE` and `NOTICE.txt` in that folder.
- **Wheel photos** in `public/assets/`: each under its own license (public domain, CC BY, CC BY-SA, Apache 2.0) with author and source in `public/assets/IMAGE-CREDITS.md`. The CC BY-SA pictures stay under CC BY-SA; MIT does not apply to them.
