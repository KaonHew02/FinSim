/**
 * ====================================================================
 * FinSim — Malaysia money calculators
 * --------------------------------------------------------------------
 * Figures are calibrated to match https://payroll.my/ (YA 2026):
 *   - EPF (KWSP)  : Third Schedule, RM20 wage bands rounded up to ringgit
 *   - SOCSO       : PERKESO categories, ceiling RM6,000
 *   - EIS (SIP)   : Ceiling RM6,000, employer share equals employee share
 *   - PCB (MTD)   : Annualised tax method, rounded up to the nearest 5 sen
 *
 * Everything recalculates live as the user types — there is no submit step.
 * ====================================================================
 */

const round2   = (x) => Math.round(x * 100) / 100;
const ceilSen  = (x) => Math.ceil(x * 100 - 1e-6) / 100;    // round UP to the sen, so a target is never missed by rounding
const roundUp5 = (x) => Math.ceil(x * 20 - 1e-9) / 20;      // round UP to nearest 5 sen (MTD rule); epsilon absorbs float noise
const round5   = (x) => round2(Math.round(x / 0.05) * 0.05); // round to NEAREST 5 sen (SOCSO)

/**
 * EPF (KWSP) employee/employer contribution via the Third Schedule.
 * Wages up to RM20,000 are taken to the top of their RM20 band, multiplied by
 * the rate, then rounded up to the next ringgit. Above RM20,000 the exact
 * percentage is used (KWSP allows exact-percentage only beyond RM20,000).
 */
function epfContribution(wage, ratePercent) {
    if (wage <= 0 || ratePercent <= 0) return 0;
    if (wage > 20000) return round2(wage * ratePercent / 100);
    const bandTop = Math.ceil(wage / 20) * 20;
    return Math.ceil(bandTop * ratePercent / 100);
}

/**
 * How every new contribution is divided across the three EPF accounts under the
 * restructure that took effect in May 2024.
 */
const EPF_ACCOUNTS = [
    { id: 'Akaun1', share: 0.75 },
    { id: 'Akaun2', share: 0.15 },
    { id: 'Akaun3', share: 0.10 },
];

/**
 * Year-by-year EPF projection.
 *
 * Dividend is declared once a year and credited on the balance held through the
 * year: the opening balance earns for all twelve months, while each month's
 * contribution only earns for the months left after it lands. Across twelve
 * equal contributions that averages 5.5/12 of a full year's dividend, which is
 * the aggregate EPF itself works to.
 *
 * EPF sets a new rate every year and never announces it in advance, so `rates`
 * carries one rate per projected year rather than a single figure held flat.
 *
 * The salary is raised once at the end of each year, so the contribution rate is
 * re-applied to the new wage the year after.
 */
function epfProjection({ salary, selfRate, employerRate, voluntary, opening, age, untilAge, growth, rates }) {
    const years = Math.max(0, Math.round(untilAge) - Math.round(age));
    const rows = [];

    let wage = salary;
    let balance = opening;
    let paidIn = 0;
    let dividends = 0;

    for (let year = 0; year < years; year++) {
        const rate        = Math.max(0, rates[year] || 0);
        const monthly     = epfContribution(wage, selfRate) + epfContribution(wage, employerRate) + voluntary;
        const contributed = round2(monthly * 12);
        const dividend    = round2((balance + contributed * 5.5 / 12) * rate / 100);

        balance = round2(balance + contributed + dividend);
        paidIn += contributed;
        dividends += dividend;

        rows.push({ age: Math.round(age) + year + 1, wage, contributed, rate, dividend, balance });
        wage = round2(wage * (1 + growth / 100));
    }

    return { rows, years, paidIn: round2(paidIn), dividends: round2(dividends), balance: round2(balance) };
}

/**
 * PERKESO SOCSO categories (wage ceiling RM6,000). Rates are % of the wage
 * band. Every contribution is derived from the exact Category-1 employer value
 * (1.75%) scaled to the category rate, then rounded to the nearest 5 sen —
 * which reproduces payroll.my's figures to the sen.
 *
 * "Lindung 24" is optional 24-hour coverage that adds 0.75% to the employee
 * share. payroll.my defaults to the Injury+Invalidity+Lindung 24 category, so
 * that is the default here too.
 */
const SOCSO_CATEGORIES = {
    '3': { label: 'Employment Injury & Invalidity & Lindung 24', employer: 1.75, employee: 1.25 },
    '4': { label: 'Employment Injury & Lindung 24',              employer: 1.25, employee: 0.75 },
    '0': { label: 'Employment Injury & Invalidity',              employer: 1.75, employee: 0.50 },
    '1': { label: 'Employment Injury Only',                      employer: 1.25, employee: 0.00 },
    '2': { label: 'No Contribution',                             employer: 0.00, employee: 0.00 },
};
const DEFAULT_SOCSO_CATEGORY = '3';

// Exact PERKESO Category-1 employer contribution (1.75%), ceiling RM6,000.
// The RM100-band region alternates +1.80/+1.70 per band; this closed form
// reproduces the published table exactly.
function socsoBaseEmployer(wage) {
    const w = Math.min(wage, 6000);
    if (w <= 0) return 0;
    const low = [ [30, 0.40], [50, 0.70], [70, 1.10], [100, 1.50], [140, 2.10], [200, 2.95] ];
    for (const [top, er] of low) if (w <= top) return er;
    const bandTop = Math.ceil(w / 100) * 100;
    const k = (bandTop - 300) / 100;
    return round2(4.35 + Math.floor(k / 2) * 3.50 + (k % 2) * 1.80);
}

function socsoContribution(wage, categoryKey) {
    const cat = SOCSO_CATEGORIES[categoryKey] || SOCSO_CATEGORIES[DEFAULT_SOCSO_CATEGORY];
    const base = socsoBaseEmployer(wage);
    const scale = (rate) => rate === 0 ? 0 : round5(base * (rate / 1.75));
    return { employer: scale(cat.employer), employee: scale(cat.employee) };
}

/**
 * EIS (SIP) contribution. Wage ceiling RM6,000. Employer share = employee share.
 */
function eisContribution(wage) {
    const w = Math.min(wage, 6000);
    if (w <= 0) return { employer: 0, employee: 0 };
    const low = [ [30, 0.05], [50, 0.10], [70, 0.15], [100, 0.20], [140, 0.25], [200, 0.35] ];
    for (const [top, val] of low) if (w <= top) return { employer: val, employee: val };
    const bandTop = Math.ceil(w / 100) * 100;
    const val = round2(bandTop * 0.002 - 0.10);
    return { employer: val, employee: val };
}

/**
 * YA 2026 resident individual bands. `upTo` is the top of the band; each band's
 * rate applies only to the slice of chargeable income inside it. A RM400 rebate
 * applies when chargeable income is RM35,000 or less.
 */
const TAX_BRACKETS = [
    { upTo: 5000,     rate: 0.00 },
    { upTo: 20000,    rate: 0.01 },
    { upTo: 35000,    rate: 0.03 },
    { upTo: 50000,    rate: 0.06 },
    { upTo: 70000,    rate: 0.11 },
    { upTo: 100000,   rate: 0.19 },
    { upTo: 400000,   rate: 0.25 },
    { upTo: 600000,   rate: 0.26 },
    { upTo: 2000000,  rate: 0.28 },
    { upTo: Infinity, rate: 0.30 },
];
const REBATE_CEILING = 35000;
const REBATE_AMOUNT  = 400;

/**
 * LHDN personal reliefs for a resident individual.
 *
 * Each entry is one line on the BE form. Caps are per year of assessment and are
 * enforced independently — claiming above a cap simply wastes the excess.
 *
 *   fixed  — granted automatically, not editable
 *   flag   — you either qualify for the full amount or you don't
 *   count  — a per-head relief; the entered number is multiplied by `unit`
 *   amount — enter what you spent; the relief is capped at `cap`
 *
 * `detail` / `examples` / `excludes` populate the expandable "What counts?" panel.
 * Caps move with each Budget, so this table is the single place to update them.
 */
const RELIEF_GROUPS = [
    {
        title: 'You & your family',
        items: [
            {
                id: 'self', type: 'fixed', amount: 9000,
                label: 'Individual & dependent relatives',
                note: 'Granted automatically to every resident',
                detail: 'Every resident taxpayer gets this without claiming or documenting anything. It is meant to cover your own basic living costs and any relatives you support.',
                examples: ['Already included in your total — nothing to enter', 'You get the full RM9,000 even if you only worked part of the year'],
            },
            {
                id: 'disabledSelf', type: 'flag', amount: 7000,
                label: 'Disabled individual',
                note: 'Certified and registered with JKM',
                detail: 'For a taxpayer certified as a person with disability (OKU). This is claimed on top of the RM9,000 individual relief, not instead of it.',
                examples: ['You hold a JKM OKU registration card', 'Certification must be in place during the assessment year'],
            },
            {
                id: 'spouse', type: 'flag', amount: 4000,
                label: 'Spouse or alimony',
                note: 'Spouse has no income, or you pay alimony',
                detail: 'Claim if your spouse had no income for the year, if you elect for joint assessment, or if you pay alimony to a former spouse.',
                examples: ['Spouse is a homemaker with no income of their own', 'Spouse earned only income that is tax exempt', 'Alimony paid under a formal agreement or court order'],
                excludes: ['Voluntary payments to a former spouse with no formal agreement'],
            },
            {
                id: 'disabledSpouse', type: 'flag', amount: 6000,
                label: 'Disabled spouse',
                note: 'On top of the spouse relief',
                detail: 'An additional relief where your spouse is a registered OKU. Claim it alongside the RM4,000 spouse relief, not instead of it.',
                examples: ['Spouse holds a JKM OKU registration card'],
            },
            {
                id: 'childUnder18', type: 'count', unit: 2000,
                label: 'Children under 18, or 18+ in pre-university study',
                note: 'Unmarried children',
                detail: 'RM2,000 for each unmarried child. It covers any child under 18, and also a child aged 18 or over who is still in full-time pre-university education.',
                examples: ['A child who turned 18 partway through the year still counts', 'A-levels, matriculation, foundation and certificate courses', 'Legally adopted children count the same as natural children', 'If you and your spouse are assessed separately, each of you claims 50%'],
                excludes: ['A child who is married', 'Diploma level and above — use the RM8,000 line instead'],
            },
            {
                id: 'childTertiary', type: 'count', unit: 8000,
                label: 'Children 18+ in tertiary study',
                note: 'Diploma level and above',
                detail: 'RM8,000 for each unmarried child aged 18 or over in full-time higher education — diploma level or above in Malaysia, or degree level or above overseas.',
                examples: ['Diploma, bachelor degree, master or PhD at a recognised institution', 'Overseas study must be at degree level or higher to qualify here'],
                excludes: ['Pre-university courses — those fall under the RM2,000 line'],
            },
            {
                id: 'childDisabled', type: 'count', unit: 6000,
                label: 'Disabled children',
                note: 'Any age, registered with JKM',
                detail: 'RM6,000 for each disabled child at any age. If that child is also 18 or over and studying at diploma level or above, claim the RM8,000 tertiary relief as well.',
                examples: ['Child holds a JKM OKU registration card', 'A disabled child in university can be claimed on both lines'],
            },
        ],
    },
    {
        title: 'Savings & insurance',
        items: [
            {
                id: 'epf', type: 'amount', cap: 4000,
                label: 'EPF & approved provident funds',
                note: 'Your own contributions for the year',
                detail: 'Your own contributions to EPF or another approved provident fund. Only the employee share counts — what your employer puts in is not yours to claim.',
                examples: ['The 11% employee EPF deducted from your monthly salary', 'Voluntary top-ups into your own EPF account', 'On a normal salary you will pass RM4,000 well before December'],
                excludes: ['The employer share of EPF', 'SOCSO and EIS — those have their own RM350 line'],
            },
            {
                id: 'lifeIns', type: 'amount', cap: 3000,
                label: 'Life insurance & takaful',
                note: 'Separate from the EPF cap',
                detail: 'Premiums on life insurance or family takaful covering you or your spouse. This is a separate pot from EPF, so you can fill both.',
                examples: ['Whole-life, term-life and endowment premiums', 'Family takaful contributions', 'Pensionable civil servants share a single RM7,000 limit with EPF instead'],
                excludes: ['Medical and education policies — those go on the next-but-one line'],
            },
            {
                id: 'prs', type: 'amount', cap: 3000,
                label: 'PRS & deferred annuity',
                note: 'Private retirement schemes',
                detail: 'Contributions to an approved Private Retirement Scheme or a deferred annuity plan. Voluntary retirement saving on top of EPF.',
                examples: ['PRS funds bought through an approved provider', 'Deferred annuity plans from a licensed insurer'],
            },
            {
                id: 'eduMedIns', type: 'amount', cap: 3000,
                label: 'Education & medical insurance',
                note: 'Premiums for you, spouse or child',
                detail: 'Premiums on education or medical insurance policies covering you, your spouse or your child.',
                examples: ['Standalone medical card premiums', 'The medical rider portion of a life policy', 'Education policies taken out for a child'],
            },
            {
                id: 'socso', type: 'amount', cap: 350,
                label: 'SOCSO & EIS contributions',
                note: 'Your employee share',
                detail: 'Your employee share of SOCSO and EIS for the year. Small, but it is its own line — do not fold it into the EPF claim.',
                examples: ['Add up the SOCSO and EIS deducted on your payslips', 'Most full-time employees pass RM350 easily and simply claim the cap'],
            },
            {
                id: 'sspn', type: 'amount', cap: 8000,
                label: 'SSPN net savings',
                note: 'Deposits minus withdrawals for the year',
                detail: 'Net deposits into Skim Simpanan Pendidikan Nasional accounts for your children. Net means deposits made during the year minus anything withdrawn.',
                examples: ['Deposited RM10,000 and withdrew RM3,000 gives a RM7,000 claim', 'Balances carried over from earlier years do not count again'],
                excludes: ['A year where you withdrew more than you put in gives nothing'],
            },
        ],
    },
    {
        title: 'Medical',
        items: [
            {
                id: 'medSerious', type: 'amount', cap: 10000,
                label: 'Serious illness, fertility & check-ups',
                note: 'Sub-limits apply inside this cap',
                detail: 'Medical costs for you, your spouse or your child. Several separate things share this one RM10,000 pot, and some of them have their own smaller sub-limit inside it.',
                examples: ['Treatment for cancer, heart disease, kidney failure and other listed serious illnesses', 'Fertility treatment including IVF', 'Full medical check-up, vaccination and dental treatment — each sub-limited', 'Assessment and intervention for a child with a learning disability'],
                excludes: ['Anything already reimbursed by your employer or insurer'],
            },
            {
                id: 'medParents', type: 'amount', cap: 8000,
                label: 'Medical & care for parents',
                note: 'Treatment, special needs and carer expenses',
                detail: 'Medical treatment, special needs and carer expenses for your own parents. Keep the receipts and the practitioner certification.',
                examples: ['Doctor and hospital bills paid on their behalf', 'Nursing home fees or a home carer', 'A full medical check-up for a parent, sub-limited within the cap'],
                excludes: ['Parents-in-law', 'Everyday living costs such as food and utilities'],
            },
            {
                id: 'equipment', type: 'amount', cap: 6000,
                label: 'Supporting equipment for the disabled',
                note: 'For you, spouse, child or parent',
                detail: 'Basic supporting equipment for a disabled you, spouse, child or parent. The person it is for must be registered with JKM.',
                examples: ['Wheelchair, artificial limb, crutches', 'Hearing aids and other assistive devices'],
                excludes: ['Spectacles and optical lenses'],
            },
        ],
    },
    {
        title: 'Lifestyle, education & home',
        items: [
            {
                id: 'lifestyle', type: 'amount', cap: 2500,
                label: 'Lifestyle',
                note: 'Books, computer, phone, internet, courses',
                detail: 'A broad catch-all for personal purchases. Everything below shares the same RM2,500 pot, so one laptop can use it up on its own.',
                examples: ['Books, journals, magazines and printed newspapers', 'Computer, smartphone or tablet for personal use', 'Monthly internet subscription registered in your name', 'Self-improvement and skill courses'],
                excludes: ['Anything bought for business use', 'Sports gear and gym membership — those have their own RM1,000 line'],
            },
            {
                id: 'sports', type: 'amount', cap: 1000,
                label: 'Sports gear, facilities & training',
                note: 'Separate from the lifestyle cap',
                detail: 'A separate RM1,000 pot for sports spending, claimable on top of the lifestyle relief.',
                examples: ['Sports equipment such as racquets, bicycles and running shoes', 'Gym membership and sports facility rental', 'Entry fees for approved competitions', 'Sports training and coaching fees'],
                excludes: ['Motorised equipment', 'Ordinary clothing and footwear not made for sport'],
            },
            {
                id: 'eduSelf', type: 'amount', cap: 7000,
                label: 'Education fees for yourself',
                note: 'Recognised institutions only',
                detail: 'Course fees for your own study at an institution recognised by the Malaysian government. Part of the cap is ring-fenced for short upskilling courses.',
                examples: ['Master or doctorate in any field of study', 'Degree or diploma in law, accounting, technical, vocational, scientific or technological fields', 'Up to RM2,000 of the RM7,000 can go to any upskilling or self-enhancement course'],
                excludes: ['Fees for your spouse or children', 'Unrecognised or unaccredited providers'],
            },
            {
                id: 'childcare', type: 'amount', cap: 3000,
                label: 'Childcare & kindergarten fees',
                note: 'Registered centre, child aged 6 and below',
                detail: 'Fees paid to a registered childcare centre or kindergarten for a child aged 6 and below.',
                examples: ['TASKA registered with JKM', 'TADIKA registered with the Ministry of Education'],
                excludes: ['Babysitters, nannies and unregistered minders', 'Both parents claiming the same child when assessed separately — only one may claim'],
            },
            {
                id: 'breastfeed', type: 'amount', cap: 1000,
                label: 'Breastfeeding equipment',
                note: 'Claimable once every two years',
                detail: 'Breastfeeding equipment for your own use, for a child aged 2 and under. Claimable once every two years, so if you claimed last year you cannot claim again this year.',
                examples: ['Breast pump and collection kit', 'Cooler bag, ice pack and milk storage containers'],
                excludes: ['Fathers — this relief is for mothers only'],
            },
            {
                id: 'evCharge', type: 'amount', cap: 2500,
                label: 'EV charging facility',
                note: 'Installation, rental, purchase or subscription',
                detail: 'The cost of an electric vehicle charging facility for your own use.',
                examples: ['Installing a charger at home', 'Purchase, rental, hire-purchase or subscription fees for the charging facility'],
                excludes: ['The electricity you use', 'Anything installed for business use'],
            },
            {
                id: 'homeLoan', type: 'amount', cap: 7000,
                label: 'Housing loan interest',
                note: 'First residential home, conditions apply',
                detail: 'Interest paid on a housing loan for your first residential home. The cap depends on the price of the property, and the scheme only applies to purchases made inside a limited window — check the current LHDN conditions before relying on this one.',
                examples: ['Interest charged on the loan during the year', 'The lower cap applies to higher-priced properties'],
                excludes: ['Principal repayments', 'A second or subsequent property'],
            },
        ],
    },
];

const RELIEF_ITEMS = RELIEF_GROUPS.flatMap((group) => group.items);

/** Per-band slice of a chargeable income — drives both the total and the UI table. */
function taxBands(chargeableIncome) {
    const bands = [];
    let lower = 0;
    for (const bracket of TAX_BRACKETS) {
        if (chargeableIncome <= lower) break;
        const amount = Math.min(chargeableIncome, bracket.upTo) - lower;
        bands.push({ from: lower, to: bracket.upTo, rate: bracket.rate, amount, tax: round2(amount * bracket.rate) });
        lower = bracket.upTo;
    }
    return bands;
}

function calculateLhdnAnnualTax(chargeableIncome) {
    if (chargeableIncome <= 0) return 0;
    const gross = round2(taxBands(chargeableIncome).reduce((sum, b) => sum + b.tax, 0));
    return chargeableIncome <= REBATE_CEILING ? Math.max(0, gross - REBATE_AMOUNT) : gross;
}

/**
 * Monthly PCB (MTD) using the annualised method.
 *
 * Regular salary tax is spread evenly across 12 months. A one-off bonus is
 * taxed as additional remuneration: the extra tax it creates on top of the
 * salary-only chargeable income is deducted in full in the month it is paid.
 *
 * Reliefs applied: individual RM9,000 + EPF (capped RM4,000/year).
 * (SOCSO relief is not applied here, matching payroll.my's PCB output.)
 */
