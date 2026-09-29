// High / Medium / Auto-rejected, from the applied-role match % and the risk score.
// Thresholds are env-tunable; defaults mirror the reference dashboard.
export function tierOf(match, risk) {
  const high = Number(process.env.HIGH_MATCH || 80);
  const medium = Number(process.env.MEDIUM_MATCH || 70);
  const maxRisk = Number(process.env.MAX_RISK || 30);
  if (risk > maxRisk) return "rejected";
  if (match >= high) return "high";
  if (match >= medium) return "medium";
  return "rejected";
}

// Which list a candidate is on, after the founder's decision (null | reconsidered | passed).
//   shortlist: high potential, plus medium/rejected ones he reconsidered
//   medium:    medium potential he hasn't decided on yet (the review queue)
//   rejection: auto-rejected, plus anyone he passed on
export function listOf(tier, decision) {
  if (decision === "passed") return "rejection";
  if (decision === "reconsidered" || tier === "high") return "shortlist";
  if (tier === "medium") return "medium";
  return "rejection";
}
