/**
 * Generates the demonstration camera image. It is deliberately an illustration,
 * not a photo, and carries a permanent "DEMONSTRATION IMAGE" banner so it can
 * never be mistaken for a live feed.
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderDemoCameraSvg(name: string, externalId: string, at: Date): string {
  const seed = [...externalId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const outdoor = externalId.includes('garden') || externalId.includes('doorbell');
  const sky = outdoor ? '#CFE0D3' : '#E9E4D8';
  const ground = outdoor ? '#7FA27F' : '#CBBFA8';
  const t = at.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const sway = (at.getSeconds() % 10) - 5;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="img" aria-label="Demonstration image for ${esc(name)}">
  <rect width="640" height="360" fill="${sky}"/>
  <rect y="230" width="640" height="130" fill="${ground}"/>
  ${outdoor
    ? `<circle cx="${520 + (seed % 40)}" cy="70" r="28" fill="#F2C46B" opacity="0.85"/>
       <rect x="80" y="120" width="180" height="110" rx="6" fill="#E4EBDD" stroke="#274C35" stroke-width="3"/>
       <polygon points="70,125 170,60 270,125" fill="#C96F52"/>
       <rect x="150" y="165" width="34" height="65" fill="#386641"/>
       <g transform="translate(${sway},0)"><rect x="430" y="150" width="14" height="80" fill="#6B4F3A"/><circle cx="437" cy="135" r="42" fill="#386641"/></g>`
    : `<rect x="60" y="80" width="150" height="110" rx="4" fill="#F7F6F0" stroke="#737971" stroke-width="3"/>
       <line x1="135" y1="80" x2="135" y2="190" stroke="#737971" stroke-width="3"/>
       <rect x="300" y="170" width="240" height="70" rx="12" fill="#386641"/>
       <rect x="290" y="150" width="60" height="90" rx="10" fill="#274C35"/>
       <rect x="${470 + sway}" y="120" width="40" height="60" rx="6" fill="#F28C28" opacity="0.8"/>`}
  <rect x="0" y="0" width="640" height="40" fill="#252A27" opacity="0.78"/>
  <text x="16" y="26" font-family="Arial, sans-serif" font-size="16" font-weight="700" fill="#FFFFFF">DEMONSTRATION IMAGE — not a live camera feed</text>
  <rect x="0" y="322" width="640" height="38" fill="#252A27" opacity="0.6"/>
  <text x="16" y="346" font-family="Arial, sans-serif" font-size="14" fill="#FFFFFF">${esc(name)}</text>
  <text x="624" y="346" font-family="monospace" font-size="13" fill="#FFFFFF" text-anchor="end">${esc(t)}</text>
</svg>`;
}
