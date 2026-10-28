# Putting Cookie Sessions online — a step-by-step guide

This guide takes you from the ZIP file to a live website at **https://cookie-sessions.web.app** where members of your Discord server log in with Discord. No programming knowledge is needed. The first time takes about 45 minutes, mostly waiting for installers. Every later update takes about two minutes.

Commands are shown in grey boxes. Type each exactly as shown (or copy and paste it), then press **Enter**.

---

## Before you start — what you need

- A **Windows PC** with an internet connection.
- The **Google account that owns the Firebase project "cookie-sessions"**. If someone else created it, ask them to open the Firebase Console → the gear icon ⚙ next to "Project Overview" → **Users and permissions** → **Add member**, and add your Google account as **Owner**.
- A **payment card** for the Firebase "Blaze" plan (Step 0c). The login needs a small server function, and Google only runs those on Blaze. A community event stays far inside the free allowance, so the expected bill is €0; you will set an alert so nothing surprises you.
- A **Discord account** that can create an application (any account can) and that is a member of your community server.

## Words used in this guide

| Word | Meaning |
|---|---|
| **Firebase** | Google's service that hosts the website, stores the votes, and runs the login function. |
| **Firebase Console** | The web page where you manage Firebase: <https://console.firebase.google.com/> |
| **Discord Developer Portal** | The web page where you register the website with Discord: <https://discord.com/developers/applications> |
| **Command Prompt** | A plain black window where you type commands. Nothing happens until you press Enter. |
| **Node.js** | A free program the Firebase deployment tool needs. You never open it yourself. |
| **Deploy** | Uploading the website, rules, and login function to Firebase. |

## What is in the ZIP

| File or folder | What it is |
|---|---|
| `public\` | The website itself: the page, the cookie wheel, the cookie picture, and the wheel renderer. |
| `functions\` | Two small server functions: the Discord login (checks that someone is a member of your server), and the MozartAI lookup (fetches a song's cover and audio). |
| `firebase.json` | Tells Firebase where the website and the function are. |
| `firestore.rules` | The security rules for the database. They decide who may read and change what. |
| `.firebaserc` | Tells the deployment tool to use the project **cookie-sessions**. |
| `README.md` | Technical notes for whoever maintains the site. |
| `DEPLOY-GUIDE.md` | This guide. |
| `tests\` | Automated checks for developers. You can ignore this folder. |

---

## Step 0 — One-time setup

### 0a. Register the website with Discord

1. Open <https://discord.com/developers/applications> and log in with Discord.
2. Click **New Application**, name it **Cookie Sessions**, accept the terms, and click **Create**. (The name and icon are what members see on Discord's "Authorize" screen.)
3. In the left menu click **OAuth2**.
4. Under **Client information**, copy the **Client ID** (a long number). Keep it in a note; you need it in 0d.
5. Click **Reset Secret**, confirm, and copy the **Client Secret**. Keep it somewhere private for Step 6. **Never paste it into a file, a chat, or Discord.** If it ever leaks, click Reset Secret again and repeat Step 6.
6. Under **Redirects**, click **Add Redirect** twice and enter exactly (with the slash at the end):
   - `https://cookie-sessions.web.app/`
   - `https://cookie-sessions.firebaseapp.com/`
7. Click **Save Changes**.

### 0b. Copy the Discord ids you need

1. In the Discord app: **User Settings** (gear next to your name) → **Advanced** → switch on **Developer Mode**.
2. Right-click your community **server icon** → **Copy Server ID**. Keep it in your note as the *server id*.
3. For each host: right-click their name in the member list → **Copy User ID**. Keep these as the *host ids*.

### 0c. Switch Firebase to the Blaze plan and set a budget alert

1. Open <https://console.firebase.google.com/>, click **cookie-sessions**, then at the bottom left click **Upgrade** (or the plan name **Spark**).
2. Choose **Blaze**, select or create a billing account, and enter the card.
3. When Firebase offers a **budget**, set it to a small amount such as **€5**. You get an email if spending ever gets near it. (You can also do this later under the gear ⚙ → **Usage and billing** → **Details & settings**.)

### 0d. Put the ids into the files

**Already done for cookie-sessions:** the Client ID and the owners are in the files, and `functions\.env` (kept out of Git, included in the ZIP) holds the Client ID and server id. Only repeat this if one of them changes; to add a host, see "Adding or changing a host".

Use **Notepad** (right-click a file → Open with → Notepad). Keep the quotes exactly as they are.

1. `public\index.html` — use **Edit → Find**:
   - Search `DISCORD_CLIENT_ID` and replace `REPLACE_WITH_DISCORD_CLIENT_ID` with the **Client ID** from 0a.
   - Search `HOST_UIDS` and replace `REPLACE_WITH_HOST_DISCORD_ID` with the first **host id**. For more hosts, see "Adding or changing a host" below.