function calculatePcbTax(salary, bonus, empRatePercent, otherReliefs = 0) {
    const relief = 9000 + otherReliefs;

    const epfEmpSalary    = epfContribution(salary, empRatePercent);
    const epfReliefSalary = Math.min(epfEmpSalary * 12, 4000);
    const pSalary = Math.max(0, salary * 12 - relief - epfReliefSalary);

    // Regular monthly MTD, rounded up to the nearest 5 sen.
    const regularMonthly = roundUp5(calculateLhdnAnnualTax(pSalary) / 12);
    let pcb = regularMonthly;

    if (bonus > 0) {
        // Additional-remuneration MTD (LHDN method): full-year tax including the
        // bonus, minus the year's normal tax taken as the ROUNDED monthly MTD x12.
        const epfEmpBonus    = epfContribution(bonus, empRatePercent);
        const epfReliefTotal = Math.min(epfEmpSalary * 12 + epfEmpBonus, 4000);
        const pWithBonus = Math.max(0, salary * 12 + bonus - relief - epfReliefTotal);
        pcb += roundUp5(calculateLhdnAnnualTax(pWithBonus) - regularMonthly * 12);
    }
    return round2(pcb);
}

/**
 * ====================================================================
 * HOME LOAN
 * ====================================================================
 * Worked on monthly rest — the basis a letter offer is quoted on. Malaysian
 * housing loans are actually charged on daily rest, which shifts each month's
 * interest by a few ringgit depending on how many days it holds, but leaves the
 * shape of the schedule and the totals within rounding of these figures.
 */

/** Level instalment that clears `principal` in exactly `months` payments. */
function loanInstalment(principal, annualRate, months) {
    if (principal <= 0 || months <= 0) return 0;
    const rate = annualRate / 100 / 12;
    if (rate <= 0) return round2(principal / months);
    const growth = Math.pow(1 + rate, months);
    return round2(principal * rate * growth / (growth - 1));
}

/**
 * Month-by-month run of the loan.
 *
 * Interest is charged on the balance still outstanding, so anything paid above
 * the instalment comes straight off the principal and every later month's
 * interest is charged on the smaller balance — which is why a small extra
 * payment early on is worth so much more than the same money late.
 *
 * A payment is never allowed to exceed what is actually owed, so the last one
 * settles the remainder instead of overshooting. `lumpMonth` is the month the
 * one-off payment lands in, counted from the first instalment.
 */
function loanSchedule({ principal, annualRate, months, instalment, extraMonthly = 0, lumpSum = 0, lumpMonth = 0 }) {
    const rate = annualRate / 100 / 12;
    const rows = [];

    let balance = principal;
    let paid = 0, interestPaid = 0, principalPaid = 0;

    for (let month = 1; month <= months && balance > 0.005; month++) {
        const interest = round2(balance * rate);
        const owed     = round2(balance + interest);

        // The final scheduled month settles whatever rounding has left behind.
        const offered = month === months
            ? owed
            : instalment + extraMonthly + (lumpSum > 0 && month === lumpMonth ? lumpSum : 0);

        const payment   = Math.min(round2(offered), owed);
        const principalPart = round2(payment - interest);

        balance = round2(balance - principalPart);
        paid          = round2(paid + payment);
        interestPaid  = round2(interestPaid + interest);
        principalPaid = round2(principalPaid + principalPart);

        rows.push({ month, payment, interest, principal: principalPart, balance });
    }

    return { rows, months: rows.length, totalPaid: paid, totalInterest: interestPaid, totalPrincipal: principalPaid };
}

/**
 * Hire purchase, the way a car loan is written here.
 *
 * The rate is flat: interest is charged on the whole amount borrowed for every
 * year of the tenure, no matter how much of it you have already paid back. So
 * the term charges are fixed the day you sign, and the instalment is simply the
 * loan plus those charges split evenly across the months.
 */
function hirePurchase(principal, flatRatePercent, months) {
    if (principal <= 0 || months <= 0) return { interest: 0, total: 0, instalment: 0 };
    const interest = round2(principal * flatRatePercent / 100 * (months / 12));
    const total    = round2(principal + interest);
    return { interest, total, instalment: round2(total / months) };
}

/**
 * The reducing-balance rate that would ask for the same instalment — what a flat
 * rate actually costs, which is close to double the number on the quote.
 *
 * There is no way to rearrange the instalment formula for the rate, so it is
 * found by halving the interval: the instalment rises with the rate, so each
 * step keeps whichever half of the range still brackets the answer.
 */
function effectiveRate(principal, instalment, months) {
    if (principal <= 0 || months <= 0 || instalment * months <= principal) return 0;

    const payment = (annualRate) => {
        const rate = annualRate / 100 / 12;
        if (rate <= 0) return principal / months;
        const growth = Math.pow(1 + rate, months);
        return principal * rate * growth / (growth - 1);
    };

    let low = 0, high = 100;
    for (let i = 0; i < 80; i++) {
        const mid = (low + high) / 2;
        if (payment(mid) > instalment) high = mid; else low = mid;
    }
    return (low + high) / 2;
}

/**
 * Rebate on the unearned term charges when a hire purchase is settled early —
 * the Rule of 78 set out in the Hire-Purchase Act 1967.
 *
 * Interest is treated as earned fastest at the start, so the rebate is weighted
 * by the months still to run against the months of the whole term. Half way
 * through a 7-year loan that returns barely a quarter of the charges.
 */
function ruleOf78Rebate(termCharges, months, monthsPaid) {
    const left = months - monthsPaid;
    if (left <= 0 || months <= 0) return 0;
    return round2(termCharges * left * (left + 1) / (months * (months + 1)));
}

/**
 * Month-by-month run of a hire purchase. Every instalment carries the same slice
 * of principal and the same slice of interest, so the balance falls in a straight
 * line. The last month absorbs whatever the even split left behind.
 */
function hirePurchaseSchedule({ principal, months, instalment, interest }) {
    const monthlyInterest = round2(interest / months);
    const rows = [];

    let balance = principal;
    let paid = 0, interestPaid = 0, principalPaid = 0;

    for (let month = 1; month <= months; month++) {
        const last          = month === months;
        const interestPart  = last ? round2(interest - interestPaid) : monthlyInterest;
        const payment       = last ? round2(balance + interestPart) : instalment;
        const principalPart = round2(payment - interestPart);

        balance       = round2(balance - principalPart);
        paid          = round2(paid + payment);
        interestPaid  = round2(interestPaid + interestPart);
        principalPaid = round2(principalPaid + principalPart);

        rows.push({ month, payment, interest: interestPart, principal: principalPart, balance });
    }

    return { rows, months: rows.length, totalPaid: paid, totalInterest: interestPaid, totalPrincipal: principalPaid };
}

/** Roll the monthly rows up into one row per calendar year of the loan. */
function loanYearRows(rows) {
    const years = [];
    rows.forEach((row) => {
        const index = Math.ceil(row.month / 12) - 1;
        if (!years[index]) years[index] = { year: index + 1, count: 0, payment: 0, interest: 0, principal: 0, balance: 0 };
        const year = years[index];
        year.count++;
        year.payment   = round2(year.payment + row.payment);
        year.interest  = round2(year.interest + row.interest);
        year.principal = round2(year.principal + row.principal);
        year.balance   = row.balance;
    });
    return years;
}

/**
 * The most you could borrow when the instalment is the thing that is fixed —
 * the loan formulas run backwards. `maxLoanReducing` is the present value of the
 * instalments; on a flat quote the term charges ride on the amount itself, so
 * the instalment carries both and the amount falls out of the ratio.
 */
function maxLoanReducing(instalment, annualRate, months) {
    if (instalment <= 0 || months <= 0) return 0;
    const rate = annualRate / 100 / 12;
    if (rate <= 0) return round2(instalment * months);
    return round2(instalment * (1 - Math.pow(1 + rate, -months)) / rate);
}

function maxLoanFlat(instalment, flatRatePercent, months) {
    if (instalment <= 0 || months <= 0) return 0;
    return round2(instalment * months / (1 + flatRatePercent / 100 * (months / 12)));
}

/**
 * ====================================================================
 * SAVINGS GOAL
 * ====================================================================
 * A deposit lands at the end of each month and whatever the money earns is
 * credited on the balance that was already sitting there — which is how a
 * standing instruction into a savings account or a monthly unit trust purchase
 * actually behaves. That makes the plan an ordinary annuity, so the deposit a
 * target needs comes out in one step instead of by trial and error.
 */
const GOAL_MAX_MONTHS = 600;   // 50 years — past that it is a retirement plan, not a goal

/**
 * The monthly deposit that turns `opening` into `target` in exactly `months`.
 * Zero when the head start already grows into the target on its own.
 */
function goalDeposit({ target, opening, annualRate, months }) {
    if (months <= 0) return 0;

    const rate = annualRate / 100 / 12;
    if (rate <= 0) return Math.max(0, ceilSen((target - opening) / months));

    const growth    = Math.pow(1 + rate, months);
    const shortfall = target - opening * growth;
    if (shortfall <= 0) return 0;
    return ceilSen(shortfall * rate / (growth - 1));
}

/**
 * Month-by-month run of the plan, and the month the target is first met.
 *
 * `settleLast` trims the final deposit to whatever the target still needs. The
 * required deposit is rounded up to the sen so the goal is never missed, and
 * without the trim that rounding would leave a few sen sitting over the target.
 * A plan the saver chose the amount for is left alone — they would keep paying
 * the same figure in.
 */
function savingsSchedule({ opening, monthly, annualRate, months, target, settleLast = false }) {
    const rate = annualRate / 100 / 12;
    const rows = [];

    let balance = opening;
    let deposits = 0, growth = 0, reached = 0;

    for (let month = 1; month <= months; month++) {
        const earned  = round2(balance * rate);
        const deposit = settleLast && month === months && target > 0
            ? Math.max(0, Math.min(monthly, round2(target - balance - earned)))
            : monthly;

        balance  = round2(balance + earned + deposit);
        deposits = round2(deposits + deposit);
        growth   = round2(growth + earned);
        if (!reached && target > 0 && balance >= target - 0.005) reached = month;

        rows.push({ month, deposit, growth: earned, balance });
    }

    return { rows, months: rows.length, deposits, growth, balance, reached };
}

/**
 * Months of saving `monthly` before the target is met — 0 if it already is,
 * and -1 when it is still out of reach after the fifty years the plan runs.
 */
function monthsToGoal({ target, opening, annualRate, monthly }) {
    if (opening >= target - 0.005) return 0;

    const rate = annualRate / 100 / 12;
    let balance = opening;

    for (let month = 1; month <= GOAL_MAX_MONTHS; month++) {
        balance = round2(balance + round2(balance * rate) + monthly);
        if (balance >= target - 0.005) return month;
    }
    return -1;
}

/** Roll the monthly rows up into one row per year of the plan. */
function goalYearRows(rows) {
    const years = [];
    rows.forEach((row) => {
        const index = Math.ceil(row.month / 12) - 1;
        if (!years[index]) years[index] = { year: index + 1, count: 0, deposit: 0, growth: 0, balance: 0, first: row.month, last: row.month };
        const year = years[index];
        year.count++;
        year.deposit = round2(year.deposit + row.deposit);
        year.growth  = round2(year.growth + row.growth);
        year.balance = row.balance;
        year.last    = row.month;
    });
    return years;
}

/**
 * ====================================================================
 * COMPOUND INTEREST
 * ====================================================================
 * The same monthly run as a savings goal, with one thing added: earnings do not
 * always join the balance the moment they are earned. Interest accrues every
 * month but is only *credited* when the rest closes — and only once credited
 * does it start earning on itself. At a monthly rest this is exactly
 * `savingsSchedule`; at a quarterly or yearly rest the money waiting on the
 * credit date earns simple interest until then, which is how EPF and ASB
 * actually weight an annual dividend by the months you held the money.
 */
function compoundSchedule({ opening, monthly, annualRate, months, everyMonths = 1 }) {
    const rate = annualRate / 100 / 12;
    const rest = Math.max(1, Math.round(everyMonths));
    const rows = [];

    let balance = opening;
    let pending = 0, deposits = 0, growth = 0, crossed = 0;

    for (let month = 1; month <= months; month++) {
        // Accrued on the credited balance only — interest still waiting on the
        // rest date is not yet earning, which is the whole point of the rest.
        pending = round2(pending + balance * rate);

        // A run that stops part-way through a rest is settled at the end of it.
        const due = month % rest === 0 || month === months;
        const earned = due ? pending : 0;
        if (due) pending = 0;

        balance  = round2(balance + earned + monthly);
        deposits = round2(deposits + monthly);
        growth   = round2(growth + earned);
        if (!crossed && growth > opening + deposits) crossed = month;

        rows.push({ month, deposit: monthly, growth: earned, balance });
    }

    return { rows, months: rows.length, deposits, growth, balance, crossed, reached: 0 };
}

/**
 * ====================================================================
 * RETIREMENT
 * ====================================================================
 * Two phases, back to back. Until you stop working the money is fed and grows
 * — that is `compoundSchedule` again. After that it is drawn down: a withdrawal
 * every month that rises with inflation, against a balance that keeps earning
 * on what is left. The fund you need on the day you retire is simply the value
 * of that stream of withdrawals, discounted at what the money earns.
 */

/**
 * What a rising withdrawal for `months` is worth on the day it starts — the
 * present value of a growing annuity, paid at the end of each month.
 *
 * When the return and inflation match, every ringgit of growth is eaten by
 * prices and the fund is just the withdrawals added up, discounted once.
 */
function drawdownFund({ first, annualRate, inflation, months }) {
    if (months <= 0 || first <= 0) return 0;

    const rate   = annualRate / 100 / 12;
    const rising = inflation / 100 / 12;
    if (Math.abs(rate - rising) < 1e-12) return round2(first * months / (1 + rate));

    return round2(first * (1 - Math.pow((1 + rising) / (1 + rate), months)) / (rate - rising));
}

/** The reverse: the first monthly withdrawal a given fund can carry to the end. */
function drawdownIncome({ fund, annualRate, inflation, months }) {
    const perRinggit = drawdownFund({ first: 1, annualRate, inflation, months });
    return perRinggit > 0 ? round2(fund / perRinggit) : 0;
}

/**
 * The retirement years month by month. The withdrawal rises with inflation and
 * is taken after the month's earnings, and it is capped at whatever is actually
 * left — a fund that runs dry stops paying rather than going negative.
 */
function drawdownSchedule({ opening, first, annualRate, inflation, months }) {
    const rate   = annualRate / 100 / 12;
    const rising = inflation / 100 / 12;
    const rows   = [];

    let balance = opening, want = first;
    let taken = 0, growth = 0, depleted = 0;

    for (let month = 1; month <= months; month++) {
        const earned = round2(balance * rate);
        const paid   = Math.max(0, Math.min(round2(want), round2(balance + earned)));

        // `|| 0` so a balance that lands a whisker below zero prints as 0, not −0.
        balance = round2(balance + earned - paid) || 0;
        taken   = round2(taken + paid);
        growth  = round2(growth + earned);
        rows.push({ month, withdraw: paid, growth: earned, balance });

        if (balance <= 0.005) { depleted = month; break; }
        want = want * (1 + rising);
    }

    return { rows, months: rows.length, taken, growth, balance, depleted };
}

/**
 * ====================================================================
 * NET WORTH
 * ====================================================================
 * Every line is valued the same way: an asset at what it would sell for today,
 * a debt at what it would cost to settle today. The grouping is the one AKPK
 * uses — cash, investments, long-term assets on one side; short and long-term
 * borrowing on the other — because the split is what makes the total readable.
 * A net worth held in a house is not the same as one held in the bank.
 */
const NET_WORTH_GROUPS = [
    {
        id: 'liquid', side: 'asset', title: 'Cash & bank', dot: 'net',
        items: [
            { id: 'nwCash',   label: 'Cash in hand',            note: 'wallet, safe box, e-wallets' },
            { id: 'nwBank',   label: 'Savings & current accounts' },
            { id: 'nwFd',     label: 'Fixed deposits',           note: 'and short-term placements' },
        ],
    },
    {
        id: 'invest', side: 'asset', title: 'Investments', dot: 'epf',
        items: [
            { id: 'nwEpf',    label: 'EPF (KWSP)',               note: 'all accounts added up' },
            { id: 'nwAsb',    label: 'ASB, ASM & unit trusts',   note: 'including Tabung Haji and PRS' },
            { id: 'nwShares', label: 'Shares, ETFs & crypto',    note: 'at today’s market price' },
            { id: 'nwPolicy', label: 'Insurance cash value',     note: 'what the policy pays if you surrender it — not the sum insured' },
        ],
    },
    {
        id: 'fixed', side: 'asset', title: 'Property & vehicles', dot: 'sos',
        items: [
            { id: 'nwHome',      label: 'Home',                  note: 'what it would fetch today, not what you paid' },
            { id: 'nwProperty',  label: 'Other property',        note: 'second home, land, shoplot' },
            { id: 'nwCar',       label: 'Cars',                  note: 'market value now, not the on-the-road price' },
            { id: 'nwValuables', label: 'Jewellery & valuables', note: 'gold, collectibles, anything you could sell' },
        ],
    },
    {
        id: 'long', side: 'debt', title: 'Long-term debt', dot: 'amber',
        items: [
            { id: 'nwHomeLoan',     label: 'Housing loan',        note: 'balance outstanding, not the amount borrowed' },
            { id: 'nwPropertyLoan', label: 'Other property loan' },
            { id: 'nwCarLoan',      label: 'Car loan',            note: 'hire purchase — what settling it today costs' },
            { id: 'nwStudyLoan',    label: 'PTPTN / study loan' },
        ],
    },
    {
        id: 'short', side: 'debt', title: 'Short-term debt', dot: 'pcb',
        items: [
            { id: 'nwCard',         label: 'Credit cards',        note: 'the full balance, not the minimum payment' },
            { id: 'nwPersonalLoan', label: 'Personal loan' },
            { id: 'nwOverdraft',    label: 'Overdraft & borrowing', note: 'including money owed to family' },
            { id: 'nwTaxDue',       label: 'Income tax owing',    note: 'what is still due to LHDN' },
        ],
    },
];

const NET_WORTH_ITEMS = NET_WORTH_GROUPS.flatMap((group) => group.items);

/** Where a debt ratio sits, said the way a person would say it. */
function debtVerdict(ratio) {
    if (ratio <= 0)  return 'nothing owed';
    if (ratio < 30)  return 'comfortable';
    if (ratio < 50)  return 'manageable';
    if (ratio < 80)  return 'heavy';
    if (ratio < 100) return 'stretched';
    return 'underwater';
}

/**
 * ====================================================================
 * EMERGENCY FUND
 * ====================================================================
 */
const EF_ITEMS = ['efHousing', 'efFood', 'efUtilities', 'efTransport', 'efInsurance', 'efDebt', 'efFamily', 'efOther'];

/**
 * How many months of cover a household like this should hold.
 *
 * Three months is the floor everyone agrees on. Everything added to it is the
 * same argument in different clothes: the longer your income could stay off,
 * and the more people it feeds, the longer the fund has to last.
 */
function suggestedCover({ earners, job, dependants }) {
    const reasons = [];
    let months = 3;

    if (job === 'own')           { months += 3; reasons.push('you work for yourself'); }
    else if (job === 'contract') { months += 2; reasons.push('contract work ends without notice'); }

    if (earners === 'one') { months += 1; reasons.push('one income carries the house'); }

    if (dependants >= 3)      { months += 2; reasons.push('three or more people depend on you'); }
    else if (dependants >= 1) { months += 1; reasons.push('people depend on you'); }

    return { months: Math.min(12, months), reasons };
}

/**
 * ====================================================================
 * RENT VS BUY
 * ====================================================================
 * The comparison only means anything if both sides are held to the same
 * standard: the buyer's deposit and fees are money the renter still has, and
 * every ringgit the buyer pays above the rent is a ringgit the renter invests.
 * Anything less generous to the renter is just an argument for buying.
 */

/** Stamp duty on the transfer — the tiers in the Stamp Act, as they stand. */
const MOT_STAMP_BANDS = [
    { upTo: 100000,   rate: 1 },
    { upTo: 500000,   rate: 2 },
    { upTo: 1000000,  rate: 3 },
    { upTo: Infinity, rate: 4 },
];

/** The solicitors' remuneration scale, charged on the price and again on the loan. */
const LEGAL_FEE_BANDS = [
    { upTo: 500000,   rate: 1.25 },
    { upTo: 1000000,  rate: 1 },
    { upTo: 3000000,  rate: 0.7 },
    { upTo: 5000000,  rate: 0.6 },
    { upTo: Infinity, rate: 0.5 },
];

