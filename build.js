/**
 * ====================================================================
 * FinSim — the deployable copy
 * --------------------------------------------------------------------
 * Reads the working files in this folder and writes a `dist/` next to them:
 * the same site with the JavaScript minified, and every local asset stamped
 * with a hash of its own contents.
 *
 *     node build.js
 *
 * WHAT THIS IS FOR, HONESTLY
 * --------------------------
 * It was asked for to stop the code being copied, and on its own it does not
 * do that — minified JavaScript is one click of the browser's `{ }` button
 * away from being readable again, and no amount of mangling changes that. It
 * only becomes worth anything once the **source stops being published**, which
 * is a repository decision rather than a build one. See BUILD.md.
 *
 * What it does do, on its own and today:
 *
 *   - **Halves what a phone downloads.** ~255 KB of JavaScript becomes ~110 KB.
 *     That is a real gain on a slow connection and needs no other change.
 *
 *   - **Ends the stale-cache bug for good.** The `?v=` in index.html was a
 *     number that had to be remembered by hand, and a forgotten bump means
 *     GitHub Pages happily serves yesterday's app.js to a phone for days —
 *     which then gets reported as a bug that cannot be reproduced. Here the
 *     stamp is a hash of the file's own bytes, so it changes when, and only
 *     when, the file does. It cannot be forgotten, and it cannot be wrong.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 *   - **No top-level mangling.** These five files are separate <script> tags
 *     sharing globals — `FSStore`, `FS_DRIVE`, `escapeHtml`, `cleanEnvelope`.
 *     Renaming across that boundary would break them silently, so terser is
 *     run without `toplevel`: local names are shortened, shared ones are not.
 *
 *   - **No touching of the sources.** `dist/` is written; nothing in this
 *     folder is modified. Opening index.html here still works with no build,
 *     which is how this project has always been developed and is worth keeping.
 *
 *   - **No stripping of the Content-Security-Policy.** It is copied through
 *     unaltered, and the build fails loudly below if it ever is not.
 * ====================================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const HERE = __dirname;
const DIST = path.join(HERE, 'dist');

/** Minified, in the order index.html loads them. */
const SCRIPTS = ['store.js', 'app.js', 'save.js', 'drive-config.js', 'drive.js'];

/** Copied as-is, but stamped. */
const STYLES = ['style.css'];

/** Copied as-is. Images are already compressed and are not stamped. */
const ASSETS = [
    'FinSimLogo.svg', 'FinSimMark.svg', 'FinSimLogo.png', 'FinSimMark.png',
    'FinSimLogo-icon.png', 'FinSimLogo-mark.png', 'FinSimLogo-trim.png', 'FinSimLogo-wide.png',
];

const stamp = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 10);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

function minify(file) {
    const from = path.join(HERE, file);

    // `--mangle` with no `toplevel` is the whole safety story: see the header.
    //
    // A composed command rather than an argument list, because npx is a .cmd on
    // Windows and Node will not spawn one of those directly. The only thing
    // interpolated is a path this file worked out for itself, and it is quoted
    // because this folder can sit under "Documents" or any other name with a
    // space in it.
    const out = execSync(
        'npx --yes terser@5 ' + JSON.stringify(from) + ' --compress --mangle',
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );

    if (!out || !out.trim()) throw new Error('terser returned nothing for ' + file);
    return out;
}

function build() {
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(DIST, { recursive: true });

    let html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

    if (!/Content-Security-Policy/.test(html)) {
        throw new Error('index.html has no Content-Security-Policy — refusing to ship it.');
    }

    let sourceBytes = 0;
    let builtBytes = 0;

    SCRIPTS.forEach((file) => {
        const raw = fs.readFileSync(path.join(HERE, file), 'utf8');
        const small = minify(file);

        const name = file.replace(/\.js$/, '.min.js');
        fs.writeFileSync(path.join(DIST, name), small, 'utf8');

        sourceBytes += Buffer.byteLength(raw);
        builtBytes += Buffer.byteLength(small);

        // `store.js?v=14` and bare `store.js` both become `store.min.js?v=<hash>`.
        const pattern = new RegExp('(["\'])' + file.replace('.', '\\.') + '(\\?v=[^"\']*)?\\1', 'g');
        const before = html;
        html = html.replace(pattern, '$1' + name + '?v=' + stamp(small) + '$1');

        if (html === before) throw new Error('index.html never referenced ' + file);

        console.log('  ' + file.padEnd(18) + kb(Buffer.byteLength(raw)).padStart(9)
            + '  ->  ' + kb(Buffer.byteLength(small)).padStart(9) + '   ' + name);
    });

    STYLES.forEach((file) => {
        const css = fs.readFileSync(path.join(HERE, file), 'utf8');
        fs.writeFileSync(path.join(DIST, file), css, 'utf8');

        const pattern = new RegExp('(["\'])' + file.replace('.', '\\.') + '(\\?v=[^"\']*)?\\1', 'g');
        html = html.replace(pattern, '$1' + file + '?v=' + stamp(css) + '$1');
    });

    ASSETS.forEach((file) => {
        const from = path.join(HERE, file);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DIST, file));
    });

    // A stale `?v=` left anywhere means a file this build did not account for.
    const leftover = html.match(/["'][^"']*\?v=\d+["']/g);
    if (leftover) throw new Error('un-stamped reference left in index.html: ' + leftover.join(', '));

    fs.writeFileSync(path.join(DIST, 'index.html'), html, 'utf8');

    // The Drive documentation is linked from inside the app.
    const docs = path.join(HERE, 'docs');
    if (fs.existsSync(docs)) {
        fs.mkdirSync(path.join(DIST, 'docs'), { recursive: true });
        fs.readdirSync(docs).forEach((f) =>
            fs.copyFileSync(path.join(docs, f), path.join(DIST, 'docs', f)));
    }

    fs.copyFileSync(path.join(HERE, 'LICENSE'), path.join(DIST, 'LICENSE'));

    const saved = 100 - (builtBytes / sourceBytes * 100);
    console.log('\n  JavaScript ' + kb(sourceBytes) + ' -> ' + kb(builtBytes)
        + '  (' + saved.toFixed(0) + '% smaller)');
    console.log('  dist/ is ready to deploy.\n');
}

try {
    console.log('\nBuilding FinSim\n');
    build();
} catch (err) {
    console.error('\n  BUILD FAILED: ' + err.message + '\n');
    process.exit(1);
}