2. `firestore.rules` — search `REPLACE_WITH_HOST_DISCORD_ID` and replace it with the same host id(s). The two lists must be identical.
3. In the `functions` folder, make a copy of `.env.example` and name the copy `.env` (Windows may warn about changing the extension — click **Yes**). Open it and fill in:
   ```
   DISCORD_CLIENT_ID=the Client ID from 0a
   DISCORD_GUILD_ID=the server id from 0b
   ```
   Save. Neither value is secret.

---

## Step 1 — Unzip the files

1. Find **cookie-sessions-deploy.zip**, right-click it, and choose **Extract All…**.
2. Click **Browse…**, pick a simple place such as your **Documents** folder, and click **Extract**.
3. You now have a folder called **cookie-sessions**. Keep it; you use it for every update.

(If you already did Step 0d in this folder, carry on. Otherwise do 0d now.)

## Step 2 — Install Node.js (only the first time)

1. Open <https://nodejs.org/> and click the green **LTS** download button.
2. Open the downloaded `.msi` file and click **Next** through the installer with the defaults. Leave "Automatically install the necessary tools" **unticked**. Click **Install**, then **Finish**.

## Step 3 — Open a Command Prompt inside the folder

1. Open the **cookie-sessions** folder in File Explorer.
2. Click once in the **address bar** at the top, type `cmd`, and press **Enter**.
3. A black window opens whose line ends with your folder path, for example `C:\Users\YourName\Documents\cookie-sessions>`.

Use **Command Prompt**, not "Windows PowerShell" (PowerShell sometimes refuses to run the Firebase tool). Leave this window open for the remaining steps.

## Step 4 — Install the tools (only the first time)

```
npm install -g firebase-tools
```

This takes one to three minutes; yellow `npm warn` lines are harmless. Then install what the login function needs:

```
npm --prefix functions install
```

Check the Firebase tool:

```
firebase --version
```

It prints a version number. (If it asks "Allow Firebase to collect CLI usage information?", type `n` and press Enter.)

## Step 5 — Sign in to Firebase

```
firebase login
```

Your browser opens. Choose the **Google account that owns cookie-sessions**, click **Allow**, and wait for **✔ Success! Logged in as …** in the black window. Check it:

```
firebase projects:list
```

One row must show **cookie-sessions**. If not, run `firebase logout` and `firebase login` with the right account.

## Step 6 — Store the Discord secret (first time, or after resetting it)

```
firebase functions:secrets:set DISCORD_CLIENT_SECRET
```

When it asks **Enter a value for DISCORD_CLIENT_SECRET**, paste the **Client Secret** from 0a (right-click pastes in Command Prompt; nothing is shown while you paste — that is normal) and press Enter. If it asks to enable an API, answer **y**.

## Step 7 — Deploy

```
firebase deploy --only hosting,firestore:rules,functions
```

The first time takes a few minutes because Google builds the login function. If it asks about a **cleanup policy** for container images, answer **y** and accept the default number of days. The end looks like this:

```
+  functions[discordLogin(europe-west1)] Successful create operation.
+  functions[mozartLookup(europe-west1)] Successful create operation.
+  firestore: released rules firestore.rules to cloud.firestore
+  hosting[cookie-sessions]: release complete

+  Deploy complete!
```

## Step 8 — Allow the function to create logins (only the first time)

The login function needs one permission that Google does not give it by default.

1. Open <https://console.cloud.google.com/apis/library/iamcredentials.googleapis.com?project=cookie-sessions> and click **Enable** (if it says **Manage**, it is already on).
2. Open <https://console.cloud.google.com/iam-admin/iam?project=cookie-sessions>.
3. Find the row whose name ends in **-compute@developer.gserviceaccount.com** ("Default compute service account") and click the pencil ✏ at its end.
4. Click **Add another role**, search **Service Account Token Creator**, select it, and click **Save**.

It can take a minute or two to take effect.

## Step 9 — Turn off the old sign-in methods

Firebase Console → **Authentication** → **Sign-in method**. If **Anonymous** or **Email/Password** say *Enabled*, click each, switch **Enable** off, and click **Save**. The site no longer uses them, and the rules refuse them anyway. (The old host email accounts under **Users** can be deleted.)

## Step 10 — Check the website

