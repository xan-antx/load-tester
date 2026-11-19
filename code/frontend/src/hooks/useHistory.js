import { useCallback, useEffect, useState } from "react";
import { request, networkError } from "../api";

// The run list, and Compare: 2 to 4 runs, one of them the reference that
// the others are compared against (the first one picked, until changed).
export default function useHistory() {
  const [jobs, setJobs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [comparing, setComparing] = useState(false);
  const [compareError, setCompareError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const { ok, data } = await request("/api/jobs");
      if (!ok) throw new Error("bad status");
      const list = [
        ...(data.jobs || []).map((j) => ({ ...j, id: j.job_id, isGroup: false })),
        ...(data.job_groups || []).map((g) => ({ ...g, id: g.group_id, isGroup: true })),
      ].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setJobs(list);
      setLoadError(null);
    } catch {
      setLoadError(networkError());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Loading the list on mount is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  function toggleCompare(id) {
    // A comparison of a different selection is stale: drop it.
    setCompareResult(null);
    setCompareError(null);
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev));
  }
  // Moves a picked run to the front: the reference run.
  function setReference(id) {
    setCompareIds((prev) => (prev.includes(id) ? [id, ...prev.filter((x) => x !== id)] : prev));
    setCompareResult(null);
  }
  function clearCompare() {
    setCompareIds([]);
    setCompareResult(null);
    setCompareError(null);
  }

  async function compare() {
    setCompareError(null);
    if (compareIds.length < 2 || compareIds.length > 4) {
      setCompareError("Pick 2 to 4 runs to compare.");
      return;
    }
    setComparing(true);
    try {
      const { ok, data } = await request("/api/compare-jobs", { method: "POST", body: { job_ids: compareIds } });
      if (!ok) {
        setCompareError(data?.error || "Could not compare those runs.");
        return;
      }
      setCompareResult(data);
    } catch {
      setCompareError(networkError());
    } finally {
      setComparing(false);
    }
  }

  return {
    jobs, loaded, loadError, refresh,
    compareIds, toggleCompare, setReference, clearCompare, compare, compareResult, comparing, compareError,
  };
}