const LOAN_STAMP_RATE  = 0.5;    // % of the loan, on the loan agreement
const LEGAL_SST        = 8;      // % on professional fees
const LEGAL_EXTRAS     = 2000;   // searches, registration, valuation — near enough flat
const LEGAL_MINIMUM    = 500;    // the scale's own floor per agreement

/** A fee charged in slices, each slice at its own rate. */
function bandedFee(amount, bands) {
    let left = Math.max(0, amount), from = 0, fee = 0;

    for (const band of bands) {
        if (left <= 0) break;
        const slice = Math.min(left, band.upTo - from);
        fee  += slice * band.rate / 100;
        left -= slice;
        from  = band.upTo;
    }
    return round2(fee);
}

/** Everything the keys cost on top of the deposit. */
function buyingCosts(price, loan) {
    const transferStamp = bandedFee(price, MOT_STAMP_BANDS);
    const loanStamp     = round2(loan * LOAN_STAMP_RATE / 100);
    const fees          = (price > 0 ? Math.max(LEGAL_MINIMUM, bandedFee(price, LEGAL_FEE_BANDS)) : 0) +
                          (loan  > 0 ? Math.max(LEGAL_MINIMUM, bandedFee(loan, LEGAL_FEE_BANDS)) : 0);
    const legal         = price > 0 ? round2(fees * (1 + LEGAL_SST / 100) + LEGAL_EXTRAS) : 0;

    return { transferStamp, loanStamp, legal, total: round2(transferStamp + loanStamp + legal) };
}

/**
 * Both paths, month by month, from the same starting wallet.
 *
 * The buyer's worth is what selling would leave them: the place at its price
 * that month, less the loan and less the agent. The renter's worth is the pot —
 * the deposit and fees they never spent, plus every month's difference, growing
 * at whatever the money earns. A month where the rent is higher than the
 * buyer's outlay quietly takes money back out of the pot, which is exactly what
 * happens in real life.
 */
function rentVsBuy({ price, down, upfront, annualRate, tenureMonths, months, growth, upkeepPct, sellPct, rent, rentRise, investRate }) {
    const instalment = loanInstalment(round2(price - down), annualRate, tenureMonths);
    const rate  = annualRate / 100 / 12;
    const grow  = growth / 100 / 12;
    const gain  = investRate / 100 / 12;
    const rise  = rentRise / 100 / 12;

    let balance = round2(price - down);
    let value   = price;
    let pot     = round2(down + upfront);
    let rentNow = rent;

    let rentPaid = 0, instalmentsPaid = 0, interestPaid = 0, upkeepPaid = 0, invested = 0, potGrowth = 0;
    let breakEven = 0;
    const rows = [];

    for (let month = 1; month <= months; month++) {
        const interest = balance > 0 ? round2(balance * rate) : 0;
        const due      = balance > 0 ? Math.min(instalment, round2(balance + interest)) : 0;
        balance = round2(balance + interest - due) || 0;

        const upkeep = round2(value * upkeepPct / 100 / 12);
        value = round2(value * (1 + grow));

        const earned = round2(pot * gain);
        const spare  = round2(due + upkeep - rentNow);
        pot = round2(pot + earned + spare);

        rentPaid        = round2(rentPaid + rentNow);
        instalmentsPaid = round2(instalmentsPaid + due);
        interestPaid    = round2(interestPaid + interest);
        upkeepPaid      = round2(upkeepPaid + upkeep);
        invested        = round2(invested + spare);
        potGrowth       = round2(potGrowth + earned);

        const equity = round2(value - balance - value * sellPct / 100);
        if (!breakEven && equity >= pot) breakEven = month;

        rows.push({ month, buy: equity, rent: pot, value, balance, rentNow });
        rentNow = round2(rentNow * (1 + rise));
    }

    const last = rows[rows.length - 1];
    return {
        rows, instalment, breakEven,
        rentPaid, instalmentsPaid, interestPaid, upkeepPaid, invested, potGrowth,
        rentLast: rows.length ? rows[rows.length - 1].rentNow : rent,
        value:   last ? last.value : price,
        balance: last ? last.balance : round2(price - down),
        sellCost: last ? round2(last.value * sellPct / 100) : 0,
        buy:     last ? last.buy : 0,
        pot:     last ? last.rent : round2(down + upfront),
    };
}

/**
 * ====================================================================
 * VIEW HELPERS
 * ====================================================================
 */
const $  = (id) => document.getElementById(id);
const fmt   = (x, dp = 2) => x.toLocaleString('en-MY', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const money = (x) => 'RM ' + fmt(x);
const pct   = (x, dp = 1) => fmt(x, dp) + '%';
/** A figure that can legitimately come out below zero — a minus sign, not a hyphen. */
const signed = (x) => (x < 0 ? '− ' : '') + money(Math.abs(x));
/** A figure that is subtracted where it appears — but nothing is not a deduction. */
const minus  = (x) => (x > 0.005 ? '− ' : '') + money(x);
const set   = (id, text) => { const el = $(id); if (el) el.textContent = text; };
const num   = (id) => parseFloat(($(id) || {}).value) || 0;
const segValue = (id) => parseFloat(($(id) || {}).dataset.value);

/** "Feb 2028" — a deadline said the way a calendar says it. */
const monthLabel = (date) => date.toLocaleDateString('en-MY', { month: 'short', year: 'numeric' });

/** The value a date input wants: YYYY-MM-DD in local time, not UTC. */
const isoDate = (date) =>
    date.getFullYear() + '-' +
    String(date.getMonth() + 1).padStart(2, '0') + '-' +
    String(date.getDate()).padStart(2, '0');

/** The same day of the month, `count` months on, held inside a shorter month. */
function addMonths(date, count) {
    const out     = new Date(date.getFullYear(), date.getMonth() + count, 1);
    const lastDay = new Date(out.getFullYear(), out.getMonth() + 1, 0).getDate();
    out.setDate(Math.min(date.getDate(), lastDay));
    return out;
}

/** Whole months from one date to another — a part month does not count, since a deposit cannot be made in it. */
function wholeMonthsBetween(from, to) {
    const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    return months - (to.getDate() < from.getDate() ? 1 : 0);
}

/** "35 years", "22 years 4 months", "7 months" — a term said the way people say it. */
function formatMonths(total) {
    const years  = Math.floor(total / 12);
    const months = total % 12;
    const parts  = [];
    if (years)  parts.push(years + (years === 1 ? ' year' : ' years'));
    if (months) parts.push(months + (months === 1 ? ' month' : ' months'));
    return parts.join(' ') || '0 months';
}

/**
 * ====================================================================
 * PCB SIMULATION
 * ====================================================================
 */
function renderPcb() {
    const salary   = num('salary');
    const bonus    = num('bonus');
    const epfRate  = segValue('epfRate')         || 11;
    const emprRate = segValue('epfEmployerRate') || 13;
    const socsoCat = ($('socsoCategory') || {}).value || DEFAULT_SOCSO_CATEGORY;

    const gross = salary + bonus;
    $('pcb-results').classList.toggle('is-empty', gross <= 0);
    if (gross <= 0) return;

    // EPF is charged on both salary and bonus; SOCSO & EIS on salary only.
    const epf = {
        employee: epfContribution(salary, epfRate) + epfContribution(bonus, epfRate),
        employer: epfContribution(salary, emprRate) + epfContribution(bonus, emprRate),
    };
    const socso = socsoContribution(salary, socsoCat);
    const eis   = eisContribution(salary);
    const pcb   = calculatePcbTax(salary, bonus, epfRate);

    const totalEmployer = round2(epf.employer + socso.employer + eis.employer);
    const totalEmployee = round2(epf.employee + socso.employee + eis.employee + pcb);
    const netSalary     = round2(gross - totalEmployee);
    const statutory     = round2(socso.employee + eis.employee);

    // --- headline tiles ---
    set('outNet', money(netSalary));
    set('outNetPct', pct(gross ? netSalary / gross * 100 : 0) + ' of gross pay');
    set('totalEmployee', '− ' + money(totalEmployee));
    set('outGross', 'from ' + money(gross) + ' gross');
    set('totalEmployer', money(totalEmployer));
    set('outCost', 'Total cost to hire ' + money(round2(gross + totalEmployer)));

    // --- distribution bar ---
    const share = (v) => (gross ? (v / gross) * 100 : 0).toFixed(3) + '%';
    $('segNet').style.width   = share(netSalary);
    $('segEpf').style.width   = share(epf.employee);
    $('segSocso').style.width = share(statutory);
    $('segPcb').style.width   = share(pcb);

    set('distGross', money(gross) + ' gross');
    set('legNet', money(netSalary));
    set('legEpf', money(epf.employee));
    set('legSocso', money(statutory));
    set('legPcb', money(pcb));

    // --- breakdown table ---
    set('outEpfEmployer', fmt(epf.employer));
    set('outEpfEmployee', fmt(epf.employee));
    set('outEpfTotal', fmt(round2(epf.employer + epf.employee)));

    set('outSocsoEmployer', fmt(socso.employer));
    set('outSocsoEmployee', fmt(socso.employee));
    set('outSocsoTotal', fmt(round2(socso.employer + socso.employee)));

    set('outEisEmployer', fmt(eis.employer));
    set('outEisEmployee', fmt(eis.employee));
    set('outEisTotal', fmt(round2(eis.employer + eis.employee)));

    set('outPcb', fmt(pcb));
    set('outPcbTotal', fmt(pcb));

    set('sumEmployer', fmt(totalEmployer));
    set('sumEmployee', fmt(totalEmployee));
    set('sumGrand', fmt(round2(totalEmployer + totalEmployee)));
}

/**
 * ====================================================================
 * EPF SIMULATION
 * ====================================================================
 * Each projected year owns its dividend rate, so the year rows carry live
 * inputs. Rebuilding them on every keystroke would drop the caret, so the rows
 * are only built when the number of years changes; after that just the figures
 * around the inputs are repainted.
 */
let epfRates     = [];    // dividend rate per projected year, as typed
let epfRatesFrom = null;  // the flat rate those years were last filled from
let epfBuiltRows = -1;    // how many year rows the table currently holds

/** Reconcile the year rates with what is on screen and how many years are in play. */
function syncYearRates(years) {
    document.querySelectorAll('#epfProjBody .epf-year-rate').forEach((input) => {
        epfRates[Number(input.dataset.year)] = input.value;
    });

    const base = num('epfDividend');
    if (base !== epfRatesFrom) {
        // The flat rate is a "set them all" control — moving it overrides every year.
        epfRates = [];
        epfRatesFrom = base;
        document.querySelectorAll('#epfProjBody .epf-year-rate').forEach((input) => {
            input.value = String(base);
        });
    }

    // Years the projection has only just reached start from the flat rate. A year
    // the user has emptied stays empty, and counts as a 0% year.
    for (let year = 0; year < years; year++) {
        if (epfRates[year] === undefined) epfRates[year] = base;
    }
    return epfRates.map((rate) => Math.max(0, parseFloat(rate) || 0));
}

function buildProjectionRows(years, message) {
    if (years > 0 && years === epfBuiltRows) return;
    epfBuiltRows = years;

    const body = $('epfProjBody');
    body.innerHTML = '';

    if (!years) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.className = 'is-muted';
        td.textContent = message;
        tr.appendChild(td);
        body.appendChild(tr);
        return;
    }

    for (let year = 0; year < years; year++) {
        const tr = document.createElement('tr');
        tr.className = 'band-row';
        tr.dataset.year = String(year);
        tr.innerHTML =
            '<td class="col-age"></td>' +
            '<td class="col-wage"></td>' +
            '<td class="col-paid"></td>' +
            '<td class="rate-cell"><div class="money-input money-input-sm is-suffix year-rate">' +
            '<span class="prefix">%</span>' +
            '<input type="number" class="epf-year-rate" min="0" max="20" step="0.05" inputmode="decimal">' +
            '</div></td>' +
            '<td class="col-dividend is-dividend"></td>' +
            '<td class="col-balance is-strong"></td>';

        const input = tr.querySelector('.epf-year-rate');
        input.dataset.year = String(year);
        input.value = epfRates[year];
        body.appendChild(tr);
    }

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.innerHTML =
        '<td class="col-age"></td><td></td><td class="col-paid"></td>' +
        '<td class="rate-cell col-rate"></td>' +
        '<td class="col-dividend is-dividend"></td><td class="col-balance"></td>';
    body.appendChild(totalRow);
}

function paintProjectionRows(projection, until) {
    const body = $('epfProjBody');

    projection.rows.forEach((row, year) => {
        const tr = body.querySelector('tr[data-year="' + year + '"]');
        if (!tr) return;
        tr.querySelector('.col-age').textContent      = String(row.age);
        tr.querySelector('.col-wage').textContent     = fmt(row.wage, 0);
        tr.querySelector('.col-paid').textContent     = fmt(row.contributed, 0);
        tr.querySelector('.col-dividend').textContent = fmt(row.dividend, 0);
        tr.querySelector('.col-balance').textContent  = fmt(row.balance, 0);
    });

    const totalRow = body.querySelector('.total-row');
    if (!totalRow) return;
    const average = projection.rows.reduce((sum, row) => sum + row.rate, 0) / projection.rows.length;
    totalRow.querySelector('.col-age').textContent      = 'At ' + until;
    totalRow.querySelector('.col-paid').textContent     = fmt(projection.paidIn, 0);
    totalRow.querySelector('.col-rate').textContent     = pct(average, 2);
    totalRow.querySelector('.col-dividend').textContent = fmt(projection.dividends, 0);
    totalRow.querySelector('.col-balance').textContent  = fmt(projection.balance, 0);
}

function renderEpf() {
    const salary    = num('epfSalary');
    const selfRate  = segValue('epfRateSelf')     || 11;
    const emprRate  = segValue('epfRateEmployer') || 13;
    const voluntary = Math.max(0, num('epfVoluntary'));

    // The preset buttons are a shortcut into the rate field, not a separate input.
    const dividendSeg = $('epfDividendSeg');
    if (dividendSeg) setSegment(dividendSeg, String(num('epfDividend')));

    $('epf-results').classList.toggle('is-empty', salary <= 0 && voluntary <= 0);
    if (salary <= 0 && voluntary <= 0) return;

    const self     = epfContribution(salary, selfRate);
    const employer = epfContribution(salary, emprRate);
    const monthly  = round2(self + employer + voluntary);
    const annual   = round2(monthly * 12);

    // --- headline tiles ---
    set('epfMonthly', money(monthly));
    set('epfMonthlyFoot', money(annual) + ' a year');
    set('epfSelfMonthly', money(self + voluntary));
    set('epfSelfFoot', voluntary > 0
        ? pct(selfRate, 0) + ' plus ' + money(voluntary) + ' voluntary'
        : pct(selfRate, 0) + ' of your salary');
    set('epfEmployerMonthly', money(employer));
    set('epfEmployerFoot', pct(emprRate, 0) + ' on top of your pay');

    set('epfTallySelf', money(round2(self + voluntary)));
    set('epfTallyEmployer', money(employer));
    set('epfTallyMonthly', money(monthly));

    // --- monthly / yearly table ---
    set('epfEffectiveNote', salary > 0
        ? money(monthly) + ' is ' + pct(monthly / salary * 100) + ' of your salary'
        : 'Voluntary contributions only');

    set('epfSelfRate', pct(selfRate, 0));
    set('epfErRate', pct(emprRate, 0));
    set('epfSelfMth', fmt(self));
    set('epfSelfYr', fmt(round2(self * 12)));
    set('epfErMth', fmt(employer));
    set('epfErYr', fmt(round2(employer * 12)));
    set('epfVolMth', fmt(voluntary));
    set('epfVolYr', fmt(round2(voluntary * 12)));
    set('epfTotMth', fmt(monthly));
    set('epfTotYr', fmt(annual));
    $('epfVolRow').hidden = voluntary <= 0;

    // --- account split ---
    EPF_ACCOUNTS.forEach((account) => {
        const bar = $('seg' + account.id);
        if (bar) bar.style.width = (account.share * 100).toFixed(3) + '%';
        set('leg' + account.id, money(round2(monthly * account.share)));
    });

    // --- projection ---
    // A blank age field reads as 0, which would silently project a whole life
    // from birth — so nothing is projected until an age is actually entered.
    const enteredAge = parseFloat(($('epfAge') || {}).value);
    const hasAge     = Number.isFinite(enteredAge) && enteredAge > 0;
    const age        = hasAge ? Math.round(enteredAge) : 0;
    const until      = Math.max(0, Math.round(num('epfUntil')));
    const opening    = Math.max(0, num('epfBalance'));

    const years = hasAge ? Math.max(0, until - age) : 0;
    const projection = years
        ? epfProjection({
            salary, selfRate, employerRate: emprRate, voluntary, opening,
            age, untilAge: until,
            growth: Math.max(0, num('epfGrowth')),
            rates: syncYearRates(years),
        })
        : { rows: [], years: 0, paidIn: 0, dividends: 0, balance: opening };

    set('epfProjOpening', money(opening));
    set('epfProjInLabel', projection.years
        ? 'Contributions over ' + projection.years + (projection.years === 1 ? ' year' : ' years')
        : 'Contributions');
    set('epfProjIn', money(projection.paidIn));
    set('epfProjDividend', money(projection.dividends));
    set('epfProjFinalLabel', projection.years ? 'Balance at ' + until : 'Projected balance');
    set('epfProjFinal', money(projection.balance));

    const dividendShare = projection.balance > 0 ? projection.dividends / projection.balance * 100 : 0;
    set('epfProjNote', projection.years
        ? pct(dividendShare) + ' of that balance is dividend, never deducted from your pay'
        : 'Fill in your age to project forward');

    if (!projection.years) {
        buildProjectionRows(0, hasAge
            ? 'Set a target age above your current age to project forward.'
            : 'Enter your age to project the balance forward.');
        return;
    }

    buildProjectionRows(projection.years);
    paintProjectionRows(projection, until);
}

/**
 * ====================================================================
 * ANNUAL INCOME TAX SIMULATION
 * ====================================================================
 */
const reliefInputId = (item) => 'relief_' + item.id;

/** The cap line shown under each relief's name — this is the "how much can I deduct" bit. */
function reliefCapText(item) {
    if (item.type === 'fixed') return 'RM' + fmt(item.amount, 0) + ', automatic';
    if (item.type === 'flag')  return 'RM' + fmt(item.amount, 0) + ' if you qualify';
    if (item.type === 'count') return 'RM' + fmt(item.unit, 0) + ' per child';
    return 'Max RM' + fmt(item.cap, 0);
}

function reliefControl(item) {
    const cell = document.createElement('div');
    cell.className = 'relief-entry';
    const id = reliefInputId(item);

    if (item.type === 'fixed') {
        cell.innerHTML = '<span class="relief-locked"><i class="bi bi-lock-fill"></i> Automatic</span>';
    } else if (item.type === 'flag') {
        cell.innerHTML = '<label class="relief-check"><input type="checkbox" id="' + id + '"><span>I qualify</span></label>';
    } else if (item.type === 'count') {
        cell.innerHTML =
            '<div class="relief-count">' +
            '<button type="button" data-step="-1" aria-label="Fewer">&minus;</button>' +
            '<input type="number" id="' + id + '" min="0" max="20" step="1" value="0" inputmode="numeric">' +
            '<button type="button" data-step="1" aria-label="More">+</button>' +
            '</div>';
    } else {
        cell.innerHTML =
            '<div class="money-input money-input-sm"><span class="prefix">RM</span>' +
            '<input type="number" id="' + id + '" min="0" step="100" placeholder="0" inputmode="decimal"></div>';
    }
    return cell;
}

const list = (items, cls) =>
    items && items.length
        ? '<ul class="' + cls + '">' + items.map((text) => '<li>' + text + '</li>').join('') + '</ul>'
        : '';

function buildReliefUI() {
    const host = $('reliefGroups');
    if (!host) return;
    host.innerHTML = '';

    RELIEF_GROUPS.forEach((group) => {
        const wrap = document.createElement('div');
        wrap.className = 'relief-group';

        const heading = document.createElement('h4');
        heading.textContent = group.title;
        wrap.appendChild(heading);

        group.items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'relief-row';
            row.dataset.item = item.id;

            const label = document.createElement('div');
            label.className = 'relief-label';
            label.innerHTML =
                '<strong>' + item.label + '</strong>' +
                '<small><span class="relief-cap">' + reliefCapText(item) + '</span>' +
                (item.note ? ' &middot; ' + item.note : '') + '</small>';

            if (item.detail) {
                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'relief-more';
                toggle.setAttribute('aria-expanded', 'false');
                toggle.innerHTML = 'What counts? <i class="bi bi-chevron-down"></i>';
                label.appendChild(toggle);
            }

            const counted = document.createElement('div');
            counted.className = 'relief-counted';
            counted.id = 'counted_' + item.id;
            counted.textContent = '0.00';

            row.append(label, reliefControl(item), counted);

            if (item.detail) {
                const detail = document.createElement('div');
                detail.className = 'relief-detail';
                detail.hidden = true;
                detail.innerHTML =
                    '<p>' + item.detail + '</p>' +
                    list(item.examples, 'relief-examples') +
                    list(item.excludes, 'relief-excludes');
                row.appendChild(detail);
            }

            wrap.appendChild(row);
        });

        host.appendChild(wrap);
    });
}

