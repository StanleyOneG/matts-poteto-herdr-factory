# Domain docs

This repository uses a single-context layout:

- `GLOSSARY.md` at the repository root defines domain terminology.
- `docs/adr/` holds architecture decision records.

## Before exploring

Read `GLOSSARY.md` and ADRs relevant to the area being explored.

If these files do not exist, proceed silently. The domain-modeling
skill creates them when terms or decisions are resolved.

The existing `dictionary/` contains AI coding terminology.
Continue following the dictionary lookup rules in `AGENTS.md`.

## Use domain vocabulary

Use glossary terms in issue titles, proposals, hypotheses, and tests.
Respect any explicitly discouraged synonyms.

If a needed concept is missing, reconsider whether it belongs to
the domain; note genuine gaps for domain-modeling.

## Flag decision conflicts

Explicitly identify any proposal that contradicts an existing ADR.
Name the ADR and explain why the decision should be reconsidered.
