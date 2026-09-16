export default function LoadTestConfig({
  users,
  spawnRate,
  duration,
  onUsersChange,
  onSpawnRateChange,
  onDurationChange,
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 12, marginBottom: 8 }}>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>Users (1-1000)</label>
        <input
          type="number"
          min={1}
          max={1000}
          value={users}
          onChange={(e) => onUsersChange(clamp(Number(e.target.value), 1, 1000))}
          style={inputStyle}
        />
      </div>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>Spawn Rate (1-20)</label>
        <input
          type="number"
          min={1}
          max={20}
          value={spawnRate}
          onChange={(e) => onSpawnRateChange(clamp(Number(e.target.value), 1, 20))}
          style={inputStyle}
        />
      </div>
      <div style={{ flex: 1 }}>
        <label style={labelStyle}>Duration in seconds (1-300)</label>
        <input
          type="number"
          min={1}
          max={300}
          value={duration}
          onChange={(e) => onDurationChange(clamp(Number(e.target.value), 1, 300))}
          style={inputStyle}
        />
      </div>
    </div>
  );
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

const labelStyle = {
  display: "block",
  fontSize: 12,
  color: "#666",
  marginBottom: 4,
};

const inputStyle = {
  width: "100%",
  padding: 6,
  boxSizing: "border-box",
};