/** What each relief line actually contributes after its own cap is applied. */
function reliefBreakdown() {
    let total = 0;
    const rows = RELIEF_ITEMS.map((item) => {
        const el = $(reliefInputId(item));
        let claimed = 0, counted = 0, capped = false;

        if (item.type === 'fixed') {
            claimed = counted = item.amount;
        } else if (item.type === 'flag') {
            counted = claimed = (el && el.checked) ? item.amount : 0;
        } else if (item.type === 'count') {
            claimed = Math.max(0, Math.floor(parseFloat(el && el.value) || 0));
            counted = claimed * item.unit;
        } else {
            claimed = Math.max(0, parseFloat(el && el.value) || 0);
            counted = Math.min(claimed, item.cap);
            capped  = claimed > item.cap;
        }

        total += counted;
        return { item, claimed, counted, capped };
    });
    return { rows, total: round2(total) };
}

function paintReliefs(breakdown) {
    breakdown.rows.forEach(({ item, counted, capped }) => {
        const cell = $('counted_' + item.id);
        if (cell) {
            cell.textContent = fmt(counted);
            cell.classList.toggle('is-zero', counted === 0);
        }
        const row = document.querySelector('.relief-row[data-item="' + item.id + '"]');
        if (row) row.classList.toggle('is-capped', capped);
    });
    set('reliefTotal', money(breakdown.total));
}

function renderIncomeTax() {
    const annualIncome = num('annualIncome');

    const breakdown = reliefBreakdown();
    paintReliefs(breakdown);
    const reliefs = breakdown.total;

    const chargeable = Math.max(0, annualIncome - reliefs);
    const bands      = taxBands(chargeable);
    const grossTax   = round2(bands.reduce((sum, b) => sum + b.tax, 0));
    const rebate     = chargeable > 0 && chargeable <= REBATE_CEILING ? Math.min(REBATE_AMOUNT, grossTax) : 0;
    const taxPayable = round2(grossTax - rebate);

    const effective = annualIncome ? taxPayable / annualIncome * 100 : 0;
    const marginal  = bands.length ? bands[bands.length - 1].rate * 100 : 0;

    set('outTaxPayable', money(taxPayable));
    set('outMonthly', 'About ' + money(round2(taxPayable / 12)) + ' a month to set aside');
    set('lblChargeable', money(chargeable));
    set('outReliefFoot', money(reliefs) + ' claimed in reliefs');
    set('outEffective', pct(effective));
    set('outMarginal', bands.length ? 'Top band taxed at ' + pct(marginal, 0) : 'Nothing chargeable yet');

    set('tallyIncome', money(annualIncome));
    set('tallyReliefs', '− ' + money(reliefs));
    set('tallyChargeable', money(chargeable));

    // --- bracket table ---
    const body = $('bracketBody');
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    if (!bands.length) {
        const tr = document.createElement('tr');
        const td = cell('No chargeable income after reliefs — nothing to tax.');
        td.colSpan = 4;
        td.className = 'is-muted';
        tr.appendChild(td);
        body.appendChild(tr);
    }

    bands.forEach((band) => {
        // LHDN publishes bands as 5,001–20,000, i.e. the lower bound is exclusive.
        const label = band.to === Infinity
            ? 'RM' + fmt(band.from + 1, 0) + ' and above'
            : 'RM' + fmt(band.from ? band.from + 1 : 0, 0) + ' &ndash; ' + fmt(band.to, 0);

        const tr = document.createElement('tr');
        tr.className = 'band-row';
        tr.appendChild(cell(label));
        tr.appendChild(cell('<span class="rate-pill">' + pct(band.rate * 100, 0) + '</span>', 'rate-cell'));
        tr.appendChild(cell(fmt(band.amount)));
        tr.appendChild(cell(fmt(band.tax), band.tax > 0 ? 'is-strong' : 'is-muted'));
        body.appendChild(tr);
    });

    if (rebate > 0) {
        const tr = document.createElement('tr');
        tr.className = 'rebate-row';
        tr.appendChild(cell('<strong>Individual rebate</strong><small>Chargeable income up to RM35,000</small>'));
        tr.appendChild(cell('&mdash;', 'is-muted rate-cell'));
        tr.appendChild(cell('&mdash;', 'is-muted'));
        tr.appendChild(cell('− ' + fmt(rebate)));
        body.appendChild(tr);
    }

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Tax payable'));
    totalRow.appendChild(cell(''));
    totalRow.appendChild(cell(''));
    totalRow.appendChild(cell(fmt(taxPayable)));
    body.appendChild(totalRow);
}

/**
 * ====================================================================
 * HOME LOAN SIMULATION
 * ====================================================================
 * The tiles and the split bar describe the loan as contracted — the instalment
 * the bank asks for and what that adds up to over the full tenure. The extra
 * payment block owns the what-if, and the schedule follows whatever extras are
 * in play, since that is the run the borrower would actually live through.
 */
const LOAN_MAX_YEARS = 50;

// Banks here lend up to 90% of the price on a first or second home.
const LOAN_MAX_MARGIN = 90;

// The deposit can be typed as ringgit or as a share of the price, and each box
// fills the other in. Whichever one was last touched is the one that leads —
// otherwise the pair would fight over the value the moment the price changes.
let loanDownBy = 'pct';

/**
 * Settle the deposit from whichever box the user is working in, and write the
 * answer into the other one. Nothing is filled in while the price is still
 * blank, since every percentage of nothing is zero and that would wipe the
 * figure the user just typed.
 */
function downPayment(price, rmId, pctId, leadBy) {
    const rmField  = $(rmId);
    const pctField = $(pctId);

    if (leadBy === 'rm') {
        const down = Math.min(Math.max(0, num(rmId)), price);
        const share = price > 0 ? round2(down / price * 100) : 0;
        if (price > 0 && pctField) pctField.value = String(share);
        return { down, share };
    }

    const share = Math.min(100, Math.max(0, num(pctId)));
    const down  = round2(price * share / 100);
    if (price > 0 && rmField) rmField.value = String(down);
    return { down, share };
}

function paintSchedule(bodyId, plan, view) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    const frag = document.createDocumentFragment();
    const yearly = view === 'year';
    const rows = yearly ? loanYearRows(plan.rows) : plan.rows;

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'band-row';
        tr.appendChild(cell(yearly
            ? '<strong>Year ' + row.year + '</strong><small>' +
              row.count + (row.count === 1 ? ' payment' : ' payments') + '</small>'
            : '<strong>Month ' + row.month + '</strong><small>Year ' + Math.ceil(row.month / 12) + '</small>'));
        tr.appendChild(cell(fmt(row.payment, 0)));
        tr.appendChild(cell(fmt(row.principal, 0)));
        tr.appendChild(cell(fmt(row.interest, 0), 'is-minus'));
        tr.appendChild(cell(fmt(row.balance, 0), 'is-strong'));
        frag.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Total'));
    totalRow.appendChild(cell(fmt(plan.totalPaid, 0)));
    totalRow.appendChild(cell(fmt(plan.totalPrincipal, 0)));
    totalRow.appendChild(cell(fmt(plan.totalInterest, 0)));
    totalRow.appendChild(cell('0'));
    frag.appendChild(totalRow);

    body.appendChild(frag);
}

function renderLoan() {
    const price  = Math.max(0, num('loanPrice'));
    const rate   = Math.max(0, num('loanRate'));
    const years  = Math.min(LOAN_MAX_YEARS, Math.max(0, Math.round(num('loanTenure'))));
    const months = years * 12;

    const { down, share: downPct } = downPayment(price, 'loanDown', 'loanDownPct', loanDownBy);
    const amount = round2(price - down);
    const margin = price > 0 ? amount / price * 100 : 0;

    // The preset buttons are a shortcut into the field above them, not a separate
    // input — a rate or a deposit typed by hand simply leaves no preset lit.
    const downSeg = $('loanDownSeg');
    if (downSeg) setSegment(downSeg, String(downPct));
    const rateSeg = $('loanRateSeg');
    if (rateSeg) setSegment(rateSeg, String(rate));

    set('loanTallyPrice', money(price));
    set('loanTallyDownLabel', 'Down payment ' + pct(downPct, downPct % 1 ? 1 : 0));
    set('loanTallyDown', '− ' + money(down));
    set('loanTallyAmount', money(amount));
    set('loanMarginNote', price <= 0 || amount <= 0
        ? 'Banks here lend up to 90% of the price on a first or second home — a third one is capped at 70%.'
        : margin > LOAN_MAX_MARGIN
            ? 'You are financing ' + pct(margin, 0) + ' of the price. Banks cap a first or second home at 90%, so this needs a bigger deposit.'
            : 'You are financing ' + pct(margin, 0) + ' of the price, inside the 90% banks lend on a first or second home.');

    $('loan-results').classList.toggle('is-empty', amount <= 0 || months <= 0);
    if (amount <= 0 || months <= 0) return;

    const instalment = loanInstalment(amount, rate, months);
    const base = loanSchedule({ principal: amount, annualRate: rate, months, instalment });

    // --- headline tiles ---
    set('loanMonthly', money(instalment));
    set('loanMonthlyFoot', formatMonths(months) + ' · ' + months + ' payments');
    set('loanInterest', money(base.totalInterest));
    set('loanInterestFoot', pct(base.totalInterest / amount * 100, 0) + ' on top of what you borrow');
    set('loanTotal', money(base.totalPaid));
    set('loanTotalFoot', 'on ' + money(amount) + ' borrowed');

    // --- principal vs interest bar ---
    const share = (v) => (base.totalPaid ? v / base.totalPaid * 100 : 0).toFixed(3) + '%';
    $('segLoanPrincipal').style.width = share(base.totalPrincipal);
    $('segLoanInterest').style.width  = share(base.totalInterest);
    set('loanSplitNote', money(base.totalPaid) + ' over ' + formatMonths(months));
    set('legLoanPrincipal', money(base.totalPrincipal));
    set('legLoanInterest', money(base.totalInterest));
    set('legLoanPrincipalPct', pct(base.totalPaid ? base.totalPrincipal / base.totalPaid * 100 : 0, 0));
    set('legLoanInterestPct', pct(base.totalPaid ? base.totalInterest / base.totalPaid * 100 : 0, 0));

    // --- extra payment simulation ---
    const extraMonthly = Math.max(0, num('loanExtra'));
    const lumpSum      = Math.max(0, num('loanLump'));
    const lumpMonth    = Math.min(months, Math.max(1, Math.round(num('loanLumpYear'))) * 12);
    const paysExtra    = extraMonthly > 0 || lumpSum > 0;

    const plan = paysExtra
        ? loanSchedule({ principal: amount, annualRate: rate, months, instalment, extraMonthly, lumpSum, lumpMonth })
        : base;

    const saved       = round2(base.totalInterest - plan.totalInterest);
    const monthsSaved = base.months - plan.months;

    set('loanBaseInterest', money(base.totalInterest));
    set('loanNewInterest', money(plan.totalInterest));
    set('loanNewTerm', formatMonths(plan.months));
    set('loanSaved', money(saved));
    set('loanExtraNote', monthsSaved > 0
        ? formatMonths(monthsSaved) + ' off the tenure'
        : 'Anything above the instalment comes straight off the balance');

    // --- schedule ---
    const view = (($('loanView') || {}).dataset || {}).value || 'year';
    set('loanColPeriod', view === 'year' ? 'Year' : 'Month');
    set('loanColPaid', view === 'year' ? 'Paid in' : 'Instalment');
    set('loanScheduleNote', paysExtra
        ? 'Including your extra payments · cleared in ' + formatMonths(plan.months)
        : 'Rounded to the ringgit · ' + formatMonths(plan.months) + ' of payments');

    paintSchedule('loanScheduleBody', plan, view);
}

/**
 * ====================================================================
 * CAR LOAN SIMULATION
 * ====================================================================
 * The panel settles what is being borrowed; the results answer the two things a
 * flat rate hides. First what it really costs, since 3% flat is nowhere near 3%
 * on a housing loan. Second what happens if the car is sold or settled early,
 * which is where the Rule of 78 bites — there is no "pay extra" here, because
 * the term charges were fixed the day the agreement was signed.
 */
const CAR_MAX_YEARS = 9;

// Hire purchase here is capped at 90% of the price.
const CAR_MAX_MARGIN = 90;

let carDownBy = 'pct';

// The settlement point can be given as a year or as a month, and — like the
// deposit pair — whichever box was last typed into is the one that leads.
let carSettleBy = 'year';

/**
 * Months paid off by the time the agreement is settled, with the other box
 * filled in to match. It is held one month short of the full term, since
 * settling on the very last instalment is just finishing the loan.
 */
function carSettlePoint(months) {
    const yearField  = $('carSettleYear');
    const monthField = $('carSettleMonth');
    const cap = (m) => Math.min(months - 1, Math.max(1, m));

    if (carSettleBy === 'month') {
        const paid = cap(Math.round(num('carSettleMonth')));
        if (yearField) yearField.value = String(Math.max(1, Math.round(paid / 12)));
        return paid;
    }

    const paid = cap(Math.max(1, Math.round(num('carSettleYear'))) * 12);
    if (monthField) monthField.value = String(paid);
    return paid;
}

function renderCar() {
    const price  = Math.max(0, num('carPrice'));
    const rate   = Math.max(0, num('carRate'));
    const years  = Math.min(CAR_MAX_YEARS, Math.max(0, Math.round(num('carTenure'))));
    const months = years * 12;

    const { down, share: downPct } = downPayment(price, 'carDown', 'carDownPct', carDownBy);
    const amount = round2(price - down);
    const margin = price > 0 ? amount / price * 100 : 0;

    const downSeg = $('carDownSeg');
    if (downSeg) setSegment(downSeg, String(downPct));
    const rateSeg = $('carRateSeg');
    if (rateSeg) setSegment(rateSeg, String(rate));

    set('carTallyPrice', money(price));
    set('carTallyDownLabel', 'Down payment ' + pct(downPct, downPct % 1 ? 1 : 0));
    set('carTallyDown', '− ' + money(down));
    set('carTallyAmount', money(amount));
    set('carMarginNote', price <= 0 || amount <= 0
        ? 'Hire purchase here is capped at 90% of the price over a maximum of 9 years.'
        : margin > CAR_MAX_MARGIN
            ? 'You are financing ' + pct(margin, 0) + ' of the price. Hire purchase is capped at 90%, so this needs at least ' +
              money(round2(price * (100 - CAR_MAX_MARGIN) / 100)) + ' down.'
            : 'You are financing ' + pct(margin, 0) + ' of the price, inside the 90% a hire purchase covers.');

    $('car-results').classList.toggle('is-empty', amount <= 0 || months <= 0);
    if (amount <= 0 || months <= 0) return;

    const hp = hirePurchase(amount, rate, months);

    // --- headline tiles ---
    set('carMonthly', money(hp.instalment));
    set('carMonthlyFoot', formatMonths(months) + ' · ' + months + ' payments');
    set('carInterest', money(hp.interest));
    set('carInterestFoot', pct(hp.interest / amount * 100, 0) + ' on top of what you borrow');
    set('carTotal', money(hp.total));
    set('carTotalFoot', 'on ' + money(amount) + ' borrowed');

    // --- principal vs interest bar ---
    const share = (v) => (hp.total ? v / hp.total * 100 : 0).toFixed(3) + '%';
    $('segCarPrincipal').style.width = share(amount);
    $('segCarInterest').style.width  = share(hp.interest);
    set('carSplitNote', money(hp.total) + ' over ' + formatMonths(months));
    set('legCarPrincipal', money(amount));
    set('legCarInterest', money(hp.interest));
    set('legCarPrincipalPct', pct(hp.total ? amount / hp.total * 100 : 0, 0));
    set('legCarInterestPct', pct(hp.total ? hp.interest / hp.total * 100 : 0, 0));
    set('carOutlay', money(round2(hp.total + down)));

    // --- flat rate against the reducing-balance rate it really works out to ---
    const effective = effectiveRate(amount, hp.instalment, months);
    const reducing  = round2(loanInstalment(amount, rate, months) * months - amount);

    set('carFlatRate', pct(rate, rate % 1 ? 2 : 0) + ' flat');
    set('carEffRate', pct(effective, 2) + ' a year');
    set('carReducingLabel', 'Interest at ' + pct(rate, rate % 1 ? 2 : 0) + ' on a reducing balance');
    set('carReducingInterest', money(reducing));
    set('carFlatPremium', '+ ' + money(round2(hp.interest - reducing)));
    set('carEffectiveNote', rate > 0
        ? pct(rate, rate % 1 ? 2 : 0) + ' flat works out to ' + pct(effective, 2) + ' reducing balance'
        : 'No interest, so nothing to compare');

    // --- early settlement, Rule of 78 ---
    const monthsPaid   = carSettlePoint(months);
    const monthsLeft   = months - monthsPaid;
    const outstanding  = round2(hp.instalment * monthsLeft);
    const rebate       = ruleOf78Rebate(hp.interest, months, monthsPaid);
    const settlement   = round2(outstanding - rebate);
    const interestPaid = round2(hp.interest - rebate);

    const yearField = $('carSettleYear');
    if (yearField) yearField.max = String(years);
    const monthField = $('carSettleMonth');
    if (monthField) monthField.max = String(months - 1);

    set('carSettleLeftLabel', monthsLeft + (monthsLeft === 1 ? ' instalment' : ' instalments') + ' still to run');
    set('carSettleOutstanding', money(outstanding));
    set('carSettleRebate', '− ' + money(rebate));
    set('carSettleAmount', money(settlement));
    set('carSettleInterest', money(interestPaid));
    set('carSettleNote', 'Settling after ' + formatMonths(monthsPaid) + ' hands back ' +
        pct(hp.interest ? rebate / hp.interest * 100 : 0, 0) + ' of the charges');

    // --- schedule ---
    const view = (($('carView') || {}).dataset || {}).value || 'year';
    set('carColPeriod', view === 'year' ? 'Year' : 'Month');
    set('carColPaid', view === 'year' ? 'Paid in' : 'Instalment');
    set('carScheduleNote', 'Rounded to the ringgit · ' + formatMonths(months) + ' of payments');

    paintSchedule('carScheduleBody', hirePurchaseSchedule({
        principal: amount, months, instalment: hp.instalment, interest: hp.interest,
    }), view);
}

/**
 * ====================================================================
 * PERSONAL LOAN SIMULATION
 * ====================================================================
 * Nothing here is new arithmetic — a personal loan is a hire purchase without
 * the car when it is quoted flat, and a housing loan without the house when it
 * is quoted on a reducing balance. What is worth showing is the difference
 * between those two on the same number, since the advertised rate is nearly
 * always the flat one and it is the figure people compare against a mortgage.
 */
const PERSONAL_MAX_MONTHS = 120;   // banks here write personal loans up to 10 years

// Stamp duty on a loan agreement, used to fill the fee field's placeholder.
const STAMP_DUTY = 0.005;

// Like the loan deposit pair, the tenure can be given in years or in months and
// whichever box was last typed into leads.
let plTenureBy = 'years';

function personalTenure() {
    const yearField  = $('plYears');
    const monthField = $('plMonths');
    const cap = (m) => Math.min(PERSONAL_MAX_MONTHS, Math.max(1, m));

    if (plTenureBy === 'months') {
        const months = cap(Math.round(num('plMonths')));
        if (yearField) yearField.value = String(Math.round(months / 12 * 10) / 10);
        return months;
    }

    const asked  = Math.round(num('plYears') * 12);
    const months = cap(asked);
    if (monthField) monthField.value = String(months);
    // A tenure longer than a bank will write is pulled back in both boxes, so the
    // years box never sits there claiming a term the instalment is not based on.
    if (months !== asked && yearField) yearField.value = String(Math.round(months / 12 * 10) / 10);
    return months;
}

