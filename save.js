/**
 * ====================================================================
 * FinSim — keeping your figures
 * --------------------------------------------------------------------
 * Three things live here, smallest first:
 *
 *   1. **Autosave.** Whatever is in the forms is written to localStorage a
 *      quarter-second after you stop typing, and put back when you return.
 *      Nothing to press. A calculator you have to re-fill every visit is a
 *      calculator you stop opening.
 *
 *   2. **Scenarios.** A named copy of one calculator's inputs — "35 years at
 *      4%" beside "30 years at 4.2%" — kept as chips under the panel head, so
 *      the comparison the app exists for survives closing the tab.
 *
 *   3. **Export / Import.** One JSON file holding both of the above, because
 *      localStorage is one browser, one origin, and clearing browsing data
 *      takes the lot. `drive.js` sends the very same envelope to Google Drive.
 *
 * The working store is always localStorage. The file, and Drive, are copies.
 * FinSim still opens and still calculates if this file never loads at all —
 * which is the ordering to keep if anything here is ever rewritten.
 *
 * A note on how the snapshots are taken: by **element id**, walking each
 * `<section class="module">`. That deliberately picks up the fields built at
 * run time too — the twenty relief lines, the nineteen net worth rows, the
 * assumption boxes beside the results — without this file having to keep its
 * own list of them and fall behind the day a field is added.
 * ====================================================================
 */

/* Stores. Both go in the backup; a new one that does not is silently not
   backed up, which is the sort of bug nobody notices until it matters. */
const INPUTS_KEY    = 'finsim.inputs.v1';
const SCENARIOS_KEY = 'finsim.scenarios.v1';
const BACKUP_STORES = [INPUTS_KEY, SCENARIOS_KEY];

/** Private mode, `file://` and a full disk can all throw. None of them is worth losing a keystroke over. */
function storedRaw(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
}

function storeRaw(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (err) { return false; }
}

function storedJson(key, fallback) {
    const raw = storedRaw(key);
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch (err) { return fallback; }
}

/**
 * ====================================================================
 * SNAPSHOTS — reading a calculator off the page, and writing it back
 * ====================================================================
 */

/** Which `FORM_DEFAULTS` key a module resets to, taken from its own Reset button. */
function formKeyOf(moduleId) {
    const btn = document.querySelector('#' + moduleId + ' [data-reset]');
    return btn ? btn.dataset.reset : null;
}

/** Every module on the page, in sidebar order. */
function moduleIds() {
    return [...document.querySelectorAll('.module')].map((section) => section.id);
}

function activeModuleId() {
    const on = document.querySelector('.module.is-active');
    return on ? on.id : 'pcb-module';
}

/**
 * State a module keeps outside its inputs.
 *
 * The "which box leads" flags are the interesting ones: type a deposit in
 * ringgit and the percentage follows, type a percentage and the ringgit
 * follows. Restore the fields without the flag and the first repaint
 * overwrites one of them from the other — the loaded scenario would quietly
 * change itself.
 */
function captureExtras(moduleId) {
    switch (moduleId) {
        case 'home-loan-module':     return { downBy: loanDownBy };
        case 'car-loan-module':      return { downBy: carDownBy, settleBy: carSettleBy };
        case 'personal-loan-module': return { tenureBy: plTenureBy };
        case 'goal-module':          return { timeBy: goalTimeBy };
        case 'rentbuy-module':       return { downBy: rbDownBy };
        case 'epf-module': {
            // The per-year dividend rows are built by the projection, so they are
            // read off the table rather than from ids that do not exist yet.
            const rates = [];
            document.querySelectorAll('#epfProjBody .epf-year-rate').forEach((input) => {
                rates[Number(input.dataset.year)] = input.value;
            });
            return { rates };
        }
        default: return null;
    }
}

function applyExtras(moduleId, extras) {
    if (!extras) return;
    switch (moduleId) {
        case 'home-loan-module':     if (extras.downBy)   loanDownBy  = extras.downBy;   break;
        case 'car-loan-module':
            if (extras.downBy)   carDownBy   = extras.downBy;
            if (extras.settleBy) carSettleBy = extras.settleBy;
            break;
        case 'personal-loan-module': if (extras.tenureBy) plTenureBy  = extras.tenureBy; break;
        case 'goal-module':          if (extras.timeBy)   goalTimeBy  = extras.timeBy;   break;
        case 'rentbuy-module':       if (extras.downBy)   rbDownBy    = extras.downBy;   break;
        case 'epf-module':
            epfRates = (extras.rates || []).slice();
            // `syncYearRates` wipes every year the moment the flat rate differs from
            // the one they were filled from — so it has to be told the restored
            // dividend *is* where these came from, or the rates vanish on repaint.
            epfRatesFrom = num('epfDividend');
            epfBuiltRows = -1;                    // force the rows to be rebuilt with the restored values
            break;
    }
}

