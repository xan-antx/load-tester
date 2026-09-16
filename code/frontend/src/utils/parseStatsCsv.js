export function parseStatsCsv(csvText) {
  if (!csvText) return [];
  const lines = csvText.trim().split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row = {};
    headers.forEach((h, i) => (row[h.trim()] = values[i]));
    return row;
  });
}