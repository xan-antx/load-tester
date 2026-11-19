import { useMemo, useState } from "react";
import { request, describeError, networkError } from "../api";

const DEFAULT_SAMPLE =
  import.meta.env.VITE_DEFAULT_SAMPLE || '{"username": "demo", "password": "demo123", "expiresInMins": 30}';

// Live JSON check for the sample body: null when fine, else a message that
// says where the problem is.
export function jsonProblem(text) {
  if (!text.trim()) return "Paste a JSON object, for example {\"username\": \"demo\"}.";
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return "The sample must be a JSON object ({ … }), not a list or a single value.";
    }
    return null;
  } catch (err) {
    const m = /position (\d+)/i.exec(err.message);
    if (m) {
      const pos = Number(m[1]);
      const before = text.slice(0, pos);
      const line = before.split("\n").length;
      const col = pos - before.lastIndexOf("\n");
      return `Not valid JSON: problem at line ${line}, column ${col}.`;
    }
    return `Not valid JSON: ${err.message}`;
  }
}

// The sample body, the generated and custom cases, which are selected, and
// each case's expected answer.
export default function useCases({ onNetworkError } = {}) {
  const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE);
  const [sampleInput, setSampleInput] = useState(null);
  const [cases, setCases] = useState([]);
  const [selected, setSelected] = useState({});
  // [{label, payload, description, classified_as, expect}]
  const [customCases, setCustomCases] = useState([]);
  // Per-label overrides of a generated case's expected answer.
  const [expectOverrides, setExpectOverrides] = useState({});
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const sampleProblem = jsonProblem(sampleText);

  const allCases = useMemo(
    () => [...cases, ...customCases.map((c) => ({ ...c, category: "custom", isCustom: true }))],
    [cases, customCases]
  );

  function reset() {
    setCases([]);
    setCustomCases([]);
    setSelected({});
    setExpectOverrides({});
    setError(null);
  }

  // Returns the generated cases (or null), so callers can apply a stored
  // selection afterwards.
  async function generate(text = sampleText) {
    setError(null);
    const problem = jsonProblem(text);
    if (problem) {
      setError(problem);
      return null;
    }
    const parsed = JSON.parse(text);
    setSampleInput(parsed);
    setGenerating(true);
    try {
      const { ok, data } = await request("/api/generate-edge-cases", { method: "POST", body: { sample_input: parsed } });
      if (!ok) {
        setError(describeError(data, "Could not generate edge cases"));
        return null;
      }
      setCases(data.cases);
      setSelected(Object.fromEntries(data.cases.map((c) => [c.label, true])));
      setExpectOverrides({});
      // Custom cases were checked against the previous sample, so drop them.
      setCustomCases([]);
      return data.cases;
    } catch {
      setError(networkError());
      onNetworkError?.();
      return null;
    } finally {
      setGenerating(false);
    }
  }

  const expectOf = (c) => (c.isCustom ? c.expect : expectOverrides[c.label] || c.expect);

  function setExpect(c, next) {
    if (c.isCustom) {
      setCustomCases((prev) => prev.map((x) => (x.label === c.label ? { ...x, expect: next } : x)));
      return;
    }
    setExpectOverrides((prev) => {
      const copy = { ...prev };
      if (next === c.expect) delete copy[c.label];
      else copy[c.label] = next;
      return copy;
    });
  }

  const toggle = (label) => setSelected((prev) => ({ ...prev, [label]: !prev[label] }));
  function setMany(labels, value) {
    setSelected((prev) => {
      const next = { ...prev };
      labels.forEach((l) => (next[l] = value));
      return next;
    });
  }

  // Validates a custom case with the backend; returns {ok, text}.
  async function addCustom({ label, payloadText, expect }) {
    const name = label.trim();
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch (err) {
      return { ok: false, field: "payload", text: `The JSON body is not valid JSON: ${err.message}` };
    }
    if (allCases.some((c) => c.label === name)) {
      return { ok: false, field: "label", text: `There is already a case called '${name}'.` };
    }
    try {
      const { ok, data } = await request("/api/validate-custom-case", {
        method: "POST",
        body: { sample_input: sampleInput, label: name, payload },
      });
      if (!ok || !data?.valid) return { ok: false, field: "label", text: data?.reason || data?.error || "Not a valid case." };
      setCustomCases((prev) => [
        ...prev,
        { label: name, payload, description: data.description, classified_as: data.category, expect },
      ]);
      setSelected((prev) => ({ ...prev, [name]: true }));
      return { ok: true, text: `Added '${name}' (${data.category}): ${data.description}` };
    } catch {
      onNetworkError?.();
      return { ok: false, field: "label", text: networkError() };
    }
  }

  function removeCustom(label) {
    setCustomCases((prev) => prev.filter((c) => c.label !== label));
    setSelected((prev) => {
      const next = { ...prev };
      delete next[label];
      return next;
    });
  }

  // Edit and re-run: regenerate from the stored sample, then apply the
  // stored selection, expectations and custom cases.
  async function restore(config) {
    const text = JSON.stringify(config.sample ?? {}, null, 0);
    setSampleText(text);
    const generated = await generate(text);
    if (!generated) return;
    const chosen = new Set((config.cases || []).map((c) => c.label));
    const generatedLabels = new Set(generated.map((c) => c.label));
    const overrides = {};
    (config.cases || []).forEach((c) => {
      const g = generated.find((x) => x.label === c.label);
      if (g && c.expect && c.expect !== g.expect) overrides[c.label] = c.expect;
    });
    const customs = (config.cases || []).filter((c) => c.isCustom || !generatedLabels.has(c.label));
    setCustomCases(customs.map((c) => ({ label: c.label, payload: c.payload, description: c.description, expect: c.expect || "reject" })));
    setExpectOverrides(overrides);
    setSelected(Object.fromEntries([...generated.map((c) => [c.label, chosen.has(c.label)]), ...customs.map((c) => [c.label, true])]));
  }

  const selectedCases = allCases.filter((c) => selected[c.label]);

  return {
    sampleText, setSampleText, sampleProblem, sampleInput,
    cases, allCases, selected, selectedCases, toggle, setMany,
    expectOf, setExpect, expectOverrides,
    customCases, addCustom, removeCustom,
    generate, generating, error, setError, reset, restore,
  };
}