/** The two ways the same rate can be charged, side by side, with the quote marked. */
function paintBasisCompare(bodyId, options, basis) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    options.forEach((option) => {
        const chosen = option.key === basis;
        const tr = document.createElement('tr');
        tr.className = chosen ? 'band-row is-chosen' : 'band-row';
        tr.appendChild(cell(
            '<strong>' + option.label + (chosen ? ' <span class="tag">your quote</span>' : '') + '</strong>' +
            '<small>' + option.note + '</small>'));
        tr.appendChild(cell(fmt(option.instalment), chosen ? 'is-strong' : ''));
        tr.appendChild(cell(fmt(option.interest), 'is-minus'));
        tr.appendChild(cell(fmt(option.total), chosen ? 'is-strong' : ''));
        body.appendChild(tr);
    });
}

function renderPersonal() {
    const amount = Math.max(0, num('plAmount'));
    const rate   = Math.max(0, num('plRate'));
    const fees   = Math.max(0, num('plFees'));
    const months = personalTenure();
    const basis  = (($('plBasisSeg') || {}).dataset || {}).value || 'flat';

    const tenureSeg = $('plTenureSeg');
    if (tenureSeg) setSegment(tenureSeg, String(months));
    const rateSeg = $('plRateSeg');
    if (rateSeg) setSegment(rateSeg, String(rate));

    // Stamp duty is the fee everyone pays, so it stands in as the suggested figure.
    const feeField = $('plFees');
    if (feeField) feeField.placeholder = fmt(round2(amount * STAMP_DUTY), 0);

    set('plTallyAmount', money(amount));
    set('plTallyFees', '− ' + money(fees));
    set('plTallyCash', money(round2(Math.max(0, amount - fees))));

    $('personal-results').classList.toggle('is-empty', amount <= 0 || months <= 0);
    if (amount <= 0 || months <= 0) return;

    // The same rate, charged both ways.
    const flat = hirePurchase(amount, rate, months);
    const reducingInstalment = loanInstalment(amount, rate, months);
    // The instalment is rounded to the sen before the totals are taken off it, the
    // way the bank bills it — at 0% that rounding can land a few sen under the
    // loan itself, which is not a negative interest charge.
    const reducingInterest = round2(Math.max(0, reducingInstalment * months - amount));
    const reducing = {
        instalment: reducingInstalment,
        interest:   reducingInterest,
        total:      round2(amount + reducingInterest),
    };

    const quote = basis === 'flat' ? flat : reducing;
    const plan  = basis === 'flat'
        ? hirePurchaseSchedule({ principal: amount, months, instalment: flat.instalment, interest: flat.interest })
        : loanSchedule({ principal: amount, annualRate: rate, months, instalment: reducing.instalment });

    // --- headline tiles ---
    set('plMonthly', money(quote.instalment));
    set('plMonthlyFoot', formatMonths(months) + ' · ' + months + ' payments');
    set('plInterest', money(quote.interest));
    set('plInterestFoot', pct(quote.interest / amount * 100, 0) + ' on top of what you borrow');
    set('plTotal', money(quote.total));
    set('plTotalFoot', 'on ' + money(amount) + ' borrowed');

    // --- what the loan costs ---
    const outlay = round2(quote.total + fees);
    const share  = (v) => (outlay ? v / outlay * 100 : 0).toFixed(3) + '%';
    $('segPlPrincipal').style.width = share(amount);
    $('segPlInterest').style.width  = share(quote.interest);
    $('segPlFees').style.width      = share(fees);

    // A fee is a sliver next to the loan, so it gets a decimal rather than a 0%.
    const pctOf = (v) => {
        const p = outlay ? v / outlay * 100 : 0;
        return pct(p, p > 0 && p < 1 ? 1 : 0);
    };
    set('plSplitNote', money(outlay) + ' over ' + formatMonths(months));
    set('legPlPrincipal', money(amount));
    set('legPlPrincipalPct', pctOf(amount));
    set('legPlInterest', money(quote.interest));
    set('legPlInterestPct', pctOf(quote.interest));
    set('legPlFees', money(fees));
    set('legPlFeesPct', pctOf(fees));

    const cost = round2(quote.interest + fees);
    set('plCostPerLabel', fees > 0 ? 'Interest and fees per ringgit borrowed' : 'Interest per ringgit borrowed');
    set('plCostPer', money(round2(cost / amount)));
    set('plCostTotal', money(cost));

    // --- flat against reducing, on the same quoted rate ---
    paintBasisCompare('plCompareBody', [
        { key: 'flat', label: 'Flat', note: 'Interest on the full amount, every year of the tenure',
          instalment: flat.instalment, interest: flat.interest, total: flat.total },
        { key: 'reducing', label: 'Reducing balance', note: 'Interest on what is still owed, month by month',
          instalment: reducing.instalment, interest: reducing.interest, total: reducing.total },
    ], basis);

    const effective = effectiveRate(amount, flat.instalment, months);
    const gap       = round2(flat.interest - reducing.interest);
    const rateText  = pct(rate, rate % 1 ? 2 : 0);

    set('plCompareNote', rate > 0 ? 'Both at ' + rateText + ' over ' + formatMonths(months) : 'No interest, so nothing to compare');
    set('plEffLabel', basis === 'flat'
        ? rateText + ' flat is really, on a reducing balance'
        : 'The flat rate that would ask the same instalment');
    set('plEffRate', rate > 0
        ? (basis === 'flat'
            ? pct(effective, 2) + ' a year'
            : pct(reducing.interest / amount / (months / 12) * 100, 2) + ' flat')
        : '—');
    set('plGapLabel', basis === 'flat' ? 'What the flat basis costs you extra' : 'What the reducing basis saves you');
    set('plGap', (basis === 'flat' ? '+ ' : '− ') + money(gap));

    // --- early settlement ---
    const settleField = $('plSettleMonth');
    if (settleField) settleField.max = String(months - 1);

    // Settling on the very last instalment is just finishing the loan, so the
    // point is held one month short of the term — and written back, since a
    // figure past the end of a shortened tenure would otherwise sit there.
    const asked      = Math.round(num('plSettleMonth'));
    const monthsPaid = Math.min(months - 1, Math.max(1, asked));
    if (settleField && settleField.value !== '' && asked !== monthsPaid) settleField.value = String(monthsPaid);
    const monthsLeft = months - monthsPaid;
    const remaining  = round2(quote.instalment * monthsLeft);

    // On a flat loan the term charges were fixed the day it was signed, so what
    // comes back is a rebate on the unearned part. On a reducing balance there is
    // nothing to give back — the interest simply stops with the balance.
    const settled = basis === 'flat'
        ? round2(remaining - ruleOf78Rebate(flat.interest, months, monthsPaid))
        : plan.rows[monthsPaid - 1].balance;

    const interestPaid = basis === 'flat'
        ? round2(flat.interest - ruleOf78Rebate(flat.interest, months, monthsPaid))
        : round2(plan.rows.slice(0, monthsPaid).reduce((sum, row) => sum + row.interest, 0));

    set('plSettleLeftLabel', monthsLeft + (monthsLeft === 1 ? ' instalment' : ' instalments') + ' still to run');
    set('plSettleOutstanding', money(remaining));
    set('plSettleRebateLabel', basis === 'flat' ? 'Rebate on term charges — Rule of 78' : 'Interest you never reach');
    set('plSettleRebate', '− ' + money(round2(remaining - settled)));
    set('plSettleAmount', money(settled));
    set('plSettleInterest', money(interestPaid));
    set('plSettleNote', 'Settling after ' + formatMonths(monthsPaid) + ' saves ' +
        money(round2(quote.interest - interestPaid)) + ' of interest');
    set('plSettleFoot', basis === 'flat'
        ? 'The rebate follows the Rule of 78, which front-loads the interest — settle halfway through and you get back far less than half the term charges. Islamic financing calls this rebate ibra’ and Bank Negara requires banks to grant it; a conventional loan usually wants notice and may charge a fee.'
        : 'On a reducing balance the settlement figure is simply the balance left, since every month’s interest was charged on what you still owed. Banks may still ask for notice or an early settlement fee.');

    // --- schedule ---
    const view = (($('plView') || {}).dataset || {}).value || 'month';
    set('plColPeriod', view === 'year' ? 'Year' : 'Month');
    set('plColPaid', view === 'year' ? 'Paid in' : 'Instalment');
    set('plScheduleNote', 'Rounded to the ringgit · ' +
        (basis === 'flat' ? 'even split every month' : 'interest first, principal later'));

    paintSchedule('plScheduleBody', plan, view);
}

/**
 * ====================================================================
 * DSR SIMULATION
 * ====================================================================
 * Debt service ratio is commitments over income, and the whole argument is in
 * those two words. Income means what is left after EPF, SOCSO, EIS and PCB —
 * which this app already works out for the payslip — and commitments mean the
 * debts a bank can see on CCRIS, not what living actually costs.
 */
const DSR_EPF_RATE = 11;

// A card is counted at 5% of what is owing on it, whatever the bank's own
// minimum payment happens to be.
const CARD_MIN_RATE = 0.05;

// Typical ceilings rather than rules — a payroll deduction at source is what
// buys a civil servant the higher one.
const DSR_CAPS = { private: 60, glc: 70, government: 80 };

const DSR_CAP_NOTES = {
    private: 'Private-sector borrowers are usually held near 60%, though a large income can take you past it.',
    glc: 'A GLC payslip is steadier than most private ones, and banks lend a little further against it.',
    government: 'A civil servant repaying through Biro Perkhidmatan Angkasa has the instalment taken before the pay arrives, so banks go to 80% and sometimes beyond.',
};

const DSR_BANDS = [
    { upTo: 30,       label: 'Comfortable',   note: 'The ratio will not be what your application turns on' },
    { upTo: 40,       label: 'Healthy',       note: 'The level a bank likes to see' },
    { upTo: 60,       label: 'Acceptable',    note: 'Approved, though the amount may be trimmed' },
    { upTo: 70,       label: 'High risk',     note: 'Needs a big income, a guarantor or something pledged' },
    { upTo: Infinity, label: 'Over-extended', note: 'Turned down almost everywhere' },
];

const dsrBand = (ratio) => DSR_BANDS.find((band) => ratio <= band.upTo) || DSR_BANDS[DSR_BANDS.length - 1];

/** What a bank makes of the money still left over once the debts are paid. */
function ndiVerdict(ndi) {
    if (ndi >= 2500) return 'Comfortable — plenty left to live on';
    if (ndi >= 1500) return 'Moderate — enough, with little slack';
    if (ndi > 0)     return 'Tight — banks stop lending well before the ratio does';
    return 'Nothing left — the commitments already take everything';
}

/** The three loans the room could be spent on, each on its own terms. */
const DSR_LOAN_SHAPES = [
    { key: 'home', label: 'A home', basis: 'reducing', rateId: 'dsrHomeRate', yearsId: 'dsrHomeYears',
      maxYears: 50, note: (loan) => 'About ' + money(round2(loan / 0.9)) + ' of property with 10% down' },
    { key: 'car', label: 'A car', basis: 'flat', rateId: 'dsrCarRate', yearsId: 'dsrCarYears',
      maxYears: 9, note: (loan) => 'About ' + money(round2(loan / 0.9)) + ' on the road with 10% down' },
    { key: 'personal', label: 'A personal loan', basis: 'flat', rateId: 'dsrPersonalRate', yearsId: 'dsrPersonalYears',
      maxYears: 10, note: () => 'Nothing pledged, so the rate does the work' },
];

function paintDsrBands(bodyId, income, ratio) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    const here = dsrBand(ratio);
    DSR_BANDS.forEach((band, index) => {
        const from  = index ? DSR_BANDS[index - 1].upTo : 0;
        const label = band.upTo === Infinity
            ? 'Over ' + pct(from, 0)
            : index === 0 ? 'Under ' + pct(band.upTo, 0) : pct(from, 0) + ' – ' + pct(band.upTo, 0);

        const tr = document.createElement('tr');
        tr.className = band === here ? 'band-row is-chosen' : 'band-row';
        tr.appendChild(cell('<strong>' + label + (band === here ? ' <span class="tag">you</span>' : '') + '</strong>'));
        tr.appendChild(cell('<strong>' + band.label + '</strong><small>' + band.note + '</small>'));
        tr.appendChild(cell(band.upTo === Infinity
            ? 'more than ' + fmt(round2(income * from / 100), 0)
            : 'up to ' + fmt(round2(income * band.upTo / 100), 0)));
        body.appendChild(tr);
    });
}

function paintDsrBorrowing(bodyId, room) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    DSR_LOAN_SHAPES.forEach((shape) => {
        const rate   = Math.max(0, num(shape.rateId));
        const years  = Math.min(shape.maxYears, Math.max(1, Math.round(num(shape.yearsId))));
        const months = years * 12;
        const loan   = shape.basis === 'reducing'
            ? maxLoanReducing(room, rate, months)
            : maxLoanFlat(room, rate, months);

        const tr = document.createElement('tr');
        tr.className = 'band-row';
        tr.appendChild(cell('<strong>' + shape.label + '</strong><small>' +
            (loan > 0 ? shape.note(loan) : 'No room for another instalment') + '</small>'));
        tr.appendChild(cell('<span class="rate-pill">' + pct(rate, rate % 1 ? 2 : 0) +
            (shape.basis === 'flat' ? ' flat' : '') + '</span>', 'rate-cell'));
        tr.appendChild(cell(formatMonths(months)));
        tr.appendChild(cell(fmt(loan, 0), 'is-strong'));
        body.appendChild(tr);
    });
}

function renderDsr() {
    const basis   = (($('dsrBasisSeg') || {}).dataset || {}).value || 'gross';
    const employ  = (($('dsrEmploySeg') || {}).dataset || {}).value || 'private';
    const typed   = Math.max(0, num('dsrIncome'));
    const allowed = Math.max(0, num('dsrAllowance'));
    const varied  = Math.max(0, num('dsrVariable'));
    const haircut = segValue('dsrVariableSeg') || 80;
    const cap     = Math.min(100, Math.max(10, num('dsrCap') || 60));

    set('dsrIncomePer', basis === 'gross' ? 'before deductions' : 'what reaches your account');
    set('dsrIncomeHint', basis === 'gross'
        ? 'EPF at 11%, SOCSO, EIS and PCB come off before the bank divides — DSR is worked on net pay, not the number on your offer letter.'
        : 'The figure that actually reaches your account each month, after EPF, SOCSO, EIS and PCB.');
    set('dsrCapHint', DSR_CAP_NOTES[employ] + ' Every bank sets its own, and moves it with the year.');

    // A fixed allowance is wages like any other, so it is taxed and contributed
    // on before it becomes income the bank can count.
    const wage = round2(typed + allowed);
    const deductions = basis === 'gross' && wage > 0
        ? round2(epfContribution(wage, DSR_EPF_RATE) +
                 socsoContribution(wage, DEFAULT_SOCSO_CATEGORY).employee +
                 eisContribution(wage).employee +
                 calculatePcbTax(wage, 0, DSR_EPF_RATE))
        : 0;

    const counted = round2(varied * haircut / 100);
    const income  = round2(wage - deductions + counted);

    set('dsrTallySalaryLabel', basis === 'gross' ? 'Salary and allowances' : 'Take-home pay and allowances');
    set('dsrTallySalary', money(wage));
    const deductRow = $('dsrDeductRow');
    if (deductRow) deductRow.hidden = basis !== 'gross';
    set('dsrTallyDeduct', '− ' + money(deductions));
    set('dsrTallyExtraLabel', varied > 0
        ? 'Variable income, counted at ' + pct(haircut, 0)
        : 'Commission, rental, overtime');
    set('dsrTallyExtra', money(counted));
    set('dsrTallyIncome', money(income));

    $('dsr-results').classList.toggle('is-empty', income <= 0);
    if (income <= 0) return;

    // --- commitments ---
    const card = round2(Math.max(0, num('dsrCardBalance')) * CARD_MIN_RATE);
    const commitments = round2(
        Math.max(0, num('dsrHome')) + Math.max(0, num('dsrCar')) + Math.max(0, num('dsrPersonal')) +
        Math.max(0, num('dsrPtptn')) + card + Math.max(0, num('dsrOther')));

    set('dsrCardLabel', 'Credit card, counted at 5% of ' + money(Math.max(0, num('dsrCardBalance'))));
    set('dsrCardMin', money(card));
    set('dsrCommitTotal', money(commitments));
    set('dsrCommitNote', commitments > 0
        ? money(commitments) + ' a month · ' + pct(commitments / income * 100, 1) + ' of your income'
        : 'Nothing owing yet');

    // --- the ratio itself ---
    const ratio = commitments / income * 100;
    const limit = round2(income * cap / 100);
    const room  = round2(Math.max(0, limit - commitments));
    const ndi   = round2(income - commitments);
    const band  = dsrBand(ratio);

    set('dsrRatio', pct(ratio, 1));
    set('dsrRatioFoot', band.label + ' · ' + money(commitments) + ' against ' + money(income));
    set('dsrRoom', money(room));
    set('dsrRoomFoot', room > 0
        ? 'before you reach the ' + pct(cap, 0) + ' limit'
        : 'You are ' + money(round2(commitments - limit)) + ' past the ' + pct(cap, 0) + ' limit');
    set('dsrNdi', (ndi < 0 ? '− ' : '') + money(Math.abs(ndi)));
    set('dsrNdiFoot', ndiVerdict(ndi));
    const ndiTile = $('dsrNdi');
    if (ndiTile) ndiTile.classList.toggle('is-minus', ndi < 0);

    // --- income bar ---
    const commitSeg = Math.min(commitments, income);
    const roomSeg   = Math.max(0, Math.min(limit, income) - commitSeg);
    const overSeg   = Math.max(0, income - commitSeg - roomSeg);
    const share = (v) => (income ? v / income * 100 : 0).toFixed(3) + '%';
    $('segDsrCommit').style.width = share(commitSeg);
    $('segDsrRoom').style.width   = share(roomSeg);
    $('segDsrOver').style.width   = share(overSeg);

    const pctOf = (v) => pct(income ? v / income * 100 : 0, 0);
    set('dsrIncomeNote', money(income) + ' counted · limit ' + pct(cap, 0));
    // The bar can only run to the end of the income; the legend still reports the
    // whole commitment, so a ratio past 100% is stated rather than clipped away.
    set('legDsrCommit', money(commitments));
    set('legDsrCommitPct', pctOf(commitments));
    set('legDsrRoom', money(roomSeg));
    set('legDsrRoomPct', pctOf(roomSeg));
    set('legDsrOver', money(overSeg));
    set('legDsrOverPct', pctOf(overSeg));

    set('dsrLimitLabel', 'Most a bank would let you commit ' + pct(cap, 0) + ' of ' + money(income));
    set('dsrLimitAmount', money(limit));
    set('dsrCommitAmount', '− ' + money(commitments));
    set('dsrRoomAmount', money(room));

    // --- how it reads, and what the room buys ---
    paintDsrBands('dsrBandBody', income, ratio);
    set('dsrBandNote', band.label + ' at ' + pct(ratio, 1));

    paintDsrBorrowing('dsrBorrowBody', room);
    set('dsrBorrowNote', room > 0
        ? 'On the ' + money(room) + ' a month you have left'
        : 'Nothing left to commit at a ' + pct(cap, 0) + ' limit');
}

/**
 * ====================================================================
 * SAVINGS GOAL SIMULATION
 * ====================================================================
 * The panel answers the one question the goal was set to ask — how much a month
 * — and the results then work the other way round, because that figure is
 * usually the one thing a saver cannot simply decide. So the second block takes
 * what they can actually spare and reports what it costs in time.
 */

// The deadline can be given as a number of months or as a date, and each fills
// the other in. Whichever box was last touched leads, the way the loan deposit
// pair works — otherwise the two would overwrite each other on every keystroke.
let goalTimeBy = 'months';

/** Settle the deadline from whichever box the user is working in. */
function goalHorizon() {
    const monthField = $('goalMonths');
    const dateField  = $('goalDate');
    const today      = new Date();
    const cap = (m) => Math.min(GOAL_MAX_MONTHS, Math.max(1, m));

    if (goalTimeBy === 'date' && dateField && dateField.value) {
        const asked  = wholeMonthsBetween(today, new Date(dateField.value + 'T00:00:00'));
        const months = cap(asked);
        if (monthField) monthField.value = String(months);
        // A date already gone, or one past the fifty years the plan runs, is
        // pulled back to the nearest deadline that can actually be saved for.
        if (months !== asked && dateField) dateField.value = isoDate(addMonths(today, months));
        return months;
    }

    const months = cap(Math.round(num('goalMonths')));
    if (dateField) dateField.value = isoDate(addMonths(today, months));
    return months;
}