/** One calculator, as it stands: fields, tick boxes, segmented controls, and whatever else it keeps. */
function captureModule(moduleId) {
    const host = document.getElementById(moduleId);
    if (!host) return null;

    const snap = { f: {}, c: {}, s: {} };

    host.querySelectorAll('input[id], select[id]').forEach((el) => {
        if (el.type === 'checkbox' || el.type === 'radio') snap.c[el.id] = el.checked;
        else snap.f[el.id] = el.value;
    });

    host.querySelectorAll('.seg[id]').forEach((seg) => {
        if (seg.dataset.value !== undefined) snap.s[seg.id] = seg.dataset.value;
    });

    const extras = captureExtras(moduleId);
    if (extras) snap.x = extras;

    return snap;
}

/**
 * Puts a snapshot back.
 *
 * It resets the module to its defaults first, deliberately. A snapshot is a
 * complete picture of that calculator, so anything the snapshot does not
 * mention must go back to blank — otherwise loading "Plan B" over "Plan A"
 * leaves Plan A's extra payment sitting in the form, and the answer on screen
 * belongs to neither.
 */
function applyModule(moduleId, snap, render = true) {
    if (!snap) return;

    const key = formKeyOf(moduleId);
    if (key) resetForm(key, false);

    Object.entries(snap.f || {}).forEach(([id, value]) => {
        const el = $(id);
        if (el && !el.classList.contains('seg')) el.value = value;
    });

    Object.entries(snap.c || {}).forEach(([id, on]) => {
        const el = $(id);
        if (el) el.checked = !!on;
    });

    Object.entries(snap.s || {}).forEach(([id, value]) => {
        const seg = $(id);
        if (seg && seg.classList.contains('seg') && value !== undefined) setSegment(seg, value);
    });

    applyExtras(moduleId, snap.x);

    if (render) renderAll();
}

/** The whole page, plus where you were standing when you left it. */
function captureAll() {
    const modules = {};
    moduleIds().forEach((id) => { modules[id] = captureModule(id); });
    return { v: 1, savedAt: new Date().toISOString(), active: activeModuleId(), modules };
}

/**
 * ====================================================================
 * AUTOSAVE
 * ====================================================================
 * `renderAll()` runs at the end of every interaction that changes a figure, so
 * it is the one place worth hanging the save on. Debounced, because a save on
 * every keystroke serialises the entire page thirty times while someone types
 * a salary.
 */
let saveTimer = null;
let restoring = false;

const saveSoon = () => {
    if (restoring) return;                        // the restore's own repaint is not a change
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        storeRaw(INPUTS_KEY, JSON.stringify(captureAll()));
        markActiveChips();
    }, 250);
};

/** Called by app.js once the run-time fields exist and before the first paint. */
function finsimRestore() {
    const saved = storedJson(INPUTS_KEY, null);

    restoring = true;
    try {
        if (saved && saved.modules) {
            Object.entries(saved.modules).forEach(([id, snap]) => applyModule(id, snap, false));
            if (saved.active && MODULES[saved.active]) switchModule(saved.active);
        }
        buildScenarioBars();
    } finally {
        restoring = false;
    }
}

/**
 * ====================================================================
 * SCENARIOS
 * ====================================================================
 * A scenario belongs to one calculator. Saving from the Home Loan panel files
 * the home loan and nothing else — you are comparing two mortgages, not two
 * versions of your whole financial life.
 */
function loadScenarios() {
    const stored = storedJson(SCENARIOS_KEY, null);
    const items = (stored && Array.isArray(stored.items)) ? stored.items : [];

    // The stored copy is untrusted: a scenario pointing at a calculator that no
    // longer exists would draw a chip that can never be loaded.
    return items.filter((item) => item && item.id && item.name && document.getElementById(item.module));
}

function saveScenarios(items) {
    storeRaw(SCENARIOS_KEY, JSON.stringify({ v: 1, items }));
}

function scenariosFor(moduleId) {
    return loadScenarios().filter((item) => item.module === moduleId);
}

let scenarioSeq = 0;
const newScenarioId = () => 's' + Date.now().toString(36) + (scenarioSeq++).toString(36);

