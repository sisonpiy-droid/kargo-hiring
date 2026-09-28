// Parses rubric.txt into [{ role, position, name, description, weight }].
// Throws if the file doesn't have 4-6 criteria per role summing to 100%.

const SECTIONS = [
  { role: "PM", header: "PRODUCT MANAGER (PM)" },
  { role: "SPM", header: "SENIOR PRODUCT MANAGER (SPM)" },
];

const CRITERION =
  /Criterion\s+(\d+):\s*(.+?)\s*\n\s*What a strong candidate looks like:\s*\n([\s\S]+?)\n\s*Weight:\s*(\d+)\s*%/g;

export function parseRubric(text) {
  text = text.replace(/\r\n/g, "\n");
  const rows = [];

  for (const { role, header } of SECTIONS) {
    const start = text.indexOf(header);
    if (start === -1) throw new Error(`rubric.txt: missing section "${header}"`);
    // A section runs until the next "====" banner that follows its own banner.
    const rest = text.slice(start + header.length);
    const end = rest.search(/\n=+\n[A-Z ()]+\n=+/);
    const body = end === -1 ? rest : rest.slice(0, end);

    const criteria = [...body.matchAll(CRITERION)].map((m) => ({
      role,
      position: Number(m[1]),
      name: m[2].trim(),
      description: m[3].replace(/\s+/g, " ").trim(),
      weight: Number(m[4]),
    }));

    const total = criteria.reduce((sum, c) => sum + c.weight, 0);
    if (criteria.length < 4 || criteria.length > 6)
      throw new Error(`rubric.txt: ${role} has ${criteria.length} criteria, expected 4-6`);
    if (total !== 100) throw new Error(`rubric.txt: ${role} weights sum to ${total}%, expected 100%`);
    rows.push(...criteria);
  }
  return rows;
}
