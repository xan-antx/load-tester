// Parses Locust's failures CSV (Method,Name,Error,Occurrences). Unlike the
// stats CSV, the Error column routinely contains commas and quotes, so this
// needs a real quote-aware parser instead of parseStatsCsv's split(",").
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseFailuresCsv(csvText) {
  if (!csvText) return [];
  const lines = csvText.trim().split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = values[i]));
    return row;
  });
}