function paintGoalSchedule(bodyId, plan, view, start) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    const yearly = view === 'year';
    const rows   = yearly ? goalYearRows(plan.rows) : plan.rows;
    const frag   = document.createDocumentFragment();

    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'band-row';

        // The row the target is met in is the one row worth finding in the table.
        const hitsTarget = plan.reached && (yearly
            ? plan.reached >= row.first && plan.reached <= row.last
            : plan.reached === row.month);
        if (hitsTarget) tr.classList.add('is-goal');

        tr.appendChild(cell(yearly
            ? '<strong>Year ' + row.year + '</strong><small>' +
              row.count + (row.count === 1 ? ' deposit' : ' deposits') + '</small>'
            : '<strong>Month ' + row.month + '</strong><small>' + monthLabel(addMonths(start, row.month)) + '</small>'));
        tr.appendChild(cell(fmt(row.deposit, 0)));
        tr.appendChild(cell(fmt(row.growth, 0), 'is-growth'));
        tr.appendChild(cell(fmt(row.balance, 0), 'is-strong'));
        frag.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Total'));
    totalRow.appendChild(cell(fmt(plan.deposits, 0)));
    totalRow.appendChild(cell(fmt(plan.growth, 0)));
    totalRow.appendChild(cell(fmt(plan.balance, 0)));
    frag.appendChild(totalRow);

    body.appendChild(frag);
}

function renderGoal() {
    const target = Math.max(0, num('goalTarget'));
    const saved  = Math.max(0, num('goalSaved'));
    const rate   = Math.max(0, num('goalReturn'));
    const months = goalHorizon();

    // The presets are shortcuts into the fields beside them, not separate inputs —
    // a figure typed by hand simply leaves no preset lit.
    const monthsSeg = $('goalMonthsSeg');
    if (monthsSeg) setSegment(monthsSeg, String(months));
    const returnSeg = $('goalReturnSeg');
    if (returnSeg) setSegment(returnSeg, String(rate));

    set('goalTallyTarget', money(target));
    set('goalTallySaved', '− ' + money(saved));
    set('goalTallyNeed', money(round2(Math.max(0, target - saved))));

    $('goal-results').classList.toggle('is-empty', target <= 0);
    if (target <= 0) return;

    const start    = new Date();
    const deadline = addMonths(start, months);
    const monthly  = goalDeposit({ target, opening: saved, annualRate: rate, months });
    const plan     = savingsSchedule({ opening: saved, monthly, annualRate: rate, months, target, settleLast: true });

    // --- headline tiles ---
    set('goalMonthly', money(monthly));
    set('goalMonthlyFoot', saved >= target
        ? 'You already have more than the target'
        : monthly <= 0
            ? pct(rate, 2) + ' a year carries you there on its own'
            : formatMonths(months) + ' · by ' + monthLabel(deadline));

    set('goalDeposits', money(plan.deposits));
    set('goalDepositsFoot', saved > 0
        ? 'on top of ' + money(saved) + ' you already had'
        : months + (months === 1 ? ' deposit' : ' deposits') + ' of ' + money(monthly));

    set('goalGrowth', money(plan.growth));
    set('goalGrowthFoot', rate > 0
        ? pct(rate, 2) + ' a year, credited monthly'
        : 'Nothing, at 0% — money in a current account stands still');

    // --- where the balance came from ---
    const share = (v) => (plan.balance ? v / plan.balance * 100 : 0).toFixed(3) + '%';
    $('segGoalOpening').style.width  = share(saved);
    $('segGoalDeposits').style.width = share(plan.deposits);
    $('segGoalGrowth').style.width   = share(plan.growth);

    const pctOf = (v) => pct(plan.balance ? v / plan.balance * 100 : 0, 0);
    set('goalMixNote', money(plan.balance) + ' by ' + monthLabel(deadline));
    set('legGoalOpening', money(saved));
    set('legGoalOpeningPct', pctOf(saved));
    set('legGoalDeposits', money(plan.deposits));
    set('legGoalDepositsPct', pctOf(plan.deposits));
    set('legGoalGrowth', money(plan.growth));
    set('legGoalGrowthPct', pctOf(plan.growth));
    set('goalEndLabel', 'Balance by ' + monthLabel(deadline));
    set('goalEndBalance', money(plan.balance));

    // --- what a smaller deposit costs in time ---
    const affordField = $('goalAffordAmount');
    if (affordField) affordField.placeholder = fmt(monthly, 0);

    const afford       = Math.max(0, num('goalAffordAmount')) || monthly;
    const affordMonths = monthsToGoal({ target, opening: saved, annualRate: rate, monthly: afford });
    const affordPlan   = savingsSchedule({ opening: saved, monthly: afford, annualRate: rate, months, target });
    const affordGap    = round2(target - affordPlan.balance);

    set('goalAffordNote', affordMonths < 0
        ? 'Not enough to ever get there'
        : affordMonths > months
            ? formatMonths(affordMonths - months) + ' past your deadline'
            : affordMonths === months
                ? 'Right on your deadline'
                : formatMonths(months - affordMonths) + ' early');
    set('goalAffordTimeLabel', 'How long ' + money(afford) + ' a month takes');
    set('goalAffordTime', affordMonths < 0
        ? 'More than ' + formatMonths(GOAL_MAX_MONTHS)
        : affordMonths === 0 ? 'Already there' : formatMonths(affordMonths));
    set('goalAffordDate', affordMonths < 0
        ? '—'
        : affordMonths === 0 ? 'Today' : monthLabel(addMonths(start, affordMonths)));
    set('goalAffordBalanceLabel', 'Balance by ' + monthLabel(deadline) + ' instead');
    set('goalAffordBalance', money(affordPlan.balance));
    set('goalAffordGapLabel', affordGap > 0 ? 'Short of the target by' : 'Over the target by');
    set('goalAffordGap', money(Math.abs(affordGap)));

    // --- schedule ---
    const view = (($('goalView') || {}).dataset || {}).value || 'month';
    set('goalColPeriod', view === 'year' ? 'Year' : 'Month');
    set('goalColPaid', view === 'year' ? 'Paid in' : 'Deposit');
    set('goalScheduleNote', plan.reached
        ? 'Target met in month ' + plan.reached + ' · ' + monthLabel(addMonths(start, plan.reached))
        : 'Rounded to the ringgit · ' + formatMonths(months) + ' of deposits');

    paintGoalSchedule('goalScheduleBody', plan, view, start);
}

/**
 * ====================================================================
 * COMPOUND INTEREST SIMULATION
 * ====================================================================
 */
const CI_REST_LABEL = { 1: 'monthly', 3: 'quarterly', 12: 'yearly' };

function renderCompound() {
    const initial = Math.max(0, num('ciInitial'));
    const monthly = Math.max(0, num('ciMonthly'));
    const rate    = Math.max(0, num('ciReturn'));
    const years   = Math.min(50, Math.max(1, Math.round(num('ciYears')) || 1));
    const rest    = Math.round(segValue('ciCompoundSeg')) || 1;
    const months  = years * 12;

    // The presets are shortcuts into the fields beside them — a figure typed by
    // hand simply leaves no preset lit.
    const yearsSeg = $('ciYearsSeg');
    if (yearsSeg) setSegment(yearsSeg, String(years));
    const returnSeg = $('ciReturnSeg');
    if (returnSeg) setSegment(returnSeg, String(rate));

    const contributed = round2(initial + monthly * months);
    set('ciTallyInitial', money(initial));
    set('ciTallyDepositsLabel', months + ' × ' + money(monthly));
    set('ciTallyDeposits', money(round2(monthly * months)));
    set('ciTallyIn', money(contributed));

    $('compound-results').classList.toggle('is-empty', contributed <= 0);
    if (contributed <= 0) return;

    const start = new Date();
    const end   = addMonths(start, months);
    const plan  = compoundSchedule({ opening: initial, monthly, annualRate: rate, months, everyMonths: rest });

    // --- headline tiles ---
    set('ciFinal', money(plan.balance));
    set('ciFinalFoot', formatMonths(months) + ' at ' + pct(rate, 2) + ' a year · ' +
        (CI_REST_LABEL[rest] || 'monthly') + ' rests · by ' + monthLabel(end));

    set('ciContributed', money(contributed));
    set('ciContributedFoot', initial > 0 && monthly > 0
        ? money(initial) + ' up front, then ' + money(monthly) + ' a month'
        : initial > 0
            ? 'Put in once and left alone'
            : months + ' contributions of ' + money(monthly));

    set('ciProfit', money(plan.growth));
    set('ciProfitFoot', plan.growth > 0
        ? 'Every RM 1 you put in became ' + money(plan.balance / contributed) +
          ' · ' + pct(plan.growth / plan.balance * 100, 0) + ' of the final value'
        : 'Nothing, at 0% — money in a current account stands still');

    // --- where the balance came from ---
    const share = (v) => (plan.balance ? v / plan.balance * 100 : 0).toFixed(3) + '%';
    $('segCiInitial').style.width  = share(initial);
    $('segCiDeposits').style.width = share(plan.deposits);
    $('segCiGrowth').style.width   = share(plan.growth);

    const pctOf = (v) => pct(plan.balance ? v / plan.balance * 100 : 0, 0);
    set('ciMixNote', money(plan.balance) + ' by ' + monthLabel(end));
    set('legCiInitial', money(initial));
    set('legCiInitialPct', pctOf(initial));
    set('legCiDeposits', money(plan.deposits));
    set('legCiDepositsPct', pctOf(plan.deposits));
    set('legCiGrowth', money(plan.growth));
    set('legCiGrowthPct', pctOf(plan.growth));

    // The month the money starts out-earning the saver is the moment compounding
    // takes over — worth naming, because it is late and then sudden.
    set('ciCrossLabel', plan.crossed
        ? 'Profit passed what you put in'
        : 'Profit passes what you put in');
    set('ciCross', plan.crossed
        ? monthLabel(addMonths(start, plan.crossed)) + ' · year ' + Math.ceil(plan.crossed / 12)
        : 'Not within ' + formatMonths(months));

    set('ciEndLabel', 'Final value by ' + monthLabel(end));
    set('ciEndBalance', money(plan.balance));

    // --- what inflation leaves of it ---
    const inflation = Math.max(0, num('ciInflation'));
    const real      = round2(plan.balance / Math.pow(1 + inflation / 100, months / 12));
    set('ciRealNote', inflation > 0
        ? pct(inflation, 2) + ' a year for ' + formatMonths(months)
        : 'At 0% inflation, a ringgit then is a ringgit now');
    set('ciRealNominalLabel', 'Final value on paper by ' + monthLabel(end));
    set('ciRealNominal', money(plan.balance));
    set('ciReal', money(real));
    set('ciRealLoss', money(round2(plan.balance - real)));

    // --- one lever at a time, against the plan above ---
    const finalOf = (opts) => compoundSchedule({
        opening: initial, monthly, annualRate: rate, months, everyMonths: rest, ...opts,
    }).balance;

    const wait = Math.min(5, Math.max(1, years - 1));   // a 3-year plan cannot be started 5 years late
    const levers = [
        { label: 'RM 100 more a month', note: money(monthly + 100) + ' a month', value: finalOf({ monthly: monthly + 100 }) },
        { label: '1% better return', note: pct(rate + 1, 2) + ' a year', value: finalOf({ annualRate: rate + 1 }) },
        { label: '5 more years', note: formatMonths(months + 60) + ' invested', value: finalOf({ months: months + 60 }) },
        { label: 'Start ' + formatMonths(wait * 12) + ' later', note: formatMonths(months - wait * 12) + ' invested', value: finalOf({ months: months - wait * 12 }) },
    ];

    set('ciLeverNote', 'Against ' + money(plan.balance) + ' as it stands');
    paintCompoundLevers('ciLeverBody', levers, plan.balance);

    // --- schedule ---
    const view = (($('ciView') || {}).dataset || {}).value || 'year';
    set('ciColPeriod', view === 'year' ? 'Year' : 'Month');
    set('ciColPaid', view === 'year' ? 'Paid in' : 'Contribution');
    // "Paid in" is the contributions column only — the initial sum is already
    // sitting in the opening balance, so it is not paid in again.
    set('ciScheduleNote', 'Rounded to the ringgit · ' + (initial > 0
        ? 'the ' + money(initial) + ' you started with is already in the balance'
        : formatMonths(months) + ' of contributions'));

    paintGoalSchedule('ciScheduleBody', plan, view, start);
}

/** The lever table: what one change is worth, and what it costs to skip it. */
function paintCompoundLevers(bodyId, levers, base) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    const frag = document.createDocumentFragment();
    levers.forEach((lever) => {
        const gap = round2(lever.value - base);
        const tr  = document.createElement('tr');
        tr.className = 'band-row';
        tr.appendChild(cell('<strong>' + lever.label + '</strong><small>' + lever.note + '</small>'));
        tr.appendChild(cell(fmt(lever.value, 0), 'is-strong'));
        tr.appendChild(cell((gap >= 0 ? '+' : '−') + ' ' + fmt(Math.abs(gap), 0), gap >= 0 ? 'is-growth' : 'is-minus'));
        frag.appendChild(tr);
    });
    body.appendChild(frag);
}

/**
 * ====================================================================
 * RETIREMENT SIMULATION
 * ====================================================================
 */
function renderRetirement() {
    const wanted   = Math.max(0, num('rtIncome'));
    const other    = Math.max(0, num('rtOther'));
    const ageNow   = Math.min(80, Math.max(16, Math.round(num('rtAge')) || 30));
    const retAge   = Math.max(ageNow, Math.round(num('rtRetireAge')) || ageNow);
    const endAge   = Math.max(retAge + 1, Math.round(num('rtLiveTo')) || retAge + 1);
    const savings  = Math.max(0, num('rtSavings'));
    const monthly  = Math.max(0, num('rtMonthly'));
    const preRate  = Math.max(0, num('rtReturn'));
    const postRate = Math.max(0, num('rtPostReturn'));
    const infl     = Math.max(0, num('rtInflation'));

    // The presets are shortcuts into the fields beside them.
    [['rtRetireSeg', retAge], ['rtLiveSeg', endAge], ['rtReturnSeg', preRate], ['rtInflationSeg', infl]]
        .forEach(([id, value]) => { const seg = $(id); if (seg) setSegment(seg, String(value)); });

    const toRet     = (retAge - ageNow) * 12;
    const retMonths = (endAge - retAge) * 12;
    const rise      = Math.pow(1 + infl / 100, toRet / 12);   // one ringgit today, on the day you stop
    const needToday = Math.max(0, round2(wanted - other));
    const firstDraw = round2(needToday * rise);

    set('rtTallyToday', money(wanted));
    set('rtTallyThenLabel', 'The same basket at ' + retAge);
    set('rtTallyThen', money(round2(wanted * rise)));
    set('rtTallyYearsLabel', 'Years the fund must carry you');
    set('rtTallyYears', formatMonths(retMonths));

    $('retire-results').classList.toggle('is-empty', wanted <= 0);
    if (wanted <= 0) return;

    /** The whole plan measured against one retirement age — used for the search below. */
    const planAt = (age) => {
        const months = (age - ageNow) * 12;
        const years  = (endAge - age) * 12;
        const first  = round2(needToday * Math.pow(1 + infl / 100, months / 12));
        return {
            fund:   compoundSchedule({ opening: savings, monthly, annualRate: preRate, months }).balance,
            needed: drawdownFund({ first, annualRate: postRate, inflation: infl, months: years }),
        };
    };

    const accum  = compoundSchedule({ opening: savings, monthly, annualRate: preRate, months: toRet });
    const fund   = accum.balance;
    const needed = drawdownFund({ first: firstDraw, annualRate: postRate, inflation: infl, months: retMonths });
    const gap    = round2(needed - fund);
    const short  = gap > 0.005;

    // --- headline tiles ---
    set('rtNeedLabel', 'Fund needed at ' + retAge);
    set('rtNeed', money(needed));
    set('rtNeedFoot', needToday <= 0
        ? 'Your other income already covers the lot'
        : money(firstDraw) + ' a month from ' + retAge + ', rising with prices');

    set('rtHave', money(fund));
    set('rtHaveFoot', toRet <= 0
        ? 'You are at retirement age already'
        : formatMonths(toRet) + ' of saving at ' + pct(preRate, 2) + ' a year');

    set('rtGapLabel', short ? 'Shortfall' : 'Surplus');
    set('rtGap', money(Math.abs(gap)));
    set('rtGapFoot', needed <= 0
        ? 'Nothing left to fund'
        : short
            ? pct(gap / needed * 100, 0) + ' of the fund still missing'
            : pct(-gap / needed * 100, 0) + ' more than you need');

    // --- the two bars, drawn on one scale ---
    const scale = Math.max(needed, fund, 1);
    const width = (v) => (v / scale * 100).toFixed(3) + '%';
    $('segRtSaved').style.width  = width(savings);
    $('segRtPaid').style.width   = width(accum.deposits);
    $('segRtGrowth').style.width = width(accum.growth);
    $('segRtNeed').style.width   = width(needed);

    const ofFund = (v) => pct(fund ? v / fund * 100 : 0, 0);
    set('rtBarNote', needed > 0 ? pct(Math.min(999, fund / needed * 100), 0) + ' of the way there' : 'Nothing to fund');
    set('rtBarHaveLabel', 'What you will have at ' + retAge);
    set('rtBarHave', money(fund));
    set('legRtSaved', money(savings));
    set('legRtSavedPct', ofFund(savings));
    set('legRtPaid', money(accum.deposits));
    set('legRtPaidPct', ofFund(accum.deposits));
    set('legRtGrowth', money(accum.growth));
    set('legRtGrowthPct', ofFund(accum.growth));

    set('rtBarNeedLabel', 'What you need at ' + retAge);
    set('rtBarNeed', money(needed));
    set('rtNeedLegLabel', needToday > 0
        ? money(firstDraw) + ' a month until ' + endAge + ', rising with prices'
        : 'Nothing — your other income covers it');
    set('legRtNeed', money(needed));

    // How far the fund you are actually on track for would carry you.
    const draw    = drawdownSchedule({ opening: fund, first: firstDraw, annualRate: postRate, inflation: infl, months: retMonths });
    const dryAge  = draw.depleted ? retAge + Math.floor((draw.depleted - 1) / 12) : 0;
    set('rtCoverLabel', 'What you are on track for pays you');
    set('rtCover', needToday <= 0
        ? 'For as long as you like'
        : draw.depleted
            ? 'until age ' + dryAge + ' · ' + formatMonths(retMonths - draw.depleted) + ' short'
            : 'to age ' + endAge + ', with ' + money(draw.balance) + ' left');
    set('rtBarGapLabel', short ? 'Short by' : 'Over by');
    set('rtBarGap', money(Math.abs(gap)));
    const barGap = $('rtBarGap');
    if (barGap) barGap.classList.toggle('is-minus', short);

    // --- three ways out ---
    // One search answers both cases: the earliest age at which the plan stands up.
    let breakEven = 0;
    for (let age = ageNow; age <= 100; age++) {
        const at = planAt(age);
        if (at.fund >= at.needed - 0.005) { breakEven = age; break; }
    }

    const required = goalDeposit({ target: needed, opening: savings, annualRate: preRate, months: toRet });
    const supports = round2(drawdownIncome({ fund, annualRate: postRate, inflation: infl, months: retMonths }) / rise + other);

    set('rtFixTitle', short ? 'Three ways to close the gap' : 'What the surplus buys you');
    set('rtFixNote', short
        ? 'Any one of these on its own is enough'
        : 'You are ahead — here is the room you have');

    set('rtFixSaveLabel', short
        ? 'Save this a month instead of ' + money(monthly)
        : 'You could put in as little as');
    set('rtFixSave', toRet <= 0
        ? 'No time left to save'
        : money(required) + (short ? ' · ' + money(round2(required - monthly)) + ' more' : ' a month'));

    set('rtFixWorkLabel', short ? 'Or keep working until' : 'You could stop as early as');
    set('rtFixWork', !breakEven
        ? 'Working longer alone will not do it'
        : breakEven <= ageNow
            ? 'You could stop today'
            : 'age ' + breakEven + ' · ' + formatMonths(Math.abs(breakEven - retAge) * 12) +
              (breakEven > retAge ? ' longer' : ' sooner'));

    set('rtFixLiveLabel', short ? 'Or live on this instead' : 'Or you could live on');
    set('rtFixLive', money(supports) + ' a month, today\'s money');

    // --- year by year, straight through both halves of the plan ---
    const rows = accum.rows
        .map((row) => ({ month: row.month, flow: row.deposit, growth: row.growth, balance: row.balance }))
        .concat(draw.rows.map((row) => ({ month: toRet + row.month, flow: -row.withdraw, growth: row.growth, balance: row.balance })));

    const view = (($('rtView') || {}).dataset || {}).value || 'year';
    set('rtColPeriod', view === 'year' ? 'Age' : 'Month');
    set('rtScheduleNote', draw.depleted
        ? 'Runs dry at age ' + dryAge + ' · rounded to the ringgit'
        : 'Rounded to the ringgit · ' + formatMonths(toRet) + ' saving, then ' + formatMonths(retMonths) + ' spending');

    paintRetirementTable('rtScheduleBody', rows, view, ageNow, retAge);
}

