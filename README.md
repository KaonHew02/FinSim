# FinSim — what each module does and how it works

FinSim is thirteen Malaysian money calculators sharing one page. This document
explains every one of them: what question it answers, what you type in, what it
tells you, and the maths underneath — plus the assumptions each one is making,
because those matter more than the arithmetic.

---

## Contents

- [How the app is put together](#how-the-app-is-put-together)
- [The shared calculation library](#the-shared-calculation-library)
- **Tax** — [PCB](#1-pcb-calculator) · [Income Tax](#2-income-tax-calculator)
- **Loans** — [Home Loan](#3-home-loan) · [Car Loan](#4-car-loan) · [Personal Loan](#5-personal-loan) · [DSR](#6-dsr-calculator)
- **Savings** — [Savings Goal](#7-savings-goal) · [EPF](#8-epf-calculator) · [Compound Interest](#9-compound-interest) · [Retirement](#10-retirement-calculator)
- **Financial Planning** — [Net Worth](#11-net-worth) · [Emergency Fund](#12-emergency-fund) · [Rent vs Buy](#13-rent-vs-buy)
- [House rules every module follows](#house-rules-every-module-follows)
- [Adding a new module](#adding-a-new-module)
- [Testing without a browser](#testing-without-a-browser)
- [Where to change what](#where-to-change-what)

---

## How the app is put together

Three files, no build step, no dependencies. Open `index.html` and it runs.

| File | What lives there |
|---|---|
| `index.html` | The sidebar, and one `<section class="module">` per calculator |
| `app.js` | All the maths, then one `renderX()` per module, then the wiring |
| `style.css` | Design tokens at the top, then components, responsive rules last |

### The render loop

There is no submit button anywhere. On `DOMContentLoaded` the app binds `input`
and `change` on every field inside a `.panel` (plus the `.assume-grid` fields
that sit inside result blocks) to a single function:

```
renderAll()  →  renderPcb() · renderEpf() · renderIncomeTax() · renderLoan()
                renderCar() · renderPersonal() · renderDsr() · renderGoal()
                renderCompound() · renderRetirement() · renderNetWorth()
                renderFund() · renderRentBuy()
```

Every module recalculates on every keystroke. That sounds wasteful and isn't —
the hidden modules write to elements nobody is looking at, and the whole pass is
sub-millisecond. The benefit is that there is no such thing as stale state.

### The anatomy of a module

Every module is the same four things:

1. **A nav button** in the sidebar carrying `data-module="<id>"`.
2. **A `<section class="module" id="<id>">`** split into a sticky input `.panel`
   on the left and a `.results` column on the right.
3. **A `renderX()`** that reads the inputs, does the maths, and writes text into
   result elements by id.
4. **Entries in `MODULES`** (page title and subtitle) and `FORM_DEFAULTS` (what
   Reset restores).

Shared behaviours you'll see in every one:

- **Empty state** — while the essential input is blank the results column keeps
  the `is-empty` class, which shows the "enter something" note instead of a wall
  of `RM 0.00`. Each `renderX()` toggles it and returns early.
- **Segments** (`.seg`) — the pill rows. Clicking one writes its value into the
  field beside it; typing a value that matches a pill lights it back up. They are
  shortcuts into a field, never a separate input.
- **Leading pairs** — where two boxes describe one thing (ringgit vs percent
  deposit, months vs date, years vs months), a module-level flag remembers which
  box you touched last so the two don't overwrite each other mid-keystroke:
  `loanDownBy`, `carDownBy`, `carSettleBy`, `plTenureBy`, `goalTimeBy`, `rbDownBy`.
- **Painters** — table bodies are built by a `paintX()` helper rather than inline,
  so the same schedule table can be redrawn in yearly or monthly view.

---

## The shared calculation library

The top ~1,000 lines of `app.js` are pure functions with no DOM access. They are
the part worth trusting; everything below them is plumbing.

### Statutory (payroll)

| Function | What it does |
|---|---|
| `epfContribution(wage, rate)` | Third Schedule: takes the wage to the top of its RM20 band, applies the rate, rounds **up** to the next ringgit. Above RM20,000 uses the exact percentage. |
| `socsoContribution(wage, category)` | Derives the exact PERKESO Category-1 employer figure (1.75%) from a closed form, scales it to the chosen category, rounds to the nearest 5 sen. Wage ceiling RM6,000. |
| `eisContribution(wage)` | Band top × 0.2% − RM0.10, employer share equals employee share. Ceiling RM6,000. |
| `taxBands(chargeable)` | Slices chargeable income across the YA 2026 brackets, each slice taxed at its own rate. |
| `calculateLhdnAnnualTax(chargeable)` | Sums those slices, then applies the RM400 rebate if chargeable income is RM35,000 or less. |
| `calculatePcbTax(salary, bonus, epfRate)` | The annualised MTD method — see [PCB](#1-pcb-calculator). |
| `epfProjection({...})` | Year-by-year EPF balance with a dividend per year. |

### Loans

| Function | What it does |
|---|---|
| `loanInstalment(principal, rate, months)` | Standard amortisation: `P·i·(1+i)ⁿ / ((1+i)ⁿ−1)`, monthly rest. |
| `loanSchedule({...})` | Month-by-month principal/interest split, supporting an extra monthly payment and a one-off lump sum in a chosen month. Stops when the balance clears. |
| `hirePurchase(principal, flatRate, months)` | Flat-rate maths: `interest = principal × rate% × years`, instalment = total ÷ months. |
| `hirePurchaseSchedule({...})` | Even principal and even interest every month, last month absorbing the rounding. |
| `effectiveRate(principal, instalment, months)` | The reducing-balance rate that would demand the same instalment. No closed form exists, so it bisects 80 times. |
| `ruleOf78Rebate(charges, months, paid)` | Hire-Purchase Act 1967 rebate: `charges × n(n+1) / N(N+1)` where n is the months left. |
| `maxLoanReducing(instalment, rate, months)` | Runs the amortisation backwards — the present value of the instalments. |
| `maxLoanFlat(instalment, flatRate, months)` | `instalment × months ÷ (1 + rate% × years)`. |
| `loanYearRows(rows)` | Rolls monthly rows into one row per year. |

### Saving and growing

| Function | What it does |
|---|---|
| `savingsSchedule({...})` | Ordinary annuity: interest on the balance, then the deposit, at each month end. `settleLast` trims the final deposit so a target is hit exactly. |
| `goalDeposit({target, opening, rate, months})` | The deposit that turns `opening` into `target` in exactly `months`, solved in one step. Rounds **up** to the sen so the goal is never missed. |
| `monthsToGoal({target, opening, rate, monthly})` | How many months a chosen deposit takes. Returns −1 if 50 years isn't enough. |
| `compoundSchedule({..., everyMonths})` | Like the above, but interest **accrues** monthly and is only **credited** when the rest closes (1 = monthly, 3 = quarterly, 12 = yearly). Uncredited interest doesn't earn — that is what compounding frequency actually means. |
| `goalYearRows(rows)` | Yearly roll-up of a savings schedule. |

### Spending down

| Function | What it does |
|---|---|
| `drawdownFund({first, rate, inflation, months})` | Present value of a **growing annuity** — what a rising withdrawal for N months is worth on the day it starts. This is the "fund needed to retire" figure. |
| `drawdownIncome({fund, rate, inflation, months})` | The reverse: the first monthly withdrawal a given fund can carry to the end. |
| `drawdownSchedule({...})` | The retirement years month by month; withdrawal rises with inflation, capped at what is left, so a fund that runs dry stops paying instead of going negative. |

### Property

| Function | What it does |
|---|---|
| `bandedFee(amount, bands)` | A fee charged in slices, each at its own rate. |
| `buyingCosts(price, loan)` | MOT stamp duty (1/2/3/4% tiers), 0.5% loan-agreement stamp duty, the solicitors' scale charged on both the price and the loan, +8% SST, +RM2,000 disbursements. |
| `rentVsBuy({...})` | Runs both paths month by month from the same starting wallet. |

### View helpers

`money()` `fmt()` `pct()` `signed()` (shows a minus for negatives) `minus()`
(shows a minus only when there's something to deduct) `formatMonths()`
("22 years 4 months") `monthLabel()` `addMonths()` `set()` `num()` `segValue()`.

Rounding is deliberate throughout: `round2` to the sen, `ceilSen` rounds **up**
(used where rounding down would miss a target), `roundUp5` up to 5 sen (the MTD
rule), `round5` to the nearest 5 sen (SOCSO).

---

# The modules

## 1. PCB Calculator

**Answers:** what will actually land in my account this month?

**You put in:** basic salary, bonus/allowances this month, your EPF rate
(11/9/8%), employer EPF rate (13/12%), SOCSO category.

**It tells you:** net pay, every statutory deduction line by line, the split
between what you pay and what your employer pays on top, and a distribution bar
of where the gross went.

**How it works.** EPF is charged on salary *and* bonus; SOCSO and EIS on salary
only (both capped at a RM6,000 wage). PCB uses the LHDN annualised method:

1. Annualise the salary, subtract the RM9,000 individual relief and the EPF
   relief (capped at RM4,000 a year).
2. Tax that through the brackets, divide by 12, round **up** to 5 sen — that's
   the regular monthly MTD.
3. A bonus is additional remuneration: tax the whole year *including* the bonus,
   subtract the regular monthly MTD × 12, and deduct the difference in full in
   the month the bonus is paid.

**Assumptions.** Resident individual, YA 2026 brackets. Only the individual and
EPF reliefs are applied to PCB, matching payroll.my's output — SOCSO relief is
not. The figures are calibrated against payroll.my to the sen.

---

## 2. Income Tax Calculator

**Answers:** what do I owe for the year, and which relief is actually worth
chasing?

**You put in:** annual income, then any of the ~20 LHDN relief lines
(`RELIEF_GROUPS`), each with its own cap.

**It tells you:** chargeable income, tax band by band, the RM400 rebate if it
applies, effective vs marginal rate, and a per-relief breakdown showing what
each line actually contributed after its cap.

**How it works.** Reliefs are summed with each cap enforced independently —
claiming above a cap wastes the excess rather than spilling into another line.
Relief types are `fixed` (granted automatically), `flag` (you qualify or you
don't), `count` (per child/dependant, multiplied by a unit) and `amount`
(what you spent, capped). Chargeable income goes through `taxBands()`, and the
RM400 rebate applies when chargeable income is RM35,000 or less.

**Assumptions.** Resident individual. Caps move with every Budget, so
`RELIEF_GROUPS` is the single place to update them.

---

## 3. Home Loan

**Answers:** what does the bank ask for every month, and how much of it never
touches the loan?

**You put in:** property price, deposit (ringgit or percent), rate, tenure, and
optionally an extra monthly payment and a one-off lump sum in a chosen year.

**It tells you:** the instalment, total interest over the term, the total handed
over, what the extra payments save in ringgit and in years, and the full
amortisation schedule (yearly or monthly).

**How it works.** `loanInstalment()` for the payment, `loanSchedule()` for the
run. Extra payments are applied to principal each month, so the schedule simply
ends early — the saving is the difference between the two totals.

**Assumptions.** Monthly rest, which is how a letter offer is quoted. Malaysian
housing loans are actually charged on daily rest, which moves each month's
interest by a few ringgit but leaves the totals within rounding. Margin of
finance is capped at 90%, tenure at 50 years.

---

## 4. Car Loan

**Answers:** hire purchase is quoted flat — what does that instalment really
cost?

**You put in:** car price, deposit, flat rate, tenure, and a settlement point.

**It tells you:** the instalment, the term charges, **the effective reducing
rate** (roughly double the flat rate on the quote), what settling early costs
after the Rule of 78 rebate, and the payment schedule.

**How it works.** `hirePurchase()` computes interest as
`principal × flat% × years` — charged on the *whole* original amount for the
*whole* term, regardless of how much you've repaid. That's why
`effectiveRate()`, which finds the reducing-balance rate demanding the same
instalment, comes out near double. Early settlement uses `ruleOf78Rebate()`:
interest is treated as earned fastest at the start, so half way through a 7-year
loan the rebate returns barely a quarter of the charges.

**Assumptions.** Fixed-rate hire purchase under the Hire-Purchase Act 1967.
Tenure capped at 9 years, margin at 90%.

---

## 5. Personal Loan

**Answers:** an unsecured loan quoted flat — what is the instalment, and what
does the rate really mean?

**You put in:** amount, tenure (years or months), rate, a Flat/Reducing toggle,
processing fees, and a settlement month.

**It tells you:** the instalment on both bases side by side, the effective rate
behind a flat quote, total cost including the 0.5% loan-agreement stamp duty and
any fees, early-settlement figures, and the schedule.

**How it works.** Flat basis reuses the hire-purchase maths; reducing basis uses
the ordinary loan maths. The comparison block runs both on the same rate so the
gap is visible. Default is Flat, because that is how Malaysian banks quote.

**Assumptions.** Tenure capped at 10 years. Rate guidance is written as ranges
(banks 7–13% flat, public-sector schemes 3.5–5%) rather than per-bank figures.

---

## 6. DSR Calculator

**Answers:** how much more will a bank actually lend me?

**You put in:** income (gross or net), fixed allowances, variable income and how
much of it to count, employment type, the DSR cap to test against, and every
existing commitment — home, car, personal, PTPTN, credit card balance, other.

**It tells you:** your net income the way a bank computes it, your DSR, which
band that falls in, your net disposable income, the monthly room left before the
cap, and what that room could borrow as a home, car or personal loan.

**How it works.** This is the module that ties the app together:

1. If you give gross income, it runs the **PCB module's own statutory stack** —
   `epfContribution` (at 11%), `socsoContribution`, `eisContribution`,
   `calculatePcbTax` — to get the net figure banks divide by.
2. Variable income is discounted by the percentage you choose (default 80%).
3. Commitments are summed, with a credit card counted at **5% of its balance**
   whatever the bank's own minimum happens to be.
4. `DSR = commitments ÷ net income`, placed in a band from *Comfortable* to
   *Over-extended*.
5. Room = `net × cap − commitments`, then `maxLoanReducing()` / `maxLoanFlat()`
   turn that room into a borrowable amount for each of the three loan shapes.

**Assumptions.** Caps (private 60%, GLC 70%, government 80%) are typical
ceilings, not rules — a civil servant repaying through BPA gets the highest
because the instalment is taken before the pay arrives. Banks also apply their
own income haircuts and stress rates this doesn't model.

---

## 7. Savings Goal

**Answers:** what does it take every month to have the money by the time I need
it?

**You put in:** target amount, what's already saved, a deadline (months **or** a
date — either one fills the other), expected return, and optionally "what I can
actually spare" to test a smaller deposit.

**It tells you:** the monthly deposit needed, where the final balance came from
(head start / deposits / growth), and — if you can't manage that deposit — how
much later you'd arrive and how far short you'd be on the deadline.

**How it works.** `goalDeposit()` solves the annuity in one step rather than by
trial and error. `savingsSchedule()` runs it out with `settleLast`, trimming the
final deposit so rounding doesn't leave you a few sen over. The affordability
block uses `monthsToGoal()`.

**Assumptions.** Deposits land at the end of each month, which is how a standing
instruction behaves. The default return is 0% on purpose: for a goal with a fixed
date, growth should be a bonus, not the plan.

---

## 8. EPF Calculator

**Answers:** what goes in each month, and what does it grow into by the time I
can touch it?

**You put in:** salary, your rate and your employer's, any voluntary top-up,
current balance, your age, the age to project to (default 55), annual salary
growth, and a dividend rate — which you can then override **year by year** in
the projection table.

**It tells you:** the monthly and yearly contribution, how each month's money
splits across Akaun 1 / 2 / 3 (75 / 15 / 10 since the May 2024 restructure), and
a year-by-year projection to the age you chose.

**How it works.** `epfProjection()` credits the dividend once a year on the
balance held through the year: the opening balance earns for all twelve months,
while each month's contribution only earns for the months left after it lands.
Across twelve equal contributions that averages **5.5/12** of a full year's
dividend, which is the aggregate EPF itself works to. Salary rises once at each
year end, so the next year's contribution is computed on the new wage.

**Assumptions.** EPF declares a rate every year and never announces it in
advance, which is why the table takes one rate per year rather than holding a
single figure flat. Conventional savings only — no simpanan shariah split.

---

## 9. Compound Interest

**Answers:** what does regular investing actually turn into, and how much of that
is mine versus the market's?

**You put in:** initial investment, monthly contribution, expected annual return,
investment period, how often interest is credited (monthly / quarterly / yearly),
and an inflation rate.

**It tells you:** final value, total contribution, investment profit, the month
your profit overtakes everything you put in, what the balance is worth in today's
money, a lever table (RM100 more a month · 1% better return · 5 more years ·
starting later), and the year-by-year run.

**How it works.** `compoundSchedule()` accrues interest every month but only
credits it when the rest closes. Money waiting for the credit date earns simple
interest and does not compound — which is exactly how EPF and ASB weight an
annual dividend by the months you held the money. At monthly rests it matches the
textbook annuity formula to the sen.

**Assumptions.** Contributions at each month end. At yearly rests this reads
slightly **higher** than calculators like StashAway's, which give within-year
contributions no interest at all; the Malaysian month-weighted treatment is the
more accurate one here.

---

## 10. Retirement Calculator

**Answers:** what does the life I want after work cost, and am I on course for
it?

**You put in:** the monthly income you want **in today's ringgit**, any other
income you'll have then (pension, rental), your age now and the age you stop,
how long the money must last, what's saved so far, what goes in monthly, a
return while working and a **lower** return after you retire, and inflation.

**It tells you:** the fund you need on the day you retire, what you're on track
for, the gap, how far your current path actually pays you ("until age 74 — 10
years short"), and three ways to close the gap: save more, work longer, or want
less.

**How it works.** Two phases back to back:

1. **Accumulation** — `compoundSchedule()` from today to your retirement age.
2. **The target** — your wanted income is inflated to the day you retire, then
   `drawdownFund()` takes the present value of that rising withdrawal over the
   retirement years at the post-retirement return.
3. **The gap** closes three ways: `goalDeposit()` for the contribution needed, a
   break-even-age search that walks both directions (short → work longer;
   surplus → stop earlier), and `drawdownIncome()` deflated back to today for the
   income your plan actually supports.

**Assumptions.** The post-retirement return is deliberately lower — money you're
living off can't sit through a bad decade waiting to recover. Withdrawals rise
with inflation every month. Nothing here models market sequence risk, EPF
withdrawal rules, or a lump-sum splurge at 55.

---

## 11. Net Worth

**Answers:** where do I actually stand?

**You put in:** 19 lines across five groups — *cash & bank*, *investments*,
*property & vehicles* against *long-term debt* and *short-term debt* — following
the AKPK calculator's own grouping. Optionally your monthly spending, monthly
income and age.

**It tells you:** net worth, total assets, total liabilities, what each line is
worth as a share of its side, the money you could reach this week, how many
months that covers, what's locked in EPF, debt against assets with a plain
verdict, a par figure for your age and income, and every filled line sorted
biggest first.

**How it works.** The panel is generated from `NET_WORTH_GROUPS` by
`buildNetWorthUI()` rather than written out as markup — which is also why
`FORM_DEFAULTS.networth` is generated from the same list. The two distribution
bars share **one scale**: the debt bar's width is a fraction of the asset bar, so
the gap between them is the picture. The par figure is the old rule of thumb,
`age × annual income ÷ 10`.

**Assumptions.** Everything is valued at what it would sell for today and every
debt at what it would cost to settle today. EPF counts fully in net worth but is
deliberately excluded from "money you could reach this week" — it's real, it's
just not available until 55.

---

## 12. Emergency Fund

**Answers:** how much should be standing by before a bad month turns into a bad
year?

**You put in:** eight lines of essential monthly spending (housing, food,
utilities, transport, insurance, loan minimums, family, other), the months of
cover you want, three questions about your situation, what's already set aside,
what you save monthly, and what it earns.

**It tells you:** the fund you need, what's still to find, how many months you're
covered for right now, when you'll get there at your current rate, what it'd take
to finish inside a year, and a recommended number of months for a household like
yours — with the reasoning spelled out.

**How it works.** Target is simply `essential spending × months`. The plan reuses
the savings-goal helpers: `monthsToGoal()` for the arrival date, `goalDeposit()`
for the twelve-month pace, `savingsSchedule()` + `paintGoalSchedule()` for the
table. The recommendation comes from `suggestedCover()`:

| Starting point | 3 months |
|---|---|
| Contract work | +2 |
| Own business | +3 |
| One income in the house | +1 |
| 1–2 dependants | +1 |
| 3 or more dependants | +2 |

capped at 12. The reasons are collected as you go and read back as a sentence.

**Assumptions.** "Essential" means what you cannot stop paying, not your current
spending. The money is assumed to be somewhere you can reach the same day, which
is why the default return is only 2.5% — an emergency fund is insurance you
happen to own, not an investment.

---

## 13. Rent vs Buy

**Answers:** over the years I'd actually stay, which one leaves me better off?

**You put in:** rent and how fast it rises, property price, deposit, loan rate
and term, how long you stay, property growth, upkeep, selling costs, and the
return on cash you don't sink into a house.

**It tells you:** which wins and by how much, what each path leaves you holding,
the year buying pulls ahead, a full cost breakdown of both sides, and a
year-by-year table of what you'd walk away with.

**How it works.** Both sides are held to the same standard — that's the whole
trick. `rentVsBuy()` runs monthly:

- **The buyer** pays the instalment and the upkeep; the house grows; their worth
  is `value − loan outstanding − selling costs`.
- **The renter** starts holding the deposit *and* the entry fees the buyer spent,
  and each month invests the difference between the buyer's outlay and the rent.
  If the rent is higher than the buyer's outlay, the pot is drawn down instead —
  which is what really happens.

Entry costs come from `buyingCosts()` and are the real Malaysian ones: MOT stamp
duty in 1/2/3/4% tiers, 0.5% on the loan agreement, the solicitors' remuneration
scale charged on both the price and the loan, plus 8% SST and RM2,000 of
disbursements. On a RM500,000 place with a RM450,000 loan that's RM9,000 +
RM2,250 + RM14,825.

**Assumptions.** RPGT is **not** modelled (30% of the gain inside three years,
tapering to nil from the sixth) and neither are first-home stamp duty exemptions
— both are called out in the panel hints. The renter is assumed to genuinely
invest the difference; spent instead, they end with nothing.

---

## House rules every module follows

| Rule | Why |
|---|---|
| Money in, money out at **month end** | Matches a standing instruction, a salary deduction and a loan instalment. |
| **Monthly rest** on loans | The basis a letter offer is quoted on. |
| Rates are given as **annual nominal**, divided by 12 | Consistent everywhere, and what banks and funds quote. |
| Amounts you want are stated in **today's ringgit** | Inflation is applied by the module, so you never have to guess at future prices. |
| `round2` at every step of a schedule | The totals match the rows a reader could add up by hand. |
| Rounding **up** where a shortfall would matter | `goalDeposit` and MTD both round up, so a target is never missed by a sen. |
| Nothing is stored | No localStorage, no server. Reloading the page starts clean. |

**Deliberately not modelled anywhere:** RPGT, first-home stamp duty exemptions,
daily-rest interest, market sequence risk, tax on investment returns, and any
bank's internal credit scoring.

---

## Adding a new module

1. **Sidebar** — add a `<button class="nav-item" data-module="x-module">` in the
   right group.
2. **Section** — add `<section id="x-module" class="module">` with the standard
   `.split` → `.panel` + `.results` shape, an `.empty-note`, and a
   `.results-body`.
3. **Maths** — put pure functions with the other model code, above the view
   helpers. No DOM access there.
4. **`renderX()`** — read inputs with `num()` / `segValue()`, write results with
   `set()`, and toggle `is-empty` on the essential input.
5. **Register it** — add to `renderAll()`, `MODULES` (title + subtitle) and
   `FORM_DEFAULTS` (what Reset restores).
6. **Segments** — if a pill row feeds a field, add the one-liner to the `.seg`
   click handler.

If the panel is a long list of money lines, generate it from an array the way
`buildNetWorthUI()` does — the defaults can then be generated from the same list.

---

## Testing without a browser

The app can't be driven by the in-app preview pane, so it's tested by driving the
real DOM through jsdom:

```js
const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync('app.js', 'utf8'));
dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));

// click a nav button, fire `input` events on fields, then read result ids back
```

Worth checking every time: the closed-form answer for the maths, the empty state,
a zero-rate case, the extremes (nothing saved, already past the target, negative
net worth), both table views, the presets, and Reset.

---

## Where to change what

| When this changes | Edit |
|---|---|
| Tax brackets or the rebate | `TAX_BRACKETS`, `REBATE_CEILING`, `REBATE_AMOUNT` |
| A relief cap, or a new relief | `RELIEF_GROUPS` (the UI builds itself from it) |
| SOCSO categories or the ceiling | `SOCSO_CATEGORIES`, `socsoBaseEmployer` |
| EPF account split | `EPF_ACCOUNTS` |
| DSR caps or bands | `DSR_CAPS`, `DSR_BANDS`, `CARD_MIN_RATE` |
| Stamp duty or legal fee scales | `MOT_STAMP_BANDS`, `LEGAL_FEE_BANDS`, `LOAN_STAMP_RATE`, `LEGAL_SST`, `LEGAL_EXTRAS` |
| Net worth or emergency fund line items | `NET_WORTH_GROUPS`, `EF_ITEMS` |
| Colours, spacing, the collapsed rail | design tokens at the top of `style.css`, then `.app.is-rail` |
