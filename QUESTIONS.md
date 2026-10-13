# TOM Local and Prerelease questions

## QLP-1: Wizard round times

For a new TCG Custom or Prerelease event, what Swiss round time does the wizard show, what input range does it accept, and does Verify clamp or reject an out-of-range input? Does choosing a cut or elimination-only change these rules? SPEC 3.2 establishes 30 minutes for TCG Swiss defaults, but does not specify these modes' input ranges. Scenarios: `prerelease-defaults`, `v17-wizard-third-place-custom`, `v17-wizard-third-place-prerelease`. `prerelease-defaults` directly configures 30/30; it does not establish wizard presets.

## QLP-2: Wizard finals time

For a new TCG Custom or Prerelease event, what finals time is stored before configuration, what does the wizard show with and without a cut, what input range does it accept, and does Verify adjust it? Does elimination-only change these rules? Scenarios: `prerelease-defaults`, `v17-wizard-third-place-custom`, `v17-wizard-third-place-prerelease`, `v22-prerelease-cut-rounds`. Until answered, the site retains its existing 75-minute finals setting as an application default, not a claimed TOM preset.

## QLP-3: Real locals' saved mode

Which root modes and types do the real local events in the SPEC basis use? Is `CUSTOM` the correct mapping for the site's Local option, including locals with a cut? Provisionally Local maps to `CUSTOM`; imported files retain their recorded mode and type. Related synthetic scenarios: `v17-wizard-third-place-custom`, `v23-wizard-less-swiss-combined-pod`. The real-file basis does not publish scenario IDs for the individual locals.
