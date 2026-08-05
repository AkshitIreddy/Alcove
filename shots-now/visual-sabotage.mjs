/**
 * A deterministic colour sequence whose first repeat is 256 ticks away.
 *
 * The visual suite advances it every 200ms and gives settling 30 seconds, so
 * no two distinct states inside one settle budget can have the same colour.
 * All multipliers are odd, hence each byte has the full 256-step period.
 */
export function sabotageColour(tick) {
  const n = ((Math.trunc(tick) % 256) + 256) % 256;
  return `rgb(${(n * 73) % 256} ${(n * 151) % 256} ${(n * 199) % 256})`;
}
