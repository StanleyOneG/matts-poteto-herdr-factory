# Issue tracker: GitHub

Issues and specs live in GitHub Issues for
StanleyOneG/matts-poteto-herdr-factory. Use the gh CLI.
Inside this clone, gh infers the repository from the remote.

## Operations

- Create: `gh issue create --title "..." --body-file <file>`.
  Use a temporary Markdown file or heredoc for multiline bodies.
- Read: `gh issue view <number> --comments`.
  Fetch labels with `gh issue view <number> --json labels`.
- List: `gh issue list --state open --json number,title,body,labels,comments`.
  Apply label and state filters as needed.
- Comment: `gh issue comment <number> --body "..."`.
- Add or remove labels: `gh issue edit <number> --add-label "..."`
  or `--remove-label "..."`.
- Close: `gh issue close <number> --comment "..."`.

“Publish to the issue tracker” means create a GitHub issue.
“Fetch the relevant ticket” means read the issue and its comments.

## Pull requests as a triage surface

PRs as a request surface: no.

GitHub shares issue and PR numbers. When the type is unclear,
try `gh pr view <number>` and fall back to `gh issue view <number>`.

## Parent and child issues

Use GitHub sub-issues. Get the child's database ID with:
`gh api repos/{owner}/{repo}/issues/<child> --jq .id`

Attach it to its parent:
`gh api --method POST repos/{owner}/{repo}/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`

If sub-issues are unavailable, add `Part of #<parent>` at the top
of the child body and link the child in the parent's task list.

## Wayfinding

- The map is one issue labelled `wayfinder:map`, containing
  Notes, Decisions-so-far, and Fog.
- Link child tickets to the map. Label each `wayfinder:<type>`,
  where type is research, prototype, grilling, or task.
- Record blocking relationships with native issue dependencies:
  `gh api --method POST repos/{owner}/{repo}/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`.
  Use the blocker's database ID, not its issue number or node ID.
- If dependencies are unavailable, put `Blocked by: #<n>, #<n>`
  at the top of the child body.
- To find available work, list the map's open children, exclude
  assigned tickets and tickets with open blockers, and select
  the first remaining ticket in map order.
  Native `issue_dependencies_summary.blocked_by` counts open blockers.
- Claim with `gh issue edit <number> --add-assignee @me`
  as the session's first write.
- Resolve by commenting with the answer, closing the ticket,
  and adding a summary and link to the map's Decisions-so-far.
