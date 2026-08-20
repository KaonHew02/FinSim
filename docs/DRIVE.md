# Keeping a copy in Google Drive

FinSim saves what you type into the browser you typed it in. That is instant,
it needs no account, and it works with the network off. What it cannot survive
is clearing your browsing data, a reinstalled browser, or a second computer.

So there are two copies beyond this browser, both of them things you press for:

- **Export / Import** — one JSON file you download and keep. Needs nothing set
  up, works today, works offline.
- **To Drive / From Drive** — the same file, kept in a folder in your own
  Google Drive. This is what needs the twenty minutes below, once.

Nothing syncs on its own. Nothing leaves the browser unless you press a button.

---

## Before you start: check who can see that folder

Open [your FinSim folder](https://drive.google.com/drive/folders/19TPVA4qq6bnwN9kQh_p4UOycB0wSfYGm)
in Drive → **Share** → **General access**.

It must say **Restricted**. If it says *Anyone with the link*, then anyone
holding that link can read your salary, your loans and every scenario you have
saved. A finance folder is not a folder to share.

---

## The short version, if you already set up MoneyFlow

You have done Steps 1–3 already — the project, the Drive API, the consent
screen. All FinSim needs is **its own client ID inside that same project**:

1. [console.cloud.google.com](https://console.cloud.google.com/) → select the
   **MoneyFlow** project.
2. **APIs & Services** → **Credentials** → **Create credentials** → **OAuth
   client ID** → **Web application**, name it `FinSim web`.
3. Authorised JavaScript origin: `https://kaonhew02.github.io`
4. Create, copy the ID, paste it into `drive-config.js`. That is Step 5 below.

Make a second client rather than reusing MoneyFlow's, even though reusing it
would work — the sign-in window would say "MoneyFlow" while you are standing in
FinSim, and the two apps would share one grant of access. Separate clients keep
them separate.

Everything below is the same story from the beginning, in case you are setting
this up on a fresh Google account.

---

## Step 1 — Make a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/).
2. Project dropdown at the top → **New project**. Name it `FinSim`. Create.
3. Make sure the project selector now says **FinSim** before going on. Every
   step after this applies to whichever project is selected, and setting up the
   wrong one is the single easiest mistake to make here.

There is no cost. This kind of project is free, and Drive API calls at this
volume are free.

## Step 2 — Switch the Drive API on

**APIs & Services** → **Library** → search **Google Drive API** → **Enable**.

Without this, sign-in works and every save fails — which reads as a broken
button rather than a missing switch.

## Step 3 — The consent screen

**APIs & Services** → **OAuth consent screen**.

1. User type **External**. Create.
   (*Internal* is for Google Workspace organisations. A personal Gmail account
   has no such option.)
2. App name `FinSim`, your email as both the user support and developer
   contact. Save and continue.
3. **Scopes** → **Add or remove scopes** → filter for `drive.file` and tick
   **`.../auth/drive.file`** — *"See, edit, create and delete only the specific
   Google Drive files you use with this app."* Update, then Save and continue.
4. **Test users** → **Add users** → your own Gmail address. Save.

> **Why `drive.file` and nothing wider.** It gives the app access to the files
> it creates itself and nothing else. It cannot read your other documents and
> cannot list your Drive, which is both the right amount of access and the
> reason this needs no review from Google. The broader `drive` scope would work
> too, and would put your entire Drive behind a client ID published on GitHub.
> Do not.

> **Leave it in Testing.** Publishing invites a verification process you have no
> use for. Testing works indefinitely for the test users you listed. The cost
> is that Google re-asks for consent from time to time — a few clicks, months
> apart.

## Step 4 — The client ID

**APIs & Services** → **Credentials** → **Create credentials** → **OAuth client
ID**.

- Application type: **Web application**
- Name: `FinSim web`
- **Authorised JavaScript origins** — an origin is scheme + host, with **no
  path and no trailing slash**. FinSim lives at
  `https://kaonhew02.github.io/FinSim/`, so the origin to register is:
  - `https://kaonhew02.github.io`
  - and, only if you ever serve the folder locally, `http://localhost:4781`
- **Authorised redirect URIs**: leave empty. This app never redirects; it takes
  its token in a pop-up.

Create. Copy the client ID — it ends in `.apps.googleusercontent.com`.

> There is a client *secret* on that screen too. This app does not use it and
> must not. A secret published in a GitHub repo is not a secret.

> **`file://` will never work.** Opening `index.html` by double-clicking it is
> fine for the calculators and fine for Export/Import, but Google will not
> issue a token to a page with no origin. Use the GitHub Pages address for
> Drive.

## Step 5 — Paste it in

Open `drive-config.js` and replace the placeholder:

```js
const FS_DRIVE = {
    clientId: 'YOUR-CLIENT-ID.apps.googleusercontent.com',   // ← paste over this
    folderId: '19TPVA4qq6bnwN9kQh_p4UOycB0wSfYGm',
    filename: 'finsim-data.json',
};
```

The folder ID is already filled in — it is the part of your folder's URL after
`/folders/`. Both values are safe to commit; neither grants anything on its own.

Then push, so the live site has it:

```bash
git add drive-config.js && git commit -m "Drive: my client ID" && git push
```

GitHub Pages takes a minute or so to pick it up.

## Step 6 — Try it

Open <https://kaonhew02.github.io/FinSim/> and press **To Drive**. Google asks
you to sign in and to allow FinSim access — once. Then `finsim-data.json`
appears in your folder.

To prove the round trip: press **From Drive**. It should offer to replace your
figures with an identical copy, and say what is in both. Agreeing is harmless.

---

## What this is, and what it is not

**It is a copy you press for.** There is no background sync. If you save six
scenarios and never press **To Drive**, Drive still holds what it held before.
The topbar says when you last sent anything, and turns red after a week.

**It is not two-device editing.** If you use FinSim on a laptop and a phone,
each browser holds its own figures and Drive holds whichever pressed **To
Drive** last. Pressing **From Drive** on the other one then throws away that
one's work. The safe habit is one machine editing, the others only pulling.

---

## When something breaks

**"Drive is not set up yet"** — `drive-config.js` still has the placeholder
client ID, or the push has not reached GitHub Pages yet. Step 5.

**The sign-in window opens and closes immediately** — the address you are on is
not in the authorised origins list. Step 4. Check for a trailing slash, and
remember that `http://localhost:4781` and `https://kaonhew02.github.io` are
different origins.

**"Access blocked: FinSim has not completed the Google verification process"** —
you are signed into a Google account that is not on the test users list.
Step 3, item 4.

**Sign-in works, saving fails with 403** — the Drive API is not enabled on this
project. Step 2.

**"That folder no longer exists, or this account cannot see it"** — the folder
ID is wrong, or you signed in with a different Google account than the one that
owns the folder.

**"Google's sign-in library did not load"** — an extension or a strict privacy
setting is blocking `accounts.google.com`. Export and Import are unaffected.

**It asks you to sign in again after a while** — expected. Access lasts about an
hour, and consent in Testing mode is periodically re-asked. Nothing is lost;
your figures are in the browser regardless.