/** One table for both halves: paying in, then taking out, with the age against each. */
function paintRetirementTable(bodyId, rows, view, ageNow, retAge) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    let periods = rows;
    if (view === 'year') {
        const years = [];
        rows.forEach((row) => {
            const index = Math.ceil(row.month / 12) - 1;
            // Labelled by the age you are *during* that year, so the age the money
            // runs out in the table is the same age the note above it quotes.
            if (!years[index]) years[index] = { age: ageNow + index, flow: 0, growth: 0, balance: 0 };
            const year = years[index];
            year.flow    = round2(year.flow + row.flow);
            year.growth  = round2(year.growth + row.growth);
            year.balance = row.balance;
        });
        periods = years.filter(Boolean);
    }

    const frag = document.createDocumentFragment();
    let flows = 0, growth = 0;

    periods.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'band-row';
        flows  = round2(flows + row.flow);
        growth = round2(growth + row.growth);

        if (view === 'year') {
            // The first year you live off it is the one worth finding in a table this long.
            if (row.age === retAge) tr.classList.add('is-goal');
            tr.appendChild(cell('<strong>Age ' + row.age + '</strong><small>' +
                (row.age < retAge ? 'saving' : 'retired') + '</small>'));
        } else {
            const age = ageNow + Math.floor((row.month - 1) / 12);
            tr.appendChild(cell('<strong>Month ' + row.month + '</strong><small>age ' + age + '</small>'));
        }

        tr.appendChild(cell((row.flow < 0 ? '− ' : '') + fmt(Math.abs(row.flow), 0), row.flow < 0 ? 'is-minus' : ''));
        tr.appendChild(cell(fmt(row.growth, 0), 'is-growth'));
        tr.appendChild(cell(fmt(row.balance, 0), 'is-strong'));
        frag.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('In less out'));
    totalRow.appendChild(cell((flows < 0 ? '− ' : '') + fmt(Math.abs(flows), 0), flows < 0 ? 'is-minus' : ''));
    totalRow.appendChild(cell(fmt(growth, 0)));
    totalRow.appendChild(cell(fmt(periods.length ? periods[periods.length - 1].balance : 0, 0)));
    frag.appendChild(totalRow);

    body.appendChild(frag);
}

/**
 * ====================================================================
 * NET WORTH SIMULATION
 * ====================================================================
 */
function buildNetWorthUI() {
    const hosts = { asset: $('nwAssetGroups'), debt: $('nwDebtGroups') };
    if (!hosts.asset || !hosts.debt) return;
    hosts.asset.innerHTML = '';
    hosts.debt.innerHTML  = '';

    NET_WORTH_GROUPS.forEach((group) => {
        const wrap = document.createElement('div');
        wrap.className = 'nw-group' + (group.side === 'debt' ? ' is-debt' : '');

        const heading = document.createElement('h4');
        heading.innerHTML = group.title + '<span id="nwSub_' + group.id + '">RM 0.00</span>';
        wrap.appendChild(heading);

        group.items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'nw-row';

            const label = document.createElement('div');
            label.className = 'nw-label';
            label.innerHTML = '<strong>' + item.label + '</strong>' +
                (item.note ? '<small>' + item.note + '</small>' : '');

            const entry = document.createElement('div');
            entry.className = 'money-input money-input-sm';
            entry.innerHTML =
                '<span class="prefix">RM</span>' +
                '<input type="number" id="' + item.id + '" inputmode="decimal" min="0" step="100" placeholder="0" ' +
                    'aria-label="' + item.label + '">';

            const share = document.createElement('div');
            share.className = 'nw-share';
            share.id = 'nwShare_' + item.id;

            row.append(label, entry, share);
            wrap.appendChild(row);
        });

        hosts[group.side].appendChild(wrap);
    });
}

function renderNetWorth() {
    const value  = {};
    const totals = {};
    let assets = 0, debts = 0;

    NET_WORTH_GROUPS.forEach((group) => {
        let sum = 0;
        group.items.forEach((item) => {
            value[item.id] = Math.max(0, num(item.id));
            sum = round2(sum + value[item.id]);
        });
        totals[group.id] = sum;
        if (group.side === 'asset') assets = round2(assets + sum);
        else                        debts  = round2(debts + sum);
    });

    const net = round2(assets - debts);

    // Each line carries its weight against its own side, so a house is measured
    // against what you own and a mortgage against what you owe.
    NET_WORTH_GROUPS.forEach((group) => {
        const side = group.side === 'asset' ? assets : debts;
        set('nwSub_' + group.id, money(totals[group.id]));
        group.items.forEach((item) => {
            set('nwShare_' + item.id, value[item.id] > 0 && side > 0
                ? pct(value[item.id] / side * 100, 0)
                : '');
        });
    });

    set('nwAssetsHead', money(assets));
    set('nwDebtsHead', money(debts));
    set('nwTallyAssets', money(assets));
    set('nwTallyDebts', minus(debts));
    set('nwTallyNet', signed(net));
    ['nwTallyNet', 'nwBarNet'].forEach((id) => {
        const el = $(id);
        if (el) el.classList.toggle('is-minus', net < 0);
    });

    $('networth-results').classList.toggle('is-empty', assets <= 0 && debts <= 0);
    if (assets <= 0 && debts <= 0) return;

    // --- headline tiles ---
    const ratio = assets > 0 ? debts / assets * 100 : 100;
    const biggestAsset = NET_WORTH_GROUPS
        .filter((group) => group.side === 'asset')
        .flatMap((group) => group.items)
        .filter((item) => value[item.id] > 0)
        .sort((a, b) => value[b.id] - value[a.id])[0];

    set('nwNet', signed(net));
    set('nwNetFoot', net < 0
        ? 'You owe ' + money(-net) + ' more than you own'
        : assets > 0
            ? pct(net / assets * 100, 0) + ' of everything you hold is actually yours'
            : 'Nothing owned yet');

    set('nwAssets', money(assets));
    set('nwAssetsFoot', biggestAsset
        ? 'Biggest line: ' + biggestAsset.label + ' · ' + money(value[biggestAsset.id])
        : 'Nothing listed yet');

    set('nwDebts', money(debts));
    set('nwDebtsFoot', debts > 0
        ? pct(ratio, 0) + ' of what you own · ' + debtVerdict(ratio)
        : 'Debt free');

    // --- the two bars, drawn on the same scale ---
    const assetShare = (v) => (assets ? v / assets * 100 : 0).toFixed(3) + '%';
    $('segNwLiquid').style.width = assetShare(totals.liquid);
    $('segNwInvest').style.width = assetShare(totals.invest);
    $('segNwFixed').style.width  = assetShare(totals.fixed);

    // The debt bar is measured against the asset bar, not against itself — that
    // gap is the whole picture, so the two must share one scale.
    const debtScale = Math.min(100, assets > 0 ? debts / assets * 100 : (debts > 0 ? 100 : 0));
    const debtShare = (v) => (debts ? v / debts * debtScale : 0).toFixed(3) + '%';
    $('segNwLong').style.width  = debtShare(totals.long);
    $('segNwShort').style.width = debtShare(totals.short);

    const ofAssets = (v) => pct(assets ? v / assets * 100 : 0, 0);
    const ofDebts  = (v) => pct(debts ? v / debts * 100 : 0, 0);
    set('nwBarNote', debts > 0 && assets > 0
        ? 'Every RM 1 you own carries ' + money(debts / assets) + ' of debt'
        : debts > 0 ? 'All debt, nothing owned yet' : 'Nothing owed');

    set('nwBarAssets', money(assets));
    set('legNwLiquid', money(totals.liquid));
    set('legNwLiquidPct', ofAssets(totals.liquid));
    set('legNwInvest', money(totals.invest));
    set('legNwInvestPct', ofAssets(totals.invest));
    set('legNwFixed', money(totals.fixed));
    set('legNwFixedPct', ofAssets(totals.fixed));

    set('nwBarDebtLabel', assets > 0 && debts > 0
        ? 'What you owe — ' + pct(ratio, 0) + ' of the bar above'
        : 'What you owe');
    set('nwBarDebts', money(debts));
    set('legNwLong', money(totals.long));
    set('legNwLongPct', ofDebts(totals.long));
    set('legNwShort', money(totals.short));
    set('legNwShortPct', ofDebts(totals.short));

    set('nwOwnedShare', assets <= 0
        ? '—'
        : net <= 0 ? 'None of it' : Math.round(net / assets * 100) + ' sen');
    set('nwBarNet', signed(net));

    // --- how healthy that is ---
    // EPF is a real asset that you cannot spend, so it is counted in the net
    // worth and left out of everything that asks what you could reach today.
    const reachable = round2(totals.liquid + totals.invest - value.nwEpf - totals.short);
    const expenses  = Math.max(0, num('nwExpenses'));
    const income    = Math.max(0, num('nwIncome'));
    const age       = Math.max(0, Math.round(num('nwAge')));
    const bench     = age > 0 && income > 0 ? round2(age * income * 12 / 10) : 0;

    const cover = expenses > 0 ? reachable / expenses : 0;
    set('nwLiquidNet', money(reachable));
    set('nwCover', expenses <= 0
        ? 'Add your monthly spending'
        : reachable <= 0
            ? 'Nothing — short-term debt eats it all'
            : cover < 1
                ? 'Less than a month'
                : formatMonths(Math.min(GOAL_MAX_MONTHS, Math.floor(cover))));
    set('nwLocked', money(value.nwEpf));
    set('nwDebtRatio', debts > 0 ? pct(ratio, 0) + ' · ' + debtVerdict(ratio) : 'No debt');

    set('nwBenchLabel', bench > 0 ? 'Par for ' + age + ' on ' + money(income) + ' a month' : 'Par for your age and income');
    set('nwBench', bench > 0 ? money(bench) : 'Add your age and income');
    set('nwHealthNote', bench <= 0
        ? 'Fill the three boxes for a fuller read'
        : net >= bench
            ? money(net - bench) + ' above par'
            : money(bench - net) + ' below par');

    // --- the biggest pieces ---
    const pieces = NET_WORTH_GROUPS.flatMap((group) =>
        group.items
            .filter((item) => value[item.id] > 0)
            .map((item) => ({
                label: item.label,
                group: group.title,
                debt:  group.side === 'debt',
                amount: value[item.id],
                share:  group.side === 'debt' ? ofDebts(value[item.id]) : ofAssets(value[item.id]),
            })))
        .sort((a, b) => b.amount - a.amount);

    set('nwPiecesNote', pieces.length
        ? pieces.length + (pieces.length === 1 ? ' line filled in' : ' lines filled in')
        : 'Nothing filled in yet');
    paintNetWorthPieces('nwPiecesBody', pieces, net);
}

/** Every line that has a figure in it, biggest first, debts marked as negative. */
function paintNetWorthPieces(bodyId, pieces, net) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    const frag = document.createDocumentFragment();
    pieces.forEach((piece) => {
        const tr = document.createElement('tr');
        tr.className = 'band-row';
        tr.appendChild(cell('<strong>' + piece.label + '</strong><small>' + piece.group + '</small>'));
        tr.appendChild(cell((piece.debt ? '− ' : '') + fmt(piece.amount, 0), piece.debt ? 'is-minus' : 'is-strong'));
        tr.appendChild(cell(piece.share));
        frag.appendChild(tr);
    });

    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.appendChild(cell('Net worth'));
    totalRow.appendChild(cell((net < 0 ? '− ' : '') + fmt(Math.abs(net), 0), net < 0 ? 'is-minus' : ''));
    totalRow.appendChild(cell(''));
    frag.appendChild(totalRow);

    body.appendChild(frag);
}

/**
 * ====================================================================
 * EMERGENCY FUND SIMULATION
 * ====================================================================
 */
function renderFund() {
    const value = {};
    let spend = 0;
    EF_ITEMS.forEach((id) => {
        value[id] = Math.max(0, num(id));
        spend = round2(spend + value[id]);
    });
    EF_ITEMS.forEach((id) => set('efShare_' + id, value[id] > 0 && spend > 0 ? pct(value[id] / spend * 100, 0) : ''));

    const months  = Math.min(24, Math.max(1, Math.round(num('efMonths')) || 6));
    const rate    = Math.max(0, num('efReturn'));
    const saved   = Math.max(0, num('efSaved'));
    const monthly = Math.max(0, num('efMonthly'));
    const target  = round2(spend * months);

    const monthsSeg = $('efMonthsSeg');
    if (monthsSeg) setSegment(monthsSeg, String(months));
    const returnSeg = $('efReturnSeg');
    if (returnSeg) setSegment(returnSeg, String(rate));

    set('efSpendHead', money(spend));
    set('efTallySpend', money(spend));
    set('efTallyMonths', formatMonths(months));
    set('efTallyTarget', money(target));

    $('fund-results').classList.toggle('is-empty', spend <= 0);
    if (spend <= 0) return;

    const gap     = round2(Math.max(0, target - saved));
    const covered = saved / spend;
    const start   = new Date();

    // --- headline tiles ---
    set('efTargetLabel', 'Fund you need');
    set('efTarget', money(target));
    set('efTargetFoot', formatMonths(months) + ' × ' + money(spend) + ' a month');

    set('efGapLabel', gap > 0 ? 'Still to find' : 'Past the target by');
    set('efGap', money(gap > 0 ? gap : round2(saved - target)));
    set('efGapFoot', gap > 0
        ? pct(target ? saved / target * 100 : 0, 0) + ' of the way there'
        : 'The fund is done — put the next ringgit somewhere it grows');

    set('efCovered', covered >= 24 ? 'Over 2 years' : fmt(covered, 1) + ' months');
    set('efCoveredFoot', covered <= 0
        ? 'One bad month and it goes on a card'
        : covered < 1
            ? 'Less than a single month of bills'
            : 'of the ' + months + ' months you asked for');

    // --- how far along ---
    const shareOf = (v) => (target ? Math.max(0, v) / target * 100 : 0).toFixed(3) + '%';
    $('segEfSaved').style.width = shareOf(Math.min(saved, target));
    $('segEfGap').style.width   = shareOf(gap);

    const pctOf = (v) => pct(target ? v / target * 100 : 0, 0);
    set('efMixNote', money(Math.min(saved, target)) + ' of ' + money(target));
    set('legEfSaved', money(saved));
    set('legEfSavedPct', pctOf(Math.min(saved, target)));
    set('legEfGap', money(gap));
    set('legEfGapPct', pctOf(gap));

    const reach = gap <= 0 ? 0 : monthsToGoal({ target, opening: saved, annualRate: rate, monthly });
    set('efWhenLabel', monthly > 0 ? 'Saving ' + money(monthly) + ' a month, you get there' : 'At what you save now, you get there');
    set('efWhen', gap <= 0
        ? 'Already there'
        : monthly <= 0
            ? 'Never — nothing is going in'
            : reach < 0
                ? 'Not within ' + formatMonths(GOAL_MAX_MONTHS)
                : formatMonths(reach) + ' · ' + monthLabel(addMonths(start, reach)));

    set('efNeedLabel', gap > 0 ? 'To finish it inside a year, save' : 'Nothing more needed');
    set('efNeed', gap > 0
        ? money(goalDeposit({ target, opening: saved, annualRate: rate, months: 12 })) + ' a month'
        : '—');

    // --- how much cover this household should hold ---
    const advice = suggestedCover({
        earners:    ($('efEarnersSeg') || { dataset: {} }).dataset.value || 'one',
        job:        ($('efJobSeg') || { dataset: {} }).dataset.value || 'permanent',
        dependants: parseInt(($('efDepsSeg') || { dataset: {} }).dataset.value, 10) || 0,
    });

    set('efAdviceNote', advice.months > 3 ? 'Above the three-month floor' : 'The three-month floor');
    set('efAdviceWhyLabel', 'For your situation, hold');
    set('efAdviceMonths', formatMonths(advice.months));
    set('efAdviceAmount', money(round2(spend * advice.months)));
    set('efAdviceGapLabel', 'Against the ' + formatMonths(months) + ' you set');
    set('efAdviceGap', advice.months > months
        ? formatMonths(advice.months - months) + ' short'
        : advice.months < months
            ? formatMonths(months - advice.months) + ' more than asked for'
            : 'Exactly right');
    set('efAdviceWhy', advice.reasons.length
        ? 'Three months is the floor. You are above it because ' + listPhrase(advice.reasons) +
          ' — the same setback simply lasts longer in a household like yours.'
        : 'Three months is the floor: a permanent job, two incomes and nobody depending on you is the easiest case there is. Anything less certain, and the fund has to last longer.');

    // --- schedule ---
    const runMonths = gap <= 0 || monthly <= 0 || reach < 0
        ? 12
        : Math.min(GOAL_MAX_MONTHS, Math.max(1, reach));
    const plan = savingsSchedule({ opening: saved, monthly, annualRate: rate, months: runMonths, target, settleLast: true });

    const view = (($('efView') || {}).dataset || {}).value || 'month';
    set('efColPeriod', view === 'year' ? 'Year' : 'Month');
    set('efScheduleNote', plan.reached
        ? 'Full by month ' + plan.reached + ' · ' + monthLabel(addMonths(start, plan.reached))
        : monthly > 0 ? 'Rounded to the ringgit' : 'Nothing going in — this is just what sits there');

    paintGoalSchedule('efScheduleBody', plan, view, start);
}