/** "Plan A", then "Plan B" — a name to accept rather than a box to think about. */
function suggestedName(moduleId) {
    const taken = new Set(scenariosFor(moduleId).map((item) => item.name.toLowerCase()));
    for (let i = 0; i < 26; i++) {
        const name = 'Plan ' + String.fromCharCode(65 + i);
        if (!taken.has(name.toLowerCase())) return name;
    }
    return 'Plan ' + (scenariosFor(moduleId).length + 1);
}

function saveScenario(moduleId, name) {
    const items = loadScenarios();
    const existing = items.find((item) =>
        item.module === moduleId && item.name.toLowerCase() === name.toLowerCase());

    const record = {
        id:      existing ? existing.id : newScenarioId(),
        module:  moduleId,
        name:    name,
        savedAt: new Date().toISOString(),
        snap:    captureModule(moduleId),
    };

    if (existing) items[items.indexOf(existing)] = record;
    else items.push(record);

    saveScenarios(items);
    renderScenarioBar(moduleId);
}

function deleteScenario(id) {
    const items = loadScenarios();
    const gone = items.find((item) => item.id === id);
    saveScenarios(items.filter((item) => item.id !== id));
    if (gone) renderScenarioBar(gone.module);
}

function loadScenario(id) {
    const item = loadScenarios().find((entry) => entry.id === id);
    if (!item) return;
    applyModule(item.module, item.snap);
    renderScenarioBar(item.module);
}

/* ------------------------------------------------------------------ *
 * The chips
 * ------------------------------------------------------------------ */

/**
 * The bar is built here rather than in index.html: thirteen copies of the same
 * markup is thirteen places to forget to change, and every panel already
 * carries the one thing needed to place it — its Reset button.
 */
function buildScenarioBars() {
    document.querySelectorAll('.module').forEach((section) => {
        const head = section.querySelector('.panel .panel-head');
        if (!head || section.querySelector('.scen-bar')) return;

        const bar = document.createElement('div');
        bar.className = 'scen-bar';
        bar.innerHTML =
            '<div class="scen-chips"></div>' +
            '<button type="button" class="scen-add" title="Keep these figures under a name">' +
            '<i class="bi bi-bookmark-plus"></i> Save</button>';

        head.insertAdjacentElement('afterend', bar);

        bar.querySelector('.scen-add').addEventListener('click', () => askScenarioName(section.id));

        bar.querySelector('.scen-chips').addEventListener('click', (event) => {
            const del = event.target.closest('.scen-del');
            if (del) {
                const chip = del.closest('.scen-chip');
                const item = loadScenarios().find((entry) => entry.id === chip.dataset.id);
                return askConfirm(
                    'Delete “' + (item ? item.name : 'this scenario') + '”?',
                    'The figures in it go with it. Nothing else on this calculator changes.',
                    'Delete',
                    () => deleteScenario(chip.dataset.id));
            }
            const load = event.target.closest('.scen-load');
            if (load) loadScenario(load.closest('.scen-chip').dataset.id);
        });

        renderScenarioBar(section.id);
    });
}

function renderScenarioBar(moduleId) {
    const host = document.querySelector('#' + moduleId + ' .scen-chips');
    if (!host) return;

    const items = scenariosFor(moduleId);

    if (!items.length) {
        host.innerHTML = '<span class="scen-empty">Nothing saved yet &mdash; '
            + '<b>Save</b> keeps these figures to come back to.</span>';
        return;
    }

    host.innerHTML = items.map((item) =>
        '<span class="scen-chip" data-id="' + item.id + '">'
        + '<button type="button" class="scen-load" title="Saved ' + savedWhen(item) + '">'
        + escapeHtml(item.name) + '</button>'
        + '<button type="button" class="scen-del" aria-label="Delete ' + escapeHtml(item.name)
        + '"><i class="bi bi-x"></i></button>'
        + '</span>').join('');

    markActiveChips(moduleId);
}

