# Building and deploying FinSim

```bash
node build.js
```

Writes `dist/` — the same site, JavaScript minified, every local file stamped
with a hash of its own contents. Nothing in the working folder is touched, so
opening `index.html` here still works with no build, exactly as before.

---

## First, the uncomfortable part

This build was added to stop the code being copied. **On its own it does not do
that**, and it is worth being plain about why rather than letting a `dist/`
folder create a false sense of safety.

A browser cannot run code it has not been given. Whatever arrives at the
browser can be read by whoever is sitting at it — that is not a flaw in this
app, it is how the web works, and there is no setting, header, or library that
changes it. Specifically:

| Idea | What actually happens |
|---|---|
| Minify / obfuscate the code | One click of the browser's `{ }` formatter and it is readable again. Names are shorter; the logic is all there. |
| Block F12 and right-click | `Ctrl+U`, the Network tab, or `curl`. Also punishes ordinary users. |
| "DevTools detector" scripts | One breakpoint, or disabling JavaScript, removes it. |
| Serve the JS from an odd path | It is listed in the Network tab by definition. |

Against someone who writes code, each of these is worth a minute or two.

**And right now none of it matters at all**, because the repository is public:

```
https://raw.githubusercontent.com/KaonHew02/FinSim/main/app.js
```

That returns the clean, fully-commented original to anyone, with no account, no
site visit, and nothing to bypass. Minifying what the *site* serves while that
URL exists protects nothing whatsoever.

So the order that works is: **repository first, build second, licence
underneath both.**

---

## The one arrangement that genuinely hides the source

Two repositories. It is free, it keeps GitHub Pages working, and it is the only
setup here where `build.js` buys anything.

1. **`FinSim` — private.** The working folder: sources, comments, this file,
   git history. Nobody can read it, and `raw.githubusercontent.com` returns 404.
2. **`finsim-site` — public.** Contains *only the contents of `dist/`*, at the
   root. Pages serves this one. It holds minified JavaScript, no comments, and
   no history of how any of it was written.

To publish, from the working folder:

```bash
node build.js
cd dist
git init -b main
git remote add origin https://github.com/KaonHew02/finsim-site.git
git add -A
git commit -m "Publish"
git push -f origin main
```

Then in the **public** repo: Settings → Pages → Deploy from branch → `main` /
`(root)`.

Two things to carry over: point your custom domain (if any) at the new repo,
and add the new site's address to **Authorized JavaScript origins** on the
OAuth client in Google Cloud, or the Drive backup will stop signing in.

> A private repo on the free plan cannot serve Pages *itself* — which is fine,
> because the repo being served here is the public one. Nothing needs upgrading.

### If you would rather keep one public repo

Perfectly reasonable — it is a personal finance calculator, not a trade secret,
and the tax rules in it are published law. In that case run the build anyway
and commit `dist/`, purely for the size win. You would then remove `dist/` from
`.gitignore` and point Pages at a workflow or the `/docs` folder. Understand
that the source stays readable, and that `LICENSE` is doing all of the work.

---

## What `LICENSE` does, and why it is the real protection

It cannot stop a download. What it removes is the defence of *"there was no
licence, so I assumed it was free to take."* Copyright applies by default, but a
public repository with no licence file is widely **treated** as fair game.
`LICENSE` puts the terms on the record — explicit, dated, and in version
control — which is what matters if you ever have to ask someone to take a copy
down.

For a client-side web application that is the whole of the realistic
protection, and it is worth more than obfuscation, which delays a determined
reader by minutes and costs you debuggability permanently.

---

## What the build gives you regardless of any of that

**Less to download.** 261.6 KB of JavaScript becomes 118.4 KB — 55% smaller,
which is a real gain on a phone on a slow connection.

**The end of the stale-cache bug.** `?v=` was a number in `index.html` that had
to be remembered by hand, and a forgotten bump means Pages serves yesterday's
`app.js` to a phone for days — a bug that cannot be reproduced on the machine
it was written on. The build replaces it with a hash of each file's own bytes,
so the stamp changes when, and only when, the file does. It cannot be forgotten
and it cannot be wrong.

**A refusal to ship something broken.** The build fails loudly if the
Content-Security-Policy has gone missing from `index.html`, if a script it
expected is no longer referenced, or if any hand-written `?v=` survives.

### One rule for the build

`build.js` runs terser **without `toplevel` mangling**, and that is deliberate.
The five scripts are separate `<script>` tags sharing globals — `FSStore`,
`FS_DRIVE`, `escapeHtml`, `cleanEnvelope`. Renaming across that boundary would
break them silently, in a way that only shows up when someone imports a file.
If you ever bundle these into one file, that constraint goes away; until then,
leave the flag off.

---

## After changing anything

```bash
node build.js
```

Then check `dist/` in a browser before pushing. The security work in `save.js`
is covered by no automated test, so it is worth pasting a scenario name of
`<img src=x onerror=alert(1)>` once after a build: it must appear on the chip as
that literal text, and no dialog may open.
