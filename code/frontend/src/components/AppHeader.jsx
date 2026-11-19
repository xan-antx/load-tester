import Icon from "./Icon";

// Product name, the view navigation, the running-test pill, and a backend
// connection light: quiet when connected, a full-width banner when offline.
// views: [{ id, label, badge? }] (optional); runPill: a node (optional).
export default function AppHeader({ apiBase, health, onRecheck, views, view, onNavigate, runPill }) {
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <span className="brand-name">Elevate Load Tester</span>
          <span className="brand-tagline">Finds the inputs your API mishandles, and the load at which it starts to fail.</span>
        </div>
        {views && (
          <nav aria-label="Views" className="view-nav">
            {views.map((v) => (
              <a
                key={v.id}
                href={`#/${v.id}`}
                aria-current={view === v.id ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate(v.id);
                }}
              >
                {v.label}
                {v.badge != null && <span className="nav-badge">{v.badge}</span>}
              </a>
            ))}
          </nav>
        )}
        <div className="header-right">
          {runPill}
          {health !== "offline" && (
            <span
              role="status"
              aria-live="polite"
              className="health"
              title={`${apiBase}/api/health, checked every 15 s`}
            >
              <span className={`health-dot is-${health}`} aria-hidden="true" />
              {health === "online" ? "Connected" : "Checking backend…"}
            </span>
          )}
        </div>
      </header>
      {health === "offline" && (
        <div role="alert" className="offline-banner">
          <Icon name="alert" size={20} />
          <div>
            <strong>The backend is not answering.</strong> Nothing can be analyzed or run until it is back.
            The app expects it at <span className="mono">{apiBase}</span>.
          </div>
          <button type="button" className="btn btn-secondary btn-small" onClick={onRecheck}>
            Try again
          </button>
        </div>
      )}
    </>
  );
}
