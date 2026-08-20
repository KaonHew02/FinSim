# FinSim

**Simulate your financial future.** Thirteen Malaysian money calculators in one
page — payslip to retirement, all built on KWSP, LHDN and PERKESO rules rather
than generic overseas formulas.

No install, no sign-up, no data leaves your machine. Open `index.html` in a
browser and it runs. Live at <https://kaonhew02.github.io/FinSim/>.

```
FinSim/
├── index.html        the page — sidebar + one section per calculator
├── app.js            all the maths, then the render code
├── save.js           autosave, saved scenarios, export/import
├── drive.js          the optional copy in your own Google Drive
├── drive-config.js   your Google client ID and folder — safe to publish
├── style.css         design tokens, components, responsive rules
├── FinSimLogo.svg    the logo — mark + wordmark (FinSimMark.svg is the mark alone)
├── docs/DRIVE.md     setting the Drive copy up, once
├── MODULES.md        the deep version of this document
└── README.md         you are here
```

---

## Which calculator do I want?

### 💼 Tax

| Calculator | Answers | You get |
|---|---|---|
| **PCB Calculator** | What actually lands in my account this month? | Net pay, every statutory deduction, what your employer adds on top |
| **Income Tax Calculator** | What do I owe for the year? | Tax band by band, ~20 relief lines with their caps, effective vs marginal rate |

### 🏦 Loans

| Calculator | Answers | You get |
|---|---|---|
| **Home Loan** | What does the bank want every month? | Instalment, total interest, what paying extra saves in ringgit *and* in years, full amortisation |
| **Car Loan** | Hire purchase is quoted flat — what does that really cost? | The effective reducing rate (roughly **double** the quoted flat rate), early-settlement cost after the Rule of 78 |
| **Personal Loan** | Flat or reducing, on the same rate? | Both instalments side by side, the true rate behind a flat quote, stamp duty and fees |
| **DSR Calculator** | How much more will a bank lend me? | Your DSR, the band it falls in, and what the leftover room could buy as a home, car or personal loan |

### 🐖 Savings

| Calculator | Answers | You get |
|---|---|---|
| **Savings Goal** | What must I put aside to have the money by then? | The monthly deposit, and what a smaller one costs you in time |
| **EPF Calculator** | What does my EPF grow into? | Akaun 1/2/3 split, year-by-year projection with a dividend rate you can set per year |
| **Compound Interest** | What does regular investing turn into? | Final value, total contribution, profit, and the month your profit overtakes everything you put in |
| **Retirement Calculator** | Am I on course for the life I want after work? | The fund you'll need, what you're on track for, and three ways to close the gap |

### 📊 Financial Planning

| Calculator | Answers | You get |
|---|---|---|
| **Net Worth** | Where do I actually stand? | Assets minus liabilities across 19 lines, what you could reach this week, debt-to-asset verdict |
| **Emergency Fund** | How much should be standing by? | Your target from real essential spending, plus a recommended number of months for *your* situation |
| **Rent vs Buy** | Which leaves me better off? | The winner and by how much, the year buying pulls ahead, both sides costed to the stamp duty |

---

## What makes it Malaysian

This is the part a generic calculator gets wrong:

- **EPF** uses the Third Schedule — wages rounded to their RM20 band, contributions
  rounded up to the ringgit — not a flat 11% of salary.
- **SOCSO and EIS** follow the PERKESO tables with the RM6,000 ceiling.
- **PCB** uses LHDN's annualised method, including the separate treatment of a
  bonus as additional remuneration.
- **Hire purchase** is flat-rate under the Hire-Purchase Act 1967, with the
  Rule of 78 rebate on early settlement.
- **Housing loans** are worked on monthly rest, the basis a letter offer quotes.
- **DSR** runs your gross salary through the real statutory stack to get the net
  figure banks actually divide by, and counts a credit card at 5% of its balance.
