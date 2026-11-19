import { useState } from "react";
import Icon from "../Icon";
import Popover from "../Popover";
import { formatPct, payloadText } from "../../utils/runReport";
import { colors, outcome } from "../../theme";

const n = (x) => Number(x).toLocaleString();
const plural = (count, one, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

const BUG_TITLES = {
  accepted_invalid_input: "Accepted invalid input",
  rejected_valid_input: "Rejected valid input",
  server_error: "Server error",
};
const BUG_EXPLAIN = {
  accepted_invalid_input: "answered 2xx to input it should have rejected: missing validation, or an optional field (then set the case to expect 2xx)",
  rejected_valid_input: "refused input that is valid",
  server_error: "the server crashed on this input",
};
const LOAD_TITLES = { rate_limited: "Rate limited (429)", connection: "No answer (connection failure)" };

function Payload({ payload }) {
  const text = payloadText(payload);
  if (text == null) return null;
  return (
    <code className="payload" title={text}>
      {text}
    </code>
  );
}

function codesLabel(codes) {
  return codes.length ? ` (${codes.join(", ")})` : "";
}

// The first thing a finished run says: which inputs the API mishandles,
// named with the payload that triggered them; then whether every case was
// actually tested; then load effects. Never all-green unless it is.
export default function FindingsHeadline({ report }) {
  const [showUntested, setShowUntested] = useState(false);
  const { bugs, bugCaseCount, untested, cases, loadEffects, otherUnexpected, unexpected, requests, hasExpectations } = report;
  const totalCases = cases.length;
  const testedCount = totalCases - untested.length;

  let icon, iconColor, headline, sub;
  if (bugs.length) {
    icon = "cross";
    iconColor = colors.danger;
    headline = `${plural(bugCaseCount, "case")} found ${bugCaseCount === 1 ? "a bug" : "bugs"}`;
    sub = "These inputs got a wrong answer from the API. Each one is listed with the request that triggered it.";
  } else if (!requests) {
    icon = "untested";
    iconColor = colors.textMuted;
    headline = "Nothing was measured";
    sub = "No request reached the target, so there is nothing to judge.";
  } else if (untested.length || unexpected > 0) {
    icon = "alert";
    iconColor = colors.text;
    headline = untested.length
      ? `No bugs found in the ${plural(testedCount, "case")} that were tested`
      : "No bugs found";
    sub = unexpected > 0
      ? `${plural(unexpected, "request")} still got an unexpected answer, caused by load rather than by the input (see below).`
      : "Some cases were never sent, so this is not a full result.";
  } else {
    icon = "check";
    iconColor = colors.success;
    headline = "No bugs found";
    sub = hasExpectations
      ? `All ${plural(totalCases, "case")} were tested and every request got the expected answer.`
      : `All ${plural(requests, "request")} succeeded.`;
  }

  return (
    <section aria-labelledby="findings-headline" className="findings">
      <h2 id="findings-headline" className="verdict-line">
        <Icon name={icon} size={28} color={iconColor} />
        <span>{headline}</span>
      </h2>
      <p className="lede">{sub}</p>

      {bugs.length > 0 && (
        <ul className="bug-list">
          {bugs.map((b) => {
            const tone = outcome[b.kind];
            return (
              <li key={b.kind}>
                <div className="bug-kind">
                  <span className="swatch" style={{ background: tone.fg }} aria-hidden="true" />
                  <strong>{BUG_TITLES[b.kind]}{b.kind === "server_error" ? codesLabel(b.codes) : ""}</strong>
                  <span className="muted">
                    {plural(b.cases.length, "case")}, {plural(b.total, "request")}: {BUG_EXPLAIN[b.kind]}
                  </span>
                </div>
                <ul className="bug-cases">
                  {b.cases.map((c) => (
                    <li key={c.name}>
                      <span className="case-name">{c.name}</span>
                      <span className="count">×{n(c.count)}</span>
                      {c.expect && (
                        <span className="muted">
                          expected {c.expect === "accept" ? "2xx" : "4xx"}, got {c.codes.join(", ") || "no answer"}
                        </span>
                      )}
                      <Payload payload={c.payload} />
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}

      <div className="coverage-line">
        {untested.length === 0 ? (
          <>
            <Icon name="check" color={totalCases ? colors.text : colors.textMuted} />
            <span>
              {totalCases
                ? <><strong>Coverage:</strong> all {plural(totalCases, "case")} got requests.</>
                : <>No case list was recorded for this run.</>}
            </span>
          </>
        ) : (
          <>
            <Icon name="untested" dashed color={colors.text} />
            <span>
              <strong>Coverage: {n(testedCount)} of {plural(totalCases, "case")} tested.</strong>{" "}
              {plural(untested.length, "case got", "cases got")} no requests, so {untested.length === 1 ? "it was" : "they were"} not judged.{" "}
              <button type="button" className="btn-link" aria-expanded={showUntested} onClick={() => setShowUntested((v) => !v)}>
                {showUntested ? "Hide them" : "Show which"}
              </button>
              <Popover label="Why can a case get no requests?">
                Each simulated user picks a case at random for every request. With few users or a short
                duration, some cases are never picked. Raise the duration or the number of users to cover
                every case.
              </Popover>
            </span>
          </>
        )}
      </div>
      {showUntested && untested.length > 0 && (
        <ul className="chip-list" aria-label="Cases with no requests">
          {untested.map((c) => (
            <li key={c.name} className="chip chip-untested">{c.name}</li>
          ))}
        </ul>
      )}

      {[...loadEffects, ...otherUnexpected].map((g) => (
        <div key={g.kind} className="coverage-line">
          <span className="swatch" style={{ background: (outcome[g.kind] || outcome.other).fg }} aria-hidden="true" />
          <span>
            <strong>{LOAD_TITLES[g.kind] || (outcome[g.kind] || outcome.other).label}:</strong>{" "}
            {plural(g.total, "request")} ({formatPct((g.total / (requests || 1)) * 100)}) across {plural(g.cases.length, "case")}.
            {g.kind === "rate_limited" && " The target refused requests because too many arrived at once: a load limit, not a bug in the input."}
            {g.kind === "connection" && " The target did not answer at all: it may be overloaded or down."}
          </span>
        </div>
      ))}
    </section>
  );
}