1. Open <https://cookie-sessions.web.app>. You see **Pull up a chair** and a **Log in with Discord** button.
2. Click it. Discord asks once to **Authorize** Cookie Sessions (it may read your name and your membership of the server). Click **Authorize**. You come back to the site, logged in, with your server name at the top right.
3. If you are a host, **Host controls** appears at the top right and the **Host control room** at the bottom of the page.
4. **Start a fresh evening once** (important after this update): open **3 · Wrap up**, type a name under **Name of the next evening**, and press **Save tonight & start new evening**. Songs sent with the old version of the site do not work with the new privacy rules, and this clears them.
5. In **1 · Prepare**, pick the **Wheel look** (for example the Halloween pumpkin) and add a test song with **Add a song yourself**, ideally with a MozartAI link. Press **▶ Listen** next to it: the song should play with its cover. Save a test note.
6. Log in on your phone with another Discord account from the server and submit a song. On your host page it appears in the list; on the phone, others only see the name.
7. Open **2 · Live show** and press **Spin the wheel**. Both screens show the same spin. When a MozartAI song wins, its cover turns like a record. Vote on the phone, then **Close voting**.
8. Optional: try a Discord account that is **not** on the server. It must be refused with "Cookie Sessions is for members of our Discord server".
9. Before the real event, start another fresh evening (step 4) so the test songs and votes are gone.

Share **https://cookie-sessions.web.app** with your community.

---

## Updating the site later

1. Copy the new files into your **cookie-sessions** folder, replacing the old ones. Keep your `functions\.env` and check that the ids from Step 0d are still filled in.
2. Open a Command Prompt in the folder (Step 3) and run `npm --prefix functions install`.
3. Run the deploy command from Step 7.

To undo a website update: Firebase Console → **Hosting** → **Release history** → ⋮ next to an earlier release → **Rollback**.

## Adding or changing a host

There are two kinds of hosts:

- **Owners** (Callandra and yanti) are written into the site files. They can do everything, including choosing co-hosts.
- **Co-hosts** are added in the app and can do everything except change the co-host list. No file editing and no deploy needed.

**Add a co-host (the usual way):** an owner opens **1 · Prepare → Co-hosts**, enters the person's Discord **User ID** (Step 0b) and a name for the list, and presses **+ Add co-host**. It works at once: their open page turns into a host page. To remove someone, press **×** next to their name.

**Add or change an owner (rare):**

1. Copy their Discord **User ID** (Step 0b).
2. In `public\index.html`, search `HOST_UIDS`, add the id with a comma after the previous one, and add their name in `OWNER_NAMES` just below:
   ```
   const HOST_UIDS = [
     '810808889116459019', // Callandra
     '1505891427920379934', // yanti
     '234567890123456789' // new owner
   ];
   const OWNER_NAMES = { '810808889116459019': 'Callandra', '1505891427920379934': 'yanti', '234567890123456789': 'New owner' };
   ```
3. Make the same change to the list in `firestore.rules` (search `request.auth.uid in [`).
4. Deploy (Step 7).

If the two owner lists differ, that person sees the controls but their changes are rejected ("Missing or insufficient permissions").

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `'npm' is not recognized` or `'firebase' is not recognized` | Node.js or the Firebase tool is not installed, or the window was opened too early. | Close the window, do Step 2 and Step 4, then open a new window (Step 3). |
| `firebase.ps1 cannot be loaded because running scripts is disabled` | You are in PowerShell. | Use Command Prompt (Step 3). |
| `Error: Not in a Firebase app directory` | The window is not inside the cookie-sessions folder. | Step 3 again; the line must end with `\cookie-sessions>`. |
| Deploy says the project must be on the **Blaze** plan | Step 0c was skipped. | Do Step 0c, then Step 7 again. |
| Deploy stops with **Could not build the function due to a missing permission on the build service account** | Newer Google projects do not let the build use the default account. | Open <https://console.cloud.google.com/iam-admin/iam?project=cookie-sessions>, edit the row ending in **-compute@developer.gserviceaccount.com** (pencil ✏), **Add another role** → **Cloud Build Service Account**, **Save**, wait two minutes, then Step 7 again. |
| Deploy asks for **DISCORD_CLIENT_ID** or **DISCORD_GUILD_ID** | `functions\.env` is missing or empty. | Step 0d, point 3. |
| The site says **Setup needed: add the Discord client id and the host ids** | `index.html` still has a `REPLACE_WITH_…` placeholder. | Step 0d, point 1, then Step 7. |
| Discord shows **Invalid OAuth2 redirect_uri** | The site address is not in the Discord app's Redirects. | Step 0a, point 6 — the slash at the end matters. |
| **Discord did not accept this login** | The Client Secret is wrong or was reset, or the Client ID in the files does not match. | Step 6 with the current secret, check Step 0d, then Step 7. |
| **Cookie Sessions is for members of our Discord server** | That Discord account is not on the server, or `DISCORD_GUILD_ID` is wrong. | Join the server, or fix `functions\.env` and deploy again. |
| **internal** or **Permission 'iam.serviceAccounts.signBlob' denied** after authorizing | Step 8 is missing. | Do Step 8, wait two minutes, try again. |
| A MozartAI song shows no cover, or **▶ Listen** says MozartAI did not answer | MozartAI changed or is down; the lookup uses MozartAI's website data, which they can change without notice. | The link still works with **Open the song**. If it keeps failing, the lookup in `functions\mozart.js` needs updating. |
| **Event sync failed: Missing or insufficient permissions** | The rules were not uploaded, or the database does not exist. | Firebase Console → **Firestore Database**: create it if needed (production mode, a `europe-…` location), then Step 7. |
| A host does not see **Host controls** | They are neither an owner nor in the co-host list. | An owner adds them under **1 · Prepare → Co-hosts** (see "Adding or changing a host"). |
| The wheel says "Selecting the next song…" forever | No host page was open when the countdown ended. | A host uses **Host controls → Confirm a winner manually**. |
| **Submit your song** says **SUBMISSIONS PAUSED** although nobody paused it | The evening was created by an older version of the site. | Host presses **Open submissions** once, or starts a **New evening**. |

