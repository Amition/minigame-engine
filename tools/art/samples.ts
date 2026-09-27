// SVG snippets that exercise the renderer's feature subset (shown on the 'svg' contact sheet).
export const svgFeatureSamples: Record<string, string> = {
  'arcs+relative': `<svg viewBox="0 0 100 100">
  <path d="M50 50L50 8A42 42 0 0 1 86.4 71z" fill="#ff6b6b"/>
  <path d="M50 50l36.4 21a42 42 0 0 1-72.8 0z" fill="#4dabf7"/>
  <path d="M50 50L13.6 71A42 42 0 0 1 50 8z" fill="#ffd43b"/>
  <path d="m20 88c10-8 20 8 30 0s20 8 30 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
</svg>`,
  transforms: `<svg viewBox="0 0 100 100">
  <rect x="10" y="10" width="30" height="30" rx="6" fill="#8ce99a" transform="rotate(20 25 25)"/>
  <rect x="55" y="10" width="30" height="30" fill="#b197fc" transform="skewX(-20) translate(10 0)"/>
  <g transform="translate(25 70) scale(1.5)"><circle r="10" fill="#ffa94d"/></g>
  <rect width="20" height="20" fill="#66d9e8" transform="matrix(1 .3 -.3 1 62 58)"/>
</svg>`,
  gradients: `<svg viewBox="0 0 100 100">
  <defs>
    <linearGradient id="a"><stop offset="0" stop-color="#ff6b6b"/><stop offset="1" stop-color="#ffd43b"/></linearGradient>
    <linearGradient id="b" href="#a" gradientTransform="rotate(90)"/>
    <radialGradient id="c" fx="30%" fy="30%"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#4dabf7"/>
      <stop offset="1" stop-color="#1c4f9c"/></radialGradient>
    <linearGradient id="u" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
      <stop offset="0" stop-color="#8ce99a"/><stop offset="1" stop-color="#b197fc" stop-opacity=".3"/></linearGradient>
  </defs>
  <rect x="4" y="4" width="44" height="44" rx="8" fill="url(#a)"/>
  <rect x="52" y="4" width="44" height="44" rx="8" fill="url(#b)"/>
  <circle cx="26" cy="74" r="22" fill="url(#c)"/>
  <rect x="52" y="54" width="44" height="40" rx="8" fill="url(#u)" stroke="url(#a)" stroke-width="3"/>
</svg>`,
  strokes: `<svg viewBox="0 0 100 100" fill="none" stroke="#e6e9f2" stroke-width="7">
  <path d="M15 15h70" stroke-linecap="butt"/>
  <path d="M15 32h70" stroke-linecap="round" stroke="#ffd43b"/>
  <path d="M15 49h70" stroke-linecap="square" stroke="#ff6b6b" stroke-dasharray="10 16"/>
  <polyline points="12,90 30,62 48,90 66,62 84,90" stroke-linejoin="round" stroke="#4dabf7"/>
  <polyline points="12,78 30,66" stroke-width="3" stroke="#8ce99a" stroke-dasharray="2,3" stroke-linecap="round"/>
</svg>`,
  'use+symbol': `<svg viewBox="0 0 100 100">
  <defs>
    <symbol id="s" viewBox="0 0 10 10"><path d="M5 0L6.2 3.8 10 3.8 7 6.2 8 10 5 7.6 2 10 3 6.2 0 3.8 3.8 3.8z"/></symbol>
    <circle id="dot" r="6"/>
  </defs>
  <use href="#s" x="5" y="5" width="40" height="40" fill="#ffd43b"/>
  <use xlink:href="#s" x="55" y="5" width="40" height="40" fill="#ff6b6b" transform="rotate(10 75 25)"/>
  <use href="#dot" x="25" y="75" fill="#4dabf7"/><use href="#dot" x="50" y="75" fill="#8ce99a"/>
  <use href="#dot" x="75" y="75" fill="#b197fc"/>
</svg>`,
  'clip+evenodd': `<svg viewBox="0 0 100 100">
  <defs><clipPath id="c"><circle cx="30" cy="30" r="24"/></clipPath></defs>
  <g clip-path="url(#c)">
    <rect width="100" height="100" fill="#4dabf7"/>
    <path d="M0 30h60v8H0zM0 14h60v8H0z" fill="#fff"/>
  </g>
  <path fill-rule="evenodd" fill="#ffd43b" d="M70 8a22 22 0 1 0 0.01 0zM70 18a12 12 0 1 0 .01 0z"/>
  <path fill-rule="evenodd" fill="#ff6b6b" d="M50 58l9 28-24-17h30L41 86z"/>
</svg>`,
  'css+opacity': `<svg viewBox="0 0 100 100">
  <style>
    .card { fill: #2d3345; stroke: #8a90a2; stroke-width: 2 }
    rect.hot { fill: #ff6b6b } #cool { fill: #4dabf7 }
  </style>
  <rect class="card" x="5" y="5" width="90" height="90" rx="10"/>
  <rect class="hot" x="15" y="15" width="40" height="40" rx="6" opacity=".8"/>
  <rect id="cool" x="40" y="40" width="40" height="40" rx="6" style="fill-opacity:.6"/>
  <circle cx="70" cy="25" r="12" fill="#ffd43b" fill-opacity=".5" stroke="#ffd43b" stroke-width="3"/>
</svg>`,
  'text+shadow': `<svg viewBox="0 0 100 100">
  <defs><filter id="sh"><feDropShadow dx="0" dy="3" stdDeviation="2" flood-color="#000" flood-opacity=".5"/></filter></defs>
  <rect x="10" y="12" width="80" height="40" rx="12" fill="#3fbf6f" filter="url(#sh)"/>
  <text x="50" y="40" text-anchor="middle" font-size="20" font-weight="bold" fill="#fff">PLAY</text>
  <text x="50" y="82" text-anchor="middle" font-size="16" fill="#ffd43b" stroke="#7a4a00" stroke-width="3"
        paint-order="stroke">x1000</text>
</svg>`,
};
