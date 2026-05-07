/**
 * Parses durations used by env (`15m`, `7d`).
 * Falls back to 7 days of milliseconds when the pattern does not match.
 */
export function parseDurationToMs(spec: string): number {
  const s = spec.trim();
  const m = /^(\d+)(ms|[smhd])$/i.exec(s);
  if (!m) return 7 * 86_400_000;

  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  switch (unit) {
    case 'ms':
      return n;
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default:
      return 7 * 86_400_000;
  }
}
