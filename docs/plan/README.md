# Plan: one owner per decision

A plan for fixing the console's recurring bugs at their root, written while
mapping the current console (1.5-feature-branch, b9b5c91e) and my fork side by side.

## Where it stands (2026-10-26)

- **Design choices are made.** Every open choice on my side is decided. The
  rules behind them are in [specs/00-overview.md](specs/00-overview.md), and
  every change they make to how the current console plays is one line each
  under "Decided on our side" in [QUESTIONS.md](QUESTIONS.md).
- **Building has started in my fork,** with movement first. The first two
  steps change no behaviour: each walk records why it ended and what
  replaced it, and a new movement owner runs beside the current code,
  logging only where its decision would differ. It takes control only once
  every difference is explained.
- **Five questions are open for you,** all about what your code was meant to
  do or what your unpushed work covers.

## Reading guide

- **Start here:** [specs/00-overview.md](specs/00-overview.md): what the
  review found and the principles of the plan.
- **Questions and decisions:** [QUESTIONS.md](QUESTIONS.md): the five
  questions, then the decided changes. A yes, no or "here's why" is plenty,
  here or on Discord. The full context for each question is in
  [QUESTIONS-DETAILS.md](QUESTIONS-DETAILS.md).
- **Owner designs:** [specs/02-movement-design.md](specs/02-movement-design.md),
  [specs/01-groups-and-tasks-design.md](specs/01-groups-and-tasks-design.md)
  and [specs/08-09-merchant-design.md](specs/08-09-merchant-design.md). Each
  starts its decisions section with a "Decided 2026-10-26" list that
  overrides older text in the same file.
- **Details:** `specs/01` to `13` cover each part of the console (what it does
  today, what goes wrong, with file and line on b9b5c91e).
  `implementation/` explains how the plan is checked.

Nothing here is locked in. Anything you disagree with changes the plan.