- **Buying a house** is costed with real MOT stamp duty tiers, the solicitors'
  remuneration scale, loan-agreement stamp duty and SST.
- **Dividends** from EPF and ASB are weighted by the months you held the money,
  which is why the compound calculator has monthly / quarterly / yearly rests.

Figures for the payroll modules are calibrated against payroll.my (YA 2026) to
the sen.

---

## How to use it

1. Open `index.html`.
2. Pick a calculator from the sidebar. The chevron on the sidebar's edge
   collapses it to icons when you want the room.
3. Start typing. **There is no calculate button** — every figure updates on each
   keystroke.
4. The grey pills under a field are shortcuts, not separate inputs — tap one or
   type your own number.
5. **Reset** at the top of each panel restores that calculator's defaults and
   leaves the others alone.

---

## Your figures are kept

**Everything you type is saved in this browser as you type it.** Close the tab,
come back next week, and every calculator is as you left it — including which
one you were on. There is nothing to press.

**Scenarios** are named copies of one calculator. Fill in the home loan, press
**Save**, call it *35 years at 4%*; change the term and rate, save that as *30
years at 4.2%*. Both sit as chips under the panel head, one tap apart. A chip
lights up while the form matches it exactly, so the moment you change a figure
you can see you are looking at something new. Chips belong to their own
calculator — saving from the home loan panel files the home loan, nothing else.

**That is one browser, though.** Clearing your browsing data takes the lot, and
your phone knows nothing about your laptop. Two copies answer that, both in the
topbar:

| | |
|---|---|
| **Export** / **Import** | One `finsim-YYYY-MM-DD.json` file, downloaded and read back. Needs nothing set up. |
| **To Drive** / **From Drive** | The same file, kept in a folder in your own Google Drive. Needs a one-time setup — **[docs/DRIVE.md](docs/DRIVE.md)**. |

Import and **From Drive** both **replace** what is in this browser rather than
merging it, and both say what is in each copy and wait for you to agree first.
Merging would mean guessing which saved scenario is which, and a wrong guess
leaves you with two *Plan A*s that disagree.

---

## Reading the results

Every calculator lays out the same way, so once you can read one you can read all
thirteen:

- **The three tiles at the top** are the answer. The dark one is the headline
  figure; the two beside it are the numbers that explain it.
- **The bar** under them shows what the total is made of. Where two bars appear
  (net worth, retirement, rent vs buy) they share one scale, so the gap between
  them is the point.
- **The tables** can usually be flipped between Yearly and Monthly.
- **The blue notes** are not filler — they say what the calculator is assuming
  and where it stops being reliable.

---

## What it does not do

Deliberately not modelled, anywhere: RPGT on property sales, first-home stamp
duty exemptions, daily-rest interest, investment sequence risk, tax on investment
returns, and any bank's internal credit scoring.

Long projections are a direction, not a prediction. A retirement plan built on
30 years of assumed returns is worth redoing every few years with the figures you
actually hit.

**This is a planning tool, not financial advice.** For anything binding, check
with KWSP, LHDN or the bank itself.

---

## For developers

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies.

- The top ~1,000 lines of `app.js` are pure functions with no DOM access — the
  maths library. Everything below is one `renderX()` per module plus wiring.
- A single `renderAll()` recalculates every module on every keystroke, so no
  state can go stale.
- A module is four things: a nav button, a `<section class="module">`, a
  `renderX()`, and entries in `MODULES` and `FORM_DEFAULTS`. It needs nothing
  added to `save.js` — snapshots are taken by walking the section's own fields,
  so a new calculator is saved, backed up and scenario-able the day it lands.
  The exception is state kept *outside* the inputs (a "which box leads" flag,
  the EPF per-year rates): that goes in `captureExtras` / `applyExtras`.

**[MODULES.md](MODULES.md)** documents every calculator's inputs, formulas and
assumptions, the shared helper library, the conventions the whole app follows,
how to add a module, and how to test it.
