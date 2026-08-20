/**
 * FinSim — where the Drive copy lives, and who is allowed to write it.
 *
 * Both values are safe to publish, and both are meant to be. An OAuth client
 * ID is not a secret — it only names the app; Google will not hand it a token
 * without you signing in and agreeing, and it only works from the web
 * addresses you registered against it. A folder ID is likewise just a name:
 * without permission on the folder, knowing its ID gets you nothing.
 *
 * What must NEVER appear in this file is a **client secret**. The web flow
 * this app uses does not need one. If you ever find yourself pasting something
 * labelled "secret" in here, stop — you have created the wrong kind of
 * credential.
 *
 * Setup is a few minutes of clicking, once. See docs/DRIVE.md.
 */

const FS_DRIVE = {

    /**
     * Google Cloud → APIs & Services → Credentials → OAuth client ID (Web
     * application). Paste it here; it ends in `.apps.googleusercontent.com`.
     *
     * Until this is replaced, every Drive button says so instead of failing
     * oddly. Export and Import work regardless — they need no account at all.
     */
    clientId: '677364267902-ql4f9kn6msra9ahl6e9co8jhh2vobiaq.apps.googleusercontent.com',

    /**
     * The folder the file is kept in, taken from its Drive URL — the part
     * after `/folders/` and before any `?`:
     *
     *     https://drive.google.com/drive/folders/19TPVA4q…C0wSfYGm?usp=sharing
     *                                            └───── this ─────┘
     *
     * Keep this folder **Restricted** in Drive's Share settings. "Anyone with
     * the link" means anyone with the link can read your salary and every
     * scenario you have saved.
     */
    folderId: '19TPVA4qq6bnwN9kQh_p4UOycB0wSfYGm',

    /** The one file FinSim writes. Renaming it in Drive starts a new one. */
    filename: 'finsim-data.json',
};
