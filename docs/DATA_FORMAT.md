# Local event data

The checked-in `examples/demo.json` is a complete, original calibration input. It contains no transcription from the named artists. Duplicate its structure when creating a private bundle and keep the result in `local/`.

All times use seconds on the untrimmed recording. MIDI pitches are integers from 0 to 127. Note arrays must be sorted by attack time. Note intervals include their start and exclude their end.

## Presentation settings

| Field | Meaning |
| --- | --- |
| `presentation.start` | First recording second to render. |
| `presentation.gainDb` | Constant export gain. Defaults to zero. |
| `audioSha256` | Optional lowercase SHA-256 of the exact recording bytes. Song/performance bundles can carry this inside their metadata. |

CLI flags override render start and frame rate without shifting the underlying event coordinates. A score prepared for one audio file cannot be paired with a different recording hash.

The optional Python preparer writes a complete bundle to `local/events.json`. A failed preparation does not replace an existing bundle. Intermediate alignment files are created in a private temporary folder and removed after the run.

## Source status

Keep provenance accurate. Imported score events and inferred harmony are distinct from human-reviewed recording transcription. The supplied tools emit imported or estimated status values. They do not certify performance accuracy.

## Two Moons bundle

| Field | Required structure |
| --- | --- |
| `duration` | Recording duration in seconds. |
| `title`, `artist` | Optional display metadata. Defaults to Two Moons and toe. |
| `bars` | Contiguous bar boundaries, meter and pulse arrays. |
| `drums` | Drum hits in recording time. |
| `guitars` | Exactly two guitar parts. |
| `chords` | Nonoverlapping chord-label intervals. May be empty. |

Each bar has `start`, `end`, `meter: [numerator, denominator]` and `pulses`. There are numerator + 1 pulse boundaries, including the bar’s start and end. Each interval may have a different duration.

A drum hit has `time`, MIDI `pitch`, one-based `bar`, and optional boolean `ghost` and `accent`. The original study classifies 36 as kick, 38 as snare, 46 as hi-hat and remaining pitches as the cymbal lane. Adapt `classify` in `src/renderer.mjs` when using a different drum map.

Each guitar includes `tuning`, `capo` and sorted `notes`. Notes contain `start`, `end`, `pitch`, `string`, `fret` and optional `ghost`. Tuning is highest string first. The pitch already includes the capo offset and any notated harmonic conversion. The renderer shows actual supplied notes and a brief attack glow. It does not synthesize bend or slide gestures absent from this format.

Each chord has `start`, `end` and `symbol`. Inferred harmony can contain gaps when the pitch evidence is insufficient.

For the optional score preparer, `local/score-tracks/` contains six gzip-compressed files named `0.json` through `5.json`. Each track uses `tuning`, optional `capo`, `measures[].voices[].beats[]` and rational beat durations. Tempo automations live in track 0 and meter signatures in the percussion measures. This is the original arrangement schema.

An optional local drum stem can refine timing with `--drum-stem local/drums.wav` on `tools/prepare.py`. It is used only for transient evidence and is never mixed into the exported video.
