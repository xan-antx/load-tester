# UX and accessibility review: Elevate Load Tester frontend

Date: 9 October 2026. Scope: `code/frontend` (the dark "instrument console" design).

## How the review was done

The real app was used in a browser, with the Flask backend on port 5000 and the mock
target (`scripts/mock_target.py`) on port 8000. The full flow was run end to end:

1. Analyze `http://127.0.0.1:8000/api/login`.
2. Generate edge cases from `{"username":"demo","password":"demo123","expiresInMins":30}`.
3. Add a custom case `admin_user`.
4. Run 15 users (15 per second, 30 s) and mark it as the baseline.
5. Run 150 users (20 per second, 30 s). This split across 3 workers and showed 3 regressions against the baseline.
6. Download the Markdown report.
7. Compare 3 runs.
8. Analyze `https://example.com` and run a website test (2 users, 5 s).

Error paths were also tried:

- a malformed URL;
- an unreachable URL;
- invalid JSON;
- a JSON array as the sample;
- starting with no cases selected;
- the backend not answering (simulated in the browser).

The review uses Nielsen's 10 usability heuristics, from `.claude/skills/ux-heuristics-review`, and
WCAG 2.2 AA, from `.claude/skills/accessibility`. Colour contrast was calculated from the theme tokens.

Severity:

- **High:** a user can lose work, test the wrong system, or think the app is broken.
- **Medium:** it slows the user down or confuses them, but there is a way round it.
- **Low:** polish.

Every issue has an id (U1, A1 …) that matches the table at the end.

---

## 1. Visibility of system status

**Works well**
- A "Connected / Backend offline" light in the header checks the backend every 15 seconds.
- Each step shows its state ("Current step", "Done", "Waiting", "Not needed"), both in the left rail and on the panel.
- While a test runs, there is a progress bar, an elapsed-time counter and a live "Queued / Running / Completed" status.
- Buttons change their label while busy ("Analyzing…", "Generating…", "Comparing…", "Test in progress…").

**Issues**
- **U1:** Errors appear in a banner at the top of the page. When you press "Confirm selection and start load test" lower down (for example with no cases selected), the banner is about 900 px above the screen. It looks as if nothing happened.
- **U4:** Step 1 showed "Done" even when the analysis failed (unreachable URL).
- **U9:** After starting a test, the progress panel appears below the bottom of the screen, so there is no visible response to the click.
- **U20:** After analyzing a new target, step 4 still shows the previous run's result, identified only by its run id.

**Severity: high.** A click that seems to do nothing makes the app look broken (U1).

## 2. Match between system and the real world

**Works well**
- The "Summary of results" uses plain sentences ("22 cases were rejected as invalid input (400)").
- Outcomes are named the way people talk about them (Passed, Rejected, Rate limited, Server error).
- p95 is explained under the number ("95% were faster").

**Issues**
- **U12:** "Failure rate" counts every non-2xx response as a failure, including 400s for deliberately invalid edge cases. A correct API that rejects bad input shows an alarming "89.9% failure rate". The summary sentences explain it, but the headline number does not.
- **U15:** "Spawn rate" is load-testing jargon.

**Severity: medium.** The headline number can mislead someone who doesn't read the summary.

## 3. User control and freedom

**Works well**
- Every case can be ticked or unticked, and whole categories toggled.
- Custom cases can be removed.
- Runs can be ticked or unticked for comparison.
- Raw responses can be shown and hidden.
- Errors can be dismissed.
- The step rail only scrolls; it never hides work.

**Issues**
- **U13:** There is no way to stop a running test. You have to wait up to the full duration (up to 300 s).

**Severity: medium.** You can wait it out, but a mistaken 300-second run blocks all other tests.

## 4. Consistency and standards

**Works well**
- There is one primary button style, one secondary style and one link style throughout.
- Status colours mean the same thing everywhere (strip, table, findings, comparison).
- Times are always local and use the same format.

**Issues**
- **U14:** The website button said "Run Website Load Test" and "Starting...". Every other button uses sentence case and the "…" character.

**Severity: low.** It is cosmetic.

## 5. Error prevention

**Works well**
- The start buttons are disabled while a test runs, so a second test can't clobber the first.
- "Select at least one edge case" stops an empty test.
- Custom cases are validated by the backend before they are added.
- The number fields show their allowed range in the label.
- The comparison is limited to 2–4 runs, and extra checkboxes are disabled.

**Issues**
- **U3:** After analyzing a different URL, the old API cases stayed on screen and "Confirm selection and start load test" still worked. The test was sent to whatever URL was in the field at that moment. During the walkthrough, step 3 (built for the mock API) was still active after analyzing example.com. One click would have sent 26 API edge cases to a third-party website. Editing the URL field without re-analyzing had the same effect.
- **U7:** A malformed URL ("not a url") was sent to the backend, which answered only "Could not reach or analyze that URL".
- **U10:** Out-of-range numbers were silently changed (5000 users became 1000) with no message.
- **U11:** The API start button stayed clickable while the two start requests were in flight, before the run id came back.