const escapeHtml = (text) => String(text).replace(/[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function savedWhen(item) {
    const then = new Date(item.savedAt);
    return isNaN(then) ? 'earlier' : then.toLocaleString('en-MY', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
}

/**
 * A chip lights up when the form matches it exactly. That is the whole
 * "unsaved changes" indicator: change one figure and the light goes out, so
 * the bar can never claim you are looking at something you are not.
 */
function markActiveChips(only) {
    const ids = only ? [only] : moduleIds();

    ids.forEach((moduleId) => {
        const host = document.querySelector('#' + moduleId + ' .scen-chips');
        if (!host || !host.querySelector('.scen-chip')) return;

        const current = JSON.stringify(captureModule(moduleId));
        const items = scenariosFor(moduleId);

        host.querySelectorAll('.scen-chip').forEach((chip) => {
            const item = items.find((entry) => entry.id === chip.dataset.id);
            chip.classList.toggle('is-on', !!item && JSON.stringify(item.snap) === current);
        });
    });
}

function askScenarioName(moduleId) {
    const active = document.querySelector('#' + moduleId + ' .scen-chip.is-on');
    const item = active ? loadScenarios().find((entry) => entry.id === active.dataset.id) : null;

    askPrompt(
        'Save these figures',
        'Give this ' + (MODULES[moduleId] ? MODULES[moduleId].title.replace(' Calculator', '') : '')
        + ' scenario a name you will recognise later — “35 years at 4%”, “with a RM500 top-up”.',
        item ? item.name : suggestedName(moduleId),
        'Save',
        (name) => {
            const clean = name.trim().slice(0, 40);
            if (!clean) return;

            const clash = scenariosFor(moduleId)
                .find((entry) => entry.name.toLowerCase() === clean.toLowerCase());

            if (clash) {
                askConfirm('Replace “' + clash.name + '”?',
                    'That name is already taken on this calculator. Replacing it puts the figures '
                    + 'now on screen in its place; the old ones are not kept.',
                    'Replace',
                    () => saveScenario(moduleId, clean));
            } else {
                saveScenario(moduleId, clean);
            }
        });
}

/**
 * ====================================================================
 * EXPORT / IMPORT
 * ====================================================================
 * One envelope, one format, three ways in: the file you download, the file you
 * pick, and the file `drive.js` keeps in Drive. Keeping them identical is what
 * lets a Drive copy be dropped into Import by hand when something has gone
 * wrong enough that Drive itself is the problem.
 */
function backupEnvelope() {
    const stores = {};
    BACKUP_STORES.forEach((key) => {
        const raw = storedRaw(key);
        if (raw !== null) stores[key] = raw;
    });

    return {
        format:  'finsim.backup',
        version: 1,
        app:     'FinSim',
        savedAt: new Date().toISOString(),
        stores,
    };
}

/** "9 saved scenarios and the figures on screen" — enough to tell two copies apart. */
function backupSummary(envelope) {
    const stores = (envelope && envelope.stores) || {};

    let scenarios = 0;
    try {
        const parsed = JSON.parse(stores[SCENARIOS_KEY] || '{}');
        scenarios = (parsed.items || []).length;
    } catch (err) { /* an unreadable store counts as none */ }

    const filled = countFilled(stores[INPUTS_KEY]);

    const parts = [];
    parts.push(scenarios === 1 ? '1 saved scenario' : scenarios + ' saved scenarios');
    parts.push(filled ? 'the figures in ' + filled + ' ' + (filled === 1 ? 'calculator' : 'calculators')
                      : 'no figures on the forms');
    return parts.join(' and ');
}

/**
 * How many calculators have anything actually typed into them.
 *
 * "Non-empty" is not the test: nearly every form ships with a rate and a term
 * already in it, so counting non-empty fields reports thirteen calculators in
 * use on a first visit and tells you nothing. What counts is a box that starts
 * blank and no longer is — a salary, a house price, a balance.
 */
function countFilled(raw) {
    if (!raw) return 0;

    try {
        const saved = JSON.parse(raw);

        return Object.entries(saved.modules || {}).filter(([moduleId, snap]) => {
            if (!snap) return false;
            const defaults = FORM_DEFAULTS[formKeyOf(moduleId)] || {};

            return Object.entries(snap.f || {}).some(([id, value]) => {
                const typed = String(value).trim();
                if (!typed) return false;
                // A field the form knows about counts only if it starts blank;
                // one it does not know about (a relief line) counts unless it is
                // still sitting on the zero it was built with.
                return id in defaults ? defaults[id] === '' : typed !== '0';
            });
        }).length;
    } catch (err) { return 0; }
}

/**
 * Import **replaces**, it never merges. Merging means guessing which saved
 * scenario is which, and guessing wrong leaves you with two "Plan A"s that
 * disagree. The reload afterwards is because every form is read once at
 * start-up — putting new values in the stores without it changes nothing you
 * can see.
 */
function backupApply(envelope) {
    const stores = (envelope && envelope.stores) || {};

    BACKUP_STORES.forEach((key) => {
        if (stores[key] === undefined) {
            try { localStorage.removeItem(key); } catch (err) { /* nothing to remove */ }
        } else {
            storeRaw(key, stores[key]);
        }
    });

    location.reload();
}

function exportBackup(btn) {
    const envelope = backupEnvelope();
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'finsim-' + isoDate(new Date()) + '.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (btn) flashButton(btn, '<i class="bi bi-check-lg"></i><span>Saved</span>');
}

function importBackup(file) {
    const reader = new FileReader();

    reader.onerror = () => backupSay('That file could not be read',
        'The browser refused to open it. Try exporting a fresh copy.');

    reader.onload = () => {
        let envelope = null;
        try { envelope = JSON.parse(reader.result); } catch (err) { envelope = null; }

        if (!envelope || envelope.format !== 'finsim.backup') {
            return backupSay('That is not a FinSim backup',
                'A FinSim backup is the JSON file Export writes — it starts with '
                + '"format": "finsim.backup". A file from another app cannot be read here.');
        }

        askConfirm(
            'Replace what is in this browser?',
            'The file holds ' + backupSummary(envelope) + '. This browser holds '
            + backupSummary(backupEnvelope()) + ', and all of it will be replaced. '
            + 'The page reloads afterwards.',
            'Use the file',
            () => backupApply(envelope));
    };

    reader.readAsText(file);
}

/**
 * ====================================================================
 * THE DIALOG
 * ====================================================================
 * `confirm()` and `prompt()` would do the job and would look like 1998 in the
 * middle of this page. This is the same three functions with the app's own
 * furniture: say something, ask yes or no, ask for a word.
 */
let dialogYes = null;

function openDialog({ title, body, cta, danger = false, field = null, onYes = null }) {
    const scrim = $('dlg');
    if (!scrim) {                                  // the markup ships with the page; say so rather than going quiet
        alert(body ? title + ' — ' + body : title);
        return;
    }

    set('dlgTitle', title);
    set('dlgBody', body || '');
    $('dlgBody').hidden = !body;

    const box = $('dlgField');
    box.hidden = field === null;
    if (field !== null) {
        $('dlgInput').value = field;
    }

    const ok = $('dlgOk');
    ok.hidden = !onYes;
    ok.textContent = cta || 'OK';
    ok.classList.toggle('is-danger', danger);
    $('dlgCancel').textContent = onYes ? 'Cancel' : 'Close';

    dialogYes = onYes;
    scrim.hidden = false;
    document.body.style.overflow = 'hidden';

    setTimeout(() => (field !== null ? $('dlgInput') : ok.hidden ? $('dlgCancel') : ok).focus(), 30);
}

function closeDialog() {
    const scrim = $('dlg');
    if (scrim) scrim.hidden = true;
    document.body.style.overflow = '';
    dialogYes = null;
}

/** Something happened, or did not. One button, nothing to decide. */
function backupSay(title, body) {
    openDialog({ title, body });
}

/** Yes or no, where no is the safe answer and the default. */
function askConfirm(title, body, cta, onYes) {
    openDialog({ title, body, cta, danger: true, onYes: () => onYes() });
}

/** A name, with Enter to accept it. */
function askPrompt(title, body, value, cta, onYes) {
    openDialog({ title, body, cta, field: value, onYes: () => onYes($('dlgInput').value) });
}

/** A button that says what it just did, then goes back to saying what it does. */
function flashButton(btn, html) {
    if (!btn) return;
    if (!btn.dataset.rest) btn.dataset.rest = btn.innerHTML;
    btn.innerHTML = html;
    clearTimeout(btn._flash);
    btn._flash = setTimeout(() => { btn.innerHTML = btn.dataset.rest; }, 2200);
}

/**
 * ====================================================================
 * WIRING
 * ====================================================================
 */
document.addEventListener('DOMContentLoaded', () => {
    const exportBtn = $('backupExport');
    if (exportBtn) exportBtn.addEventListener('click', () => exportBackup(exportBtn));

    const importBtn = $('backupImport');
    const picker    = $('backupFile');
    if (importBtn && picker) {
        importBtn.addEventListener('click', () => picker.click());
        picker.addEventListener('change', () => {
            if (picker.files && picker.files[0]) importBackup(picker.files[0]);
            picker.value = '';                     // so picking the same file twice still fires
        });
    }

    const scrim = $('dlg');
    if (scrim) {
        $('dlgCancel').addEventListener('click', closeDialog);
        $('dlgOk').addEventListener('click', () => {
            const yes = dialogYes;
            closeDialog();
            if (yes) yes();
        });
        // Clicking the backdrop is a cancel; clicking the card is not.
        scrim.addEventListener('mousedown', (event) => { if (event.target === scrim) closeDialog(); });
        $('dlgInput').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') { event.preventDefault(); $('dlgOk').click(); }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !scrim.hidden) closeDialog();
        });
    }
});