/** "a, b and c" — a list said out loud rather than punctuated. */
function listPhrase(parts) {
    if (parts.length <= 1) return parts[0] || '';
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/**
 * ====================================================================
 * RENT VS BUY SIMULATION
 * ====================================================================
 */
// The deposit pair works the same way as the home loan's: whichever box was
// last touched leads, and the other follows from the price.
let rbDownBy = 'pct';

function renderRentBuy() {
    const price   = Math.max(0, num('rbPrice'));
    const rent    = Math.max(0, num('rbRent'));
    const rise    = Math.max(0, num('rbRentRise'));
    const rate    = Math.max(0, num('rbRate'));
    const tenure  = Math.min(40, Math.max(1, Math.round(num('rbTenure')) || 35));
    const years   = Math.min(40, Math.max(1, Math.round(num('rbYears')) || 10));
    const growth  = Math.max(0, num('rbGrowth'));
    const upkeep  = Math.max(0, num('rbUpkeep'));
    const sellPct = Math.max(0, num('rbSellPct'));
    const invest  = Math.max(0, num('rbInvest'));

    const deposit = downPayment(price, 'rbDown', 'rbDownPct', rbDownBy);
    const loan    = round2(price - deposit.down);
    const costs   = buyingCosts(price, loan);
    const months  = years * 12;

    const downSeg = $('rbDownSeg');
    if (downSeg) setSegment(downSeg, String(deposit.share));
    const rateSeg = $('rbRateSeg');
    if (rateSeg) setSegment(rateSeg, String(rate));
    const yearsSeg = $('rbYearsSeg');
    if (yearsSeg) setSegment(yearsSeg, String(years));

    const instalment = loanInstalment(loan, rate, tenure * 12);
    set('rbTallyLoan', money(loan));
    set('rbTallyInstalment', money(instalment));
    set('rbTallyCash', money(round2(deposit.down + costs.total)));

    $('rentbuy-results').classList.toggle('is-empty', price <= 0);
    if (price <= 0) return;

    const plan = rentVsBuy({
        price, down: deposit.down, upfront: costs.total,
        annualRate: rate, tenureMonths: tenure * 12, months,
        growth, upkeepPct: upkeep, sellPct,
        rent, rentRise: rise, investRate: invest,
    });

    const diff  = round2(plan.buy - plan.pot);
    const buying = diff >= 0;

    // --- headline tiles ---
    set('rbVerdictLabel', buying ? 'Buying comes out ahead by' : 'Renting comes out ahead by');
    set('rbVerdict', money(Math.abs(diff)));
    set('rbVerdictFoot', 'After ' + formatMonths(months) + ', with the place sold and the agent paid');

    set('rbBuyNet', signed(plan.buy));
    set('rbBuyNetFoot', money(plan.value) + ' less ' + money(plan.balance) + ' still owing');

    set('rbRentNet', signed(plan.pot));
    set('rbRentNetFoot', plan.pot >= 0
        ? money(round2(deposit.down + costs.total)) + ' never spent, then invested at ' + pct(invest, 2)
        : 'The rent outran the buyer’s outlay — there was nothing spare to invest');

    // --- the two ends, on one scale ---
    const scale = Math.max(plan.buy, plan.pot, 1);
    $('segRbBuy').style.width  = (Math.max(0, plan.buy) / scale * 100).toFixed(3) + '%';
    $('segRbRent').style.width = (Math.max(0, plan.pot) / scale * 100).toFixed(3) + '%';
    set('rbBarBuy', signed(plan.buy));
    set('rbBarRent', signed(plan.pot));
    set('rbBarTitle', 'Where you stand after ' + formatMonths(months));
    set('rbBarNote', buying ? 'Buying wins this one' : 'Renting wins this one');

    const firstOutlay = round2(instalment + price * upkeep / 100 / 12);
    set('rbBreakEven', plan.breakEven
        ? 'in year ' + Math.ceil(plan.breakEven / 12) + ' · month ' + plan.breakEven
        : 'not inside ' + formatMonths(months));
    set('rbMonthlyLabel', 'Buying costs a month at the start');
    set('rbMonthly', money(firstOutlay) + (rent > 0 ? ' · ' + money(round2(firstOutlay - rent)) + ' more than the rent' : ''));
    set('rbDiffLabel', buying ? 'Buying is ahead by' : 'Renting is ahead by');
    set('rbDiff', money(Math.abs(diff)));
    const diffEl = $('rbDiff');
    if (diffEl) diffEl.classList.toggle('is-minus', !buying);

    // --- what buying costs ---
    set('rbBuyNote', formatMonths(months) + ' of owning it');
    set('rbCostDown', money(deposit.down));
    set('rbCostStampLabel', 'Stamp duty on the transfer');
    set('rbCostStamp', money(costs.transferStamp));
    set('rbCostLoanStamp', money(costs.loanStamp));
    set('rbCostLegal', money(costs.legal));
    set('rbCostInstalmentLabel', months + ' instalments of ' + money(instalment));
    set('rbCostInstalment', money(plan.instalmentsPaid));
    set('rbCostInterest', minus(plan.interestPaid));
    set('rbCostUpkeep', money(plan.upkeepPaid));
    set('rbCostTotal', money(round2(deposit.down + costs.total + plan.instalmentsPaid + plan.upkeepPaid)));

    set('rbEndValueLabel', 'The place is worth, at ' + pct(growth, 2) + ' a year');
    set('rbEndValue', money(plan.value));
    set('rbEndLoan', minus(plan.balance));
    set('rbEndSell', minus(plan.sellCost));
    set('rbEndEquity', signed(plan.buy));

    // --- what renting costs ---
    set('rbRentNote', rent > 0 ? 'starting at ' + money(rent) + ' a month' : 'no rent at all');
    set('rbRentPaidLabel', formatMonths(months) + ' of rent');
    set('rbRentPaid', money(plan.rentPaid));
    set('rbRentLastLabel', 'Rent by the last month, at ' + pct(rise, 2) + ' a year');
    set('rbRentLast', money(plan.rentLast));
    set('rbRentInvested', signed(round2(deposit.down + costs.total + plan.invested)));
    set('rbRentGrowth', money(plan.potGrowth));
    set('rbRentPot', signed(plan.pot));
    set('rbRentWhy', plan.invested < 0
        ? 'The rent here runs above what the buyer pays each month, so the renter is dipping into the pot rather than adding to it — and still ' +
          (buying ? 'loses' : 'wins') + ' by the end.'
        : 'Renting only wins if the difference is genuinely invested. Spent instead, the renter ends up with nothing and the buyer ends up with a house.');

    // --- year by year ---
    set('rbScheduleNote', plan.breakEven
        ? 'Buying pulls ahead in year ' + Math.ceil(plan.breakEven / 12)
        : 'Renting stays ahead the whole way');
    paintRentBuyTable('rbScheduleBody', plan, years);
}

/** One row a year: what each path would be worth if you walked away that year. */
function paintRentBuyTable(bodyId, plan, years) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = '';

    const cell = (html, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.innerHTML = html;
        return td;
    };

    const breakYear = plan.breakEven ? Math.ceil(plan.breakEven / 12) : 0;
    const frag = document.createDocumentFragment();

    for (let year = 1; year <= years; year++) {
        const row = plan.rows[Math.min(plan.rows.length, year * 12) - 1];
        if (!row) break;

        const gap = round2(row.buy - row.rent);
        const tr  = document.createElement('tr');
        tr.className = 'band-row';
        if (year === breakYear) tr.classList.add('is-goal');

        tr.appendChild(cell('<strong>Year ' + year + '</strong><small>' +
            (year === breakYear ? 'buying pulls ahead' : gap >= 0 ? 'buying ahead' : 'renting ahead') + '</small>'));
        tr.appendChild(cell(fmt(row.buy, 0), 'is-strong'));
        tr.appendChild(cell(fmt(row.rent, 0), 'is-strong'));
        tr.appendChild(cell((gap < 0 ? '− ' : '+ ') + fmt(Math.abs(gap), 0), gap < 0 ? 'is-minus' : 'is-growth'));
        frag.appendChild(tr);
    }

    body.appendChild(frag);
}

function renderAll() {
    renderPcb();
    renderEpf();
    renderIncomeTax();
    renderLoan();
    renderCar();
    renderPersonal();
    renderDsr();
    renderGoal();
    renderCompound();
    renderRetirement();
    renderNetWorth();
    renderFund();
    renderRentBuy();
}

/**
 * ====================================================================
 * WIRING
 * ====================================================================
 */
// Ordered to match the sidebar: Tax, Loans, Savings, Financial Planning.
const MODULES = {
    'pcb-module':       { title: 'PCB Calculator', sub: 'Type your salary — deductions and take-home pay update as you go.' },
    'tax-module':       { title: 'Income Tax Calculator', sub: 'See exactly which brackets your income falls into and what you owe.' },
    'home-loan-module': { title: 'Home Loan Calculator', sub: 'What the bank asks for every month, and how much of it never touches the loan.' },
    'car-loan-module':  { title: 'Car Loan Calculator', sub: 'Hire purchase is quoted flat — here is what that instalment really costs you.' },
    'personal-loan-module': { title: 'Personal Loan Calculator', sub: 'An unsecured loan quoted flat — what the instalment is, and what the rate really means.' },
    'dsr-module':       { title: 'DSR Calculator', sub: 'What a bank works out before it decides how much more you can borrow.' },
    'goal-module':      { title: 'Savings Goal Calculator', sub: 'What it takes every month to have the money by the time you need it.' },
    'epf-module':       { title: 'EPF Calculator', sub: 'What goes in each month, and what it grows into by the time you can touch it.' },
    'compound-module':  { title: 'Compound Interest Calculator', sub: 'What you put in, what the money earns on its own, and how far apart those two end up.' },
    'retire-module':    { title: 'Retirement Calculator', sub: 'What the life you want after work actually costs, and whether you are on course for it.' },
    'networth-module':  { title: 'Net Worth Calculator', sub: 'Everything you own, minus everything you owe — the one number that says where you actually stand.' },
    'fund-module':      { title: 'Emergency Fund Calculator', sub: 'How much you need standing by before a bad month can turn into a bad year.' },
    'rentbuy-module':   { title: 'Rent vs Buy Calculator', sub: 'Both paths costed the same way, down to the stamp duty and the agent’s fee.' },
};

function switchModule(moduleId) {
    document.querySelectorAll('.nav-item').forEach((item) => {
        item.classList.toggle('is-active', item.dataset.module === moduleId);
    });
    document.querySelectorAll('.module').forEach((section) => {
        section.classList.toggle('is-active', section.id === moduleId);
    });

    const meta = MODULES[moduleId];
    if (meta) {
        set('page-title', meta.title);
        set('page-sub', meta.sub);
    }
}

const FORM_DEFAULTS = {
    pcb:   { salary: '', bonus: '', socsoCategory: '3', epfRate: '11', epfEmployerRate: '13' },
    epf:   {
        epfSalary: '', epfVoluntary: '', epfRateSelf: '11', epfRateEmployer: '13',
        epfBalance: '', epfAge: '', epfUntil: '55', epfGrowth: '3',
        epfDividend: '5.5', epfDividendSeg: '5.5',
    },
    tax:   { annualIncome: '' },
    loan:  {
        loanPrice: '', loanDown: '', loanDownPct: '10', loanDownSeg: '10',
        loanRate: '4', loanRateSeg: '4', loanTenure: '35',
        loanExtra: '', loanLump: '', loanLumpYear: '1', loanView: 'year',
    },
    car:   {
        carPrice: '', carDown: '', carDownPct: '10', carDownSeg: '10',
        carRate: '3', carRateSeg: '3', carTenure: '7',
        carSettleYear: '3', carSettleMonth: '36', carView: 'year',
    },
    personal: {
        plAmount: '', plFees: '', plYears: '5', plMonths: '60', plTenureSeg: '60',
        plRate: '8', plRateSeg: '8', plBasisSeg: 'flat',
        plSettleMonth: '24', plView: 'month',
    },
    dsr:   {
        dsrBasisSeg: 'gross', dsrIncome: '', dsrAllowance: '', dsrVariable: '', dsrVariableSeg: '80',
        dsrEmploySeg: 'private', dsrCap: '60',
        dsrHome: '', dsrCar: '', dsrPersonal: '', dsrPtptn: '', dsrCardBalance: '', dsrOther: '',
        dsrHomeRate: '4', dsrHomeYears: '35', dsrCarRate: '3', dsrCarYears: '7',
        dsrPersonalRate: '8', dsrPersonalYears: '5',
    },
    goal:  {
        goalTarget: '', goalSaved: '', goalDate: '',
        goalMonths: '18', goalMonthsSeg: '18',
        goalReturn: '0', goalReturnSeg: '0',
        goalAffordAmount: '', goalView: 'month',
    },
    compound: {
        ciInitial: '', ciMonthly: '',
        ciReturn: '5.5', ciReturnSeg: '5.5',
        ciYears: '10', ciYearsSeg: '10',
        ciCompoundSeg: '1', ciInflation: '2.5', ciView: 'year',
    },
    retire: {
        rtIncome: '', rtOther: '',
        rtAge: '30', rtRetireAge: '60', rtRetireSeg: '60',
        rtLiveTo: '85', rtLiveSeg: '85',
        rtSavings: '', rtMonthly: '',
        rtReturn: '5.5', rtReturnSeg: '5.5', rtPostReturn: '4',
        rtInflation: '2.5', rtInflationSeg: '2.5', rtView: 'year',
    },
    // Every line on the net worth form starts blank, so the defaults are the
    // form itself — no point restating twenty ids that are all the same.
    networth: Object.assign(
        { nwExpenses: '', nwIncome: '', nwAge: '' },
        ...NET_WORTH_ITEMS.map((item) => ({ [item.id]: '' })),
    ),
    fund: Object.assign(
        {
            efMonths: '6', efMonthsSeg: '6',
            efEarnersSeg: 'one', efJobSeg: 'permanent', efDepsSeg: '0',
            efSaved: '', efMonthly: '',
            efReturn: '2.5', efReturnSeg: '2.5', efView: 'month',
        },
        ...EF_ITEMS.map((id) => ({ [id]: '' })),
    ),
    rentbuy: {
        rbRent: '', rbRentRise: '3',
        rbPrice: '', rbDown: '', rbDownPct: '10', rbDownSeg: '10',
        rbRate: '4', rbRateSeg: '4', rbTenure: '35',
        rbYears: '10', rbYearsSeg: '10',
        rbGrowth: '3', rbUpkeep: '1', rbSellPct: '3', rbInvest: '5',
    },
};

function resetForm(which) {
    Object.entries(FORM_DEFAULTS[which] || {}).forEach(([id, value]) => {
        const el = $(id);
        if (!el) return;
        if (el.classList.contains('seg')) {
            setSegment(el, value);
        } else {
            el.value = value;
        }
    });

    if (which === 'tax') {
        RELIEF_ITEMS.forEach((item) => {
            const el = $(reliefInputId(item));
            if (!el) return;
            if (item.type === 'flag') el.checked = false;
            else el.value = item.type === 'count' ? '0' : '';
        });
    }

    if (which === 'loan') loanDownBy = 'pct';
    if (which === 'car') {
        carDownBy   = 'pct';
        carSettleBy = 'year';
    }

    if (which === 'personal') plTenureBy = 'years';
    if (which === 'goal') goalTimeBy = 'months';
    if (which === 'rentbuy') rbDownBy = 'pct';

    if (which === 'epf') {
        epfRates = [];
        epfRatesFrom = null;
        epfBuiltRows = -1;
    }

    renderAll();
}

function setReliefDetail(row, open) {
    const detail = row.querySelector('.relief-detail');
    const toggle = row.querySelector('.relief-more');
    if (!detail || !toggle) return;
    detail.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = (open ? 'Hide details' : 'What counts?') +
        ' <i class="bi bi-chevron-' + (open ? 'up' : 'down') + '"></i>';
}

/** Keep the header control in step with however many panels are actually open. */
function syncExpandAll() {
    const btn = $('reliefExpand');
    if (!btn) return;
    const panels = document.querySelectorAll('.relief-detail');
    const openCount = [...panels].filter((p) => !p.hidden).length;
    const allOpen = openCount === panels.length && panels.length > 0;
    btn.dataset.open = String(allOpen);
    btn.innerHTML = allOpen
        ? '<i class="bi bi-chevron-bar-up"></i> Collapse all'
        : '<i class="bi bi-chevron-bar-down"></i> Explain every relief';
}

function setSegment(seg, value) {
    seg.dataset.value = value;
    seg.querySelectorAll('button').forEach((btn) => {
        btn.classList.toggle('is-on', btn.dataset.val === value);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => switchModule(item.dataset.module));
    });

    // Collapse the sidebar to a rail. With the labels gone the icons carry no
    // name of their own, so each one borrows its heading as a tooltip — and
    // gives it back on the way out, where the label is right there to read.
    const navToggle = $('navToggle');
    if (navToggle) {
        navToggle.addEventListener('click', () => {
            const rail = document.querySelector('.app').classList.toggle('is-rail');
            navToggle.setAttribute('aria-expanded', String(!rail));
            navToggle.title = rail ? 'Expand the sidebar' : 'Collapse the sidebar';

            document.querySelectorAll('.nav-item').forEach((item) => {
                const name = item.querySelector('strong');
                if (rail && name) item.title = name.textContent;
                else item.removeAttribute('title');
            });
        });
    }

    document.querySelectorAll('.seg').forEach((seg) => {
        seg.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-val]');
            if (!btn) return;
            setSegment(seg, btn.dataset.val);
            if (seg.id === 'epfDividendSeg' && $('epfDividend')) $('epfDividend').value = btn.dataset.val;
            if (seg.id === 'loanDownSeg' && $('loanDownPct')) {
                $('loanDownPct').value = btn.dataset.val;
                loanDownBy = 'pct';                       // the preset is a percentage, so let it lead
            }
            if (seg.id === 'loanRateSeg' && $('loanRate'))    $('loanRate').value    = btn.dataset.val;
            if (seg.id === 'carDownSeg' && $('carDownPct')) {
                $('carDownPct').value = btn.dataset.val;
                carDownBy = 'pct';
            }
            if (seg.id === 'carRateSeg' && $('carRate'))      $('carRate').value     = btn.dataset.val;
            // Who signs the payslip is what moves the limit, so the employment
            // control writes the typical ceiling into the field beside it.
            if (seg.id === 'dsrEmploySeg' && $('dsrCap')) $('dsrCap').value = String(DSR_CAPS[btn.dataset.val] || 60);
            if (seg.id === 'plTenureSeg' && $('plMonths')) {
                $('plMonths').value = btn.dataset.val;
                plTenureBy = 'months';                    // the preset is a term in months, so let that box lead
            }
            if (seg.id === 'plRateSeg' && $('plRate'))         $('plRate').value      = btn.dataset.val;
            if (seg.id === 'goalMonthsSeg' && $('goalMonths')) {
                $('goalMonths').value = btn.dataset.val;
                goalTimeBy = 'months';                    // the preset is a term, so let the months box lead
            }
            if (seg.id === 'goalReturnSeg' && $('goalReturn')) $('goalReturn').value = btn.dataset.val;
            if (seg.id === 'ciReturnSeg' && $('ciReturn'))     $('ciReturn').value    = btn.dataset.val;
            if (seg.id === 'ciYearsSeg' && $('ciYears'))       $('ciYears').value     = btn.dataset.val;
            if (seg.id === 'rtRetireSeg' && $('rtRetireAge'))  $('rtRetireAge').value = btn.dataset.val;
            if (seg.id === 'rtLiveSeg' && $('rtLiveTo'))       $('rtLiveTo').value    = btn.dataset.val;
            if (seg.id === 'rtReturnSeg' && $('rtReturn'))     $('rtReturn').value    = btn.dataset.val;
            if (seg.id === 'rtInflationSeg' && $('rtInflation')) $('rtInflation').value = btn.dataset.val;
            if (seg.id === 'efMonthsSeg' && $('efMonths'))     $('efMonths').value    = btn.dataset.val;
            if (seg.id === 'efReturnSeg' && $('efReturn'))     $('efReturn').value    = btn.dataset.val;
            if (seg.id === 'rbDownSeg' && $('rbDownPct')) {
                $('rbDownPct').value = btn.dataset.val;
                rbDownBy = 'pct';                         // the preset is a percentage, so let it lead
            }
            if (seg.id === 'rbRateSeg' && $('rbRate'))         $('rbRate').value      = btn.dataset.val;
            if (seg.id === 'rbYearsSeg' && $('rbYears'))       $('rbYears').value     = btn.dataset.val;
            renderAll();
        });
    });

    buildReliefUI();
    syncExpandAll();
    buildNetWorthUI();

    // Registered before the general wiring below so the flag is already set by the
    // time the same keystroke reaches renderAll.
    // A date is usually set from the browser's own picker rather than typed, so
    // the flag has to answer to a change as well as to a keystroke.
    const leadWith = (id, mode, take) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', () => take(mode));
        el.addEventListener('change', () => take(mode));
    };
    leadWith('loanDown', 'rm', (m) => { loanDownBy = m; });
    leadWith('loanDownPct', 'pct', (m) => { loanDownBy = m; });
    leadWith('carDown', 'rm', (m) => { carDownBy = m; });
    leadWith('carDownPct', 'pct', (m) => { carDownBy = m; });
    leadWith('carSettleYear', 'year', (m) => { carSettleBy = m; });
    leadWith('carSettleMonth', 'month', (m) => { carSettleBy = m; });
    leadWith('plYears', 'years', (m) => { plTenureBy = m; });
    leadWith('plMonths', 'months', (m) => { plTenureBy = m; });
    leadWith('goalMonths', 'months', (m) => { goalTimeBy = m; });
    leadWith('goalDate', 'date', (m) => { goalTimeBy = m; });
    leadWith('rbDown', 'rm', (m) => { rbDownBy = m; });
    leadWith('rbDownPct', 'pct', (m) => { rbDownBy = m; });

    document.querySelectorAll('.panel input, .panel select, #reliefGroups input, .assume-grid input').forEach((el) => {
        el.addEventListener('input', renderAll);
        el.addEventListener('change', renderAll);
    });

    // "What counts?" panels — one row at a time, or all at once from the header
    const reliefHost = $('reliefGroups');
    if (reliefHost) {
        reliefHost.addEventListener('click', (event) => {
            const toggle = event.target.closest('.relief-more');
            if (!toggle) return;
            const row = toggle.closest('.relief-row');
            const detail = row.querySelector('.relief-detail');
            setReliefDetail(row, detail.hidden);
            syncExpandAll();
        });
    }

    const expandAll = $('reliefExpand');
    if (expandAll) {
        expandAll.addEventListener('click', () => {
            const open = expandAll.dataset.open !== 'true';
            document.querySelectorAll('.relief-row').forEach((row) => setReliefDetail(row, open));
            syncExpandAll();
        });
    }

    // +/- steppers on the per-child reliefs
    document.querySelectorAll('.relief-count').forEach((box) => {
        box.addEventListener('click', (event) => {
            const btn = event.target.closest('button[data-step]');
            if (!btn) return;
            const field = box.querySelector('input');
            const next = Math.max(0, Math.min(20, (parseInt(field.value, 10) || 0) + Number(btn.dataset.step)));
            field.value = String(next);
            renderAll();
        });
    });

    // The per-year dividend fields are built with the projection table.
    const projectionBody = $('epfProjBody');
    if (projectionBody) projectionBody.addEventListener('input', renderEpf);

    document.querySelectorAll('[data-reset]').forEach((btn) => {
        btn.addEventListener('click', () => resetForm(btn.dataset.reset));
    });

    renderAll();
});