**Severity: high.** U3 can load-test the wrong system.

## 6. Recognition rather than recall

**Works well**
- Each step has a one-line description.
- The selected count is always shown ("27 of 27 selected").
- The comparison shows "#1, #2, #3" next to ticked runs, and the baseline is starred in the history.

**Issues**
- **U8:** The start button did not say where the test would go. You had to scroll up to the URL field and remember whether it had been analyzed.
- **U16:** The run history shows only the host (`http://127.0.0.1:8000`), not the path. Two endpoints on the same server look identical.

**Severity: medium.** You need to remember the target at the moment it matters most.

## 7. Flexibility and efficiency of use

**Works well**
- Enter in the URL field starts the analysis, and Enter commits the number fields.
- Select all / none and per-category toggles make large case lists quick.
- Results tables can be sorted and switched between flat and grouped views.

**Issues**
- **U18:** The run history keeps growing (50 rows in this session) with no filter, search or delete.

**Severity: low.** It only becomes a problem after many runs.

## 8. Aesthetic and minimalist design

**Works well**
- It is a quiet dark theme with one accent colour.
- Numbers are the visual focus, and details (raw JSON, data tables, failure reasons) are tucked behind toggles.
- The step layout keeps one task per panel.

**Issues**
- No significant issues. U18 (the long history list) is the only clutter found.

**Severity: low.**

## 9. Help users recognize, diagnose, and recover from errors

**Works well**
- Invalid JSON gets "Sample input must be valid JSON".
- A custom case gets a specific reason it was rejected.
- The analyze network error names the backend address to check.
- "Why did these fail?" groups failures by type with an example.

**Issues**
- **U2:** If the backend stopped answering, these actions failed with no message at all:
  - Generate;
  - Validate and add;
  - both start buttons;
  - Compare;
  - Mark as baseline.

  The button just went back to normal.
- **U5:** Backend errors were shown as raw JSON, for example `{"error":"sample_input (object) is required"}`.
- **U6:** An unreachable target showed only the raw Python exception (`HTTPConnectionPool(host='127.0.0.1', port=9): Max retries exceeded …`).
- **U17:** If the backend goes down during a run, the status stays "Running" forever, because the status poll has no error handling.

**Severity: high.** Silent failures (U2) give the user nothing to act on.

## 10. Help and documentation

**Works well**
- Step descriptions explain each stage.
- Notes appear under numbers (approximate p95 for split runs, low-sample cells in the comparison).
- A sentence above the timeline explains how Locust computes averages and p95.

**Issues**
- **U19:** Some explanations exist only as hover tooltips (`title`), for example "Split across 3 workers" and the p95 approximation in table cells. Keyboard and touch users can't see them.

**Severity: low.** The key explanations are also in visible text.

---

## Accessibility (WCAG 2.2 AA)

**Already in place**
- `lang="en"`.
- One `h1`, `h2` per step and `h3` per sub-section.
- Every input has a label.
- Visible focus outline (2 px accent).
- `aria-current="step"` in the rail.
- `aria-sort` on sortable headers.
- `aria-pressed` on the Flat / Grouped toggle.
- `aria-expanded` on disclosures.
- `role="alert"` on errors and `role="status"` for the run status.
- The progress bar has `aria-valuenow`.
- The charts have a data-table alternative (1.1.1).
- Outcomes and changes never rely on colour alone (labels, ▲/▼ arrows, percentages).
- A reduced-motion rule.

**Issues found**
- **A1. 1.4.3 Contrast (Minimum):** the "faint" text colour `#5F676E` used for informative text had these contrast ratios:

  | Background | Contrast |
  |---|---|
  | Page | 3.24:1 |
  | Panels | 3.04:1 |
  | Raised sub-panels | 2.78:1 |
  | Inputs | 3.34:1 |

  This text includes the "Waiting" / "Not needed" step states, case labels, the "—" and "0%" cells in the comparison, and counts in the outcome strip. AA needs 4.5:1. All other text colours pass: muted text is 5.3–6.4:1, and the accent and status colours are all above 4.5:1.
- **A2. 2.4.1 Bypass Blocks:** there was no skip link. Keyboard users had to tab through the five step-rail buttons before reaching the content.
- **A3. 2.5.8 Target Size (Minimum):** the "×" buttons (dismiss error, remove custom case) were 15 px wide.
- **A4. 2.4.3 Focus Order / 4.1.3 Status Messages:** errors raised far down the page were announced, but focus stayed on the button and the banner stayed off-screen (see U1).
- **A5. 1.3.1 Info and Relationships:** the run-history header row is hidden from screen readers. Each run's checkbox was announced only with its start time and user count, not its target, status or baseline flag.
- **A6. 1.3.1 / 3.3.2:** tooltip-only explanations (U19).
- **Checked and passing:** checkboxes are 13 px, but each sits inside a full-width clickable row (2.5.8 passes). Sort headers are 18 px tall but have enough space around them (2.5.8 spacing exception).

