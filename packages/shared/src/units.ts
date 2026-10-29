/** Temperature conversion helpers. Device values are stored in the unit the device reports. */
export function cToF(c: number): number {
  return Math.round(((c * 9) / 5 + 32) * 10) / 10;
}
export function fToC(f: number): number {
  return Math.round((((f - 32) * 5) / 9) * 10) / 10;
}
export function convertTemperature(value: number, from: 'C' | 'F', to: 'C' | 'F'): number {
  if (from === to) return value;
  return from === 'C' ? cToF(value) : fToC(value);
}
export function formatTemperature(value: number | undefined | null, unit: 'C' | 'F'): string {
  if (value === undefined || value === null || Number.isNaN(value)) return 'Not available';
  return `${(Math.round(value * 10) / 10).toFixed(1)}°${unit}`;
}
export function formatPower(w: number | null | undefined): string {
  if (w === null || w === undefined) return 'Not available';
  return w >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`;
}
export function formatEnergy(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined) return 'Not available';
  return `${kwh.toFixed(kwh >= 100 ? 0 : 2)} kWh`;
}
export const LOW_BATTERY_THRESHOLD = 20;
