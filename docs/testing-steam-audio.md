# In-game audio controls

Speaker clipping failure inventory: the outer sound-wave arc and its stroke
extend beyond the 24-unit SVG viewport. Translating a still-clipped SVG alone
does not restore those pixels. Shift the speaker three pixels left and allow
its complete stroke to render into the button padding; preserve music geometry,
button dimensions and both mute states. Verify the existing browser audio
journey and inspect its saved screenshot before completing an immutable build.

The speaker is translated left by 3px with visible SVG overflow. The saved
browser screenshot was inspected and shows its complete outer wave inside the
button. The audio-toggle/minimize/restore journey passed; all seven retained
Steam recovery checks passed. Final console evidence is preserved in
`.build/steam-speaker-green-report/` and `.build/steam-speaker-green-results/`.
The first passing browser run is retained in `.build/steam-speaker-initial-*`;
its verifier caught Playwright replacing an older failed `.last-run.json` after
the evidence reporter sealed the manifest, so the focused browser check was
repeated with stable passed run metadata. No live activation was performed.

Run `npm test -- -- --project=console --grep "Steam Characters bar"`.

Failure inventory and declared boundaries live in `e2e/steam-audio.case.ts`.
The maintained Steam switcher renders in Chromium. The scenario starts with
effects on and music off, toggles each independently through native audio
function boundaries, checks preference writes, observes external flag changes
without a roster reply, and verifies minimize/restore and disposal. A pending
character handoff must not disable these local controls. The report and saved
screenshots/ledger are in `.build/e2e-report/` and `.build/e2e-results/`.

The controls read `sound_sfx` and `sound_music` and call the game's `sfx_on`,
`sfx_off`, `sound_on`, and `sound_off` functions. These native functions save
preferences and update audio playback and settings UI. See the
[native audio implementation](https://github.com/kaansoral/adventureland_mongodb/blob/main/js/functions.js).
The test declares this game boundary; it does not claim audible playback
validation. CODE startup no longer overrides native music preferences.

Builds stage the updated Steam bridge and character scripts. Activate through
the supported full console workflow in `runtime/coordinator/README.md`; bridge
version 14 replaces the older switcher during the next authorized CODE load.