---

## All issues

| ID | Heuristic / guideline | Severity | Description | Status |
|---|---|---|---|---|
| U1 | H1 Visibility of system status | High | Error banner shows at the top of the page, off-screen, when an action lower down fails. The click looks ignored. | Fixed: the banner scrolls into view and takes focus when an error appears. |
| U2 | H9 Recover from errors | High | Network failures in Generate, Validate and add, both start buttons, Compare and Mark as baseline gave no message. | Fixed: each shows "<reason> (Is the backend reachable at …?)", the same wording as Analyze. |
| U3 | H5 Error prevention | High | Old API cases stayed active after analyzing a different URL. Editing the URL field redirected the next test without re-analysis, so API edge cases could hit a third-party site. | Fixed: cases are cleared when a different URL is analyzed, and both start actions are blocked with a message while the URL differs from the analyzed one. |
| U4 | H1 Visibility of system status | Medium | Step 1 showed "Done" after a failed analysis. | Fixed: Done only after a successful API or website analysis of the current URL. |
| U5 | H9 Recover from errors | Medium | Backend errors shown as raw JSON. | Fixed: the error sentence is shown, with JSON only as a last resort. |
| U6 | H9 Recover from errors | Medium | Unreachable target showed only a raw Python exception. | Fixed: a plain-English message, with the technical detail in smaller text below. |
| U7 | H5 Error prevention | Medium | Malformed URL got a generic "Could not reach or analyze that URL". | Fixed: checked before sending ("Enter a full URL starting with http:// or https://…"). |
| U8 | H6 Recognition rather than recall | Medium | The start buttons didn't show the target. | Fixed: "Sends N cases to <url>" above the API button, and the URL in the website note. |
| U9 | H1 Visibility of system status | Medium | Progress panel appeared off-screen after starting a test. | Fixed: the page scrolls to "Run and results" when a run starts. |
| U10 | H5 Error prevention | Medium | Out-of-range numbers silently changed. | Fixed: a note under the field, such as "Set to 1000, the maximum". |
| U11 | H5 Error prevention | Medium | API start button clickable while the start requests were in flight. | Fixed: it shows "Starting…" and is disabled until the run starts or fails. |
| U12 | H2 Real-world match | Medium | "Failure rate" counts expected 400 rejections of invalid inputs as failures. | Deferred: changing what "failure" means affects results, comparison, baseline regressions, the report and the backend's numbers, so it needs a team decision. The summary sentences already explain the 400s. |
| U13 | H3 User control | Medium | No way to stop a running test. | Deferred: there is no backend endpoint to stop a run, and backend changes were out of scope. |
| U17 | H9 Recover from errors | Medium | If the backend goes down mid-run, the status stays "Running" forever. | Deferred: the fix belongs in `pollStatus()`, which must not be changed. The header light turns red within 15 s, which partly covers it. |
| U14 | H4 Consistency | Low | "Run Website Load Test" / "Starting..." didn't match the other buttons. | Fixed: "Run website load test" / "Starting…". |
| U15 | H2 Real-world match | Low | "Spawn rate" is jargon. | Fixed: the label is now "New users per second (spawn rate), 1 to 20". |
| U16 | H6 Recognition rather than recall | Low | Run history shows only the host, not the path. | Deferred: the backend stores and returns only the host. |
| U18 | H7 Flexibility / H8 Minimalism | Low | Run history grows without filter or delete. | Deferred: delete needs a backend endpoint, and filtering is a feature rather than a fix. |
| U19 | H10 Help | Low | Some explanations exist only as hover tooltips. | Deferred: the important ones are also visible text; the rest is polish. |
| U20 | H1 Visibility of system status | Low | After analyzing a new target, step 4 still shows the old run with only its id. | Deferred: low risk. The run id and "Pages tested" line identify it, and the next run replaces it. |
| A1 | WCAG 1.4.3 Contrast | Medium | Faint text was 2.78–3.34:1 (needs 4.5:1). | Fixed: `textFaint` is now `#818A92`, at least 4.56:1 on every surface and still below the muted text. |
| A2 | WCAG 2.4.1 Bypass blocks | Medium | No skip link. | Fixed: a "Skip to content" link is the first focusable element and appears on focus. |
| A3 | WCAG 2.5.8 Target size | Low | "×" buttons were 15 px wide. | Fixed: at least 24 × 24 px. |
| A4 | WCAG 2.4.3 / 4.1.3 | High | Errors far down the page left focus on the button and the banner off-screen. | Fixed with U1: focus moves to the banner. |
| A5 | WCAG 1.3.1 Info and relationships | Low | Run-history checkboxes were announced without target, status or baseline. | Fixed: the checkbox label now includes all of them. |
| A6 | WCAG 1.3.1 / 3.3.2 | Low | Tooltip-only explanations. | Deferred: same as U19. |