## Running an evening — quick reminder

The **Host control room** at the bottom of the page has three steps. The right step opens by itself as the evening moves on; you can click any step at any time. The **Right now** line above them always says what is happening.

**Step 1 · Prepare** (a day or two ahead)

1. If last time's evening is still there, go to **3 · Wrap up**, type a name under **Name of the next evening**, and press **Save tonight & start new evening**.
2. In **The evening**, pick the **Wheel look** (cookie, Halloween pumpkin, vinyl record, Christmas, donut, or pizza). Everyone sees it at once, and the next evening keeps it until you change it.
3. Share **https://cookie-sessions.web.app** in Discord. Members log in and use **Submit your song**. Until the wheel picks a song, members only see *who* sent it.
4. Under **Songs for tonight**, press **▶ Listen** next to a song. MozartAI songs play right there with their cover; for other links press **Open the song**. Type notes and press **Save note**. All hosts see the same notes (marked **NOTE** in the list), and they appear again under the song title while it plays, for hosts only.
5. **Download all songs** (next to the song count) saves every song with its link, comment, and the host notes as a spreadsheet, at any time. After the show, **3 · Wrap up** still has the results download with scores, and **Past evenings** keeps earlier ones.

**Step 2 · Live show** (during the event)

6. If you share your screen on Discord, press **📺 Open screen-share view** under **For the room** and share *that* window (in Discord: Share Screen → the "Cookie Sessions" window, with sound on). It shows the wheel, the song with its spinning cover, the live score and the chart, but never host notes, voter names or controls. Keep your normal host page open next to it for the buttons.
7. Press **Spin the wheel** (or **Spin the cookie!** under the wheel). The wheel turns for everyone and lands on the same song. To play a particular song instead, open it with **▶ Listen** in step 1 and press **Play this song now, without a spin**.
8. While a song is up, hosts see a player under its title (MozartAI songs): press play to play it into the Discord call. The live step shows the song length and who has voted so far. Press **Close voting**, then spin again.
9. Mistakes are fixable: **Re-open voting** brings back the round you just closed; **Skip: put this song back in the jar** (for example when a link does not play) removes its votes and lets the wheel pick it again later.
10. **Message to everyone** shows a line at the top of every screen, such as "10-minute break". Remove it when it is no longer true.
11. If the wheel stopped but voting did not open, open **The wheel stopped but voting did not open?** and confirm the song it landed on.

**Step 3 · Wrap up**

12. After the last song the champion is shown. **Finish the evening** ends early; **Download results (spreadsheet)** saves the scores. Earlier evenings are under **Past evenings**.

Keep at least one host page open during a spin so the round finishes by itself.

## Costs and safety

- Blaze is pay-as-you-go, but a voting night uses a tiny part of the free monthly allowance (two million function calls, generous database reads, a few stored secrets). Expect €0, at most a few cents for storing the function's build. The budget alert from Step 0c warns you by email.
- The **Discord Client Secret** is the only real secret. It lives in Google Secret Manager (Step 6), never in the files. The Client ID and the owners' Discord ids in the files are public identifiers; the Firebase project settings are not in the files at all (Firebase Hosting hands them to the page). Optional extra: in Google Cloud Console → APIs & Services → Credentials, restrict the "Browser key" to the websites `https://cookie-sessions.web.app/*` and `https://cookie-sessions.firebaseapp.com/*`.
- Discord membership is checked at login. Someone who leaves or is removed from the server stays logged in on their devices until they log out; to cut them off, delete their user in Firebase Console → **Authentication → Users** (the user id is their Discord id). Their open page keeps working for at most an hour, and they cannot log in again while they are off the server.
- Votes, Discord server names, and Discord user ids are stored in your Firebase project. Delete old sessions from **Firestore Database** if you do not want to keep them.
