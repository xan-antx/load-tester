import { useCallback, useEffect, useState } from "react";

// A tiny hash router: #/new, #/run, #/history. Back and Forward work, a
// reload keeps the view, and there is no dependency.
const VIEWS = ["new", "run", "history"];

function fromHash() {
  const id = window.location.hash.replace(/^#\/?/, "").split("/")[0];
  return VIEWS.includes(id) ? id : "new";
}

export default function useView() {
  const [view, setView] = useState(fromHash);

  useEffect(() => {
    const onHash = () => setView(fromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((id) => {
    if (!VIEWS.includes(id)) return;
    if (fromHash() !== id) window.location.hash = `#/${id}`;
    setView(id);
    window.scrollTo({ top: 0 });
  }, []);

  return [view, navigate];
}
