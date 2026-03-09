#!/usr/bin/env node
/**
 * render-icon.mjs — Generate AppIcon.icns from a pure SVG string.
 *
 * Ports the visual elements from AppIcon.tsx into a standalone SVG,
 * rasterises via sharp, and packages with iconutil.
 */

import sharp from 'sharp';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const OUT_DIR = join(ROOT, 'Resources');
const ICONSET = join(OUT_DIR, 'AppIcon.iconset');
const ICNS = join(OUT_DIR, 'AppIcon.icns');

// ---------------------------------------------------------------------------
// Aurora palette
// ---------------------------------------------------------------------------
const aurora = {
  teal: '#2dd4bf',
  green: '#34d399',
  cyan: '#67e8f9',
  purple: '#a78bfa',
  pink: '#f472b6',
  gold: '#fbbf24',
  navy: '#0a0e1a',
  deepNavy: '#060a14',
};

// ---------------------------------------------------------------------------
// Sparkles & constellation
// ---------------------------------------------------------------------------
const sparkles = [
  { x: 280, y: 220, r: 3.5, o: 0.9 },
  { x: 740, y: 260, r: 2.5, o: 0.7 },
  { x: 350, y: 720, r: 2.0, o: 0.6 },
  { x: 680, y: 180, r: 3.0, o: 0.8 },
  { x: 200, y: 480, r: 2.5, o: 0.5 },
  { x: 820, y: 540, r: 2.0, o: 0.7 },
  { x: 450, y: 160, r: 1.5, o: 0.6 },
  { x: 600, y: 830, r: 2.5, o: 0.65 },
  { x: 160, y: 350, r: 1.8, o: 0.55 },
  { x: 860, y: 680, r: 2.2, o: 0.6 },
  { x: 510, y: 280, r: 1.5, o: 0.5 },
  { x: 390, y: 580, r: 1.2, o: 0.45 },
];

const constellationLines = [
  [0, 3], [3, 6], [6, 10], [1, 5], [4, 8], [7, 9],
];

// ---------------------------------------------------------------------------
// Waveform path generator (identical to AppIcon.tsx)
// ---------------------------------------------------------------------------
function generateWaveformPath(cx, cy, width, amplitude, segments, phase) {
  const startX = cx - width / 2;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = startX + t * width;
    const y =
      cy +
      Math.sin(t * Math.PI * 4 + phase) * amplitude * 0.6 *
        Math.exp(-Math.pow((t - 0.5) * 3, 2)) +
      Math.sin(t * Math.PI * 8 + phase * 1.5) * amplitude * 0.25 *
        Math.exp(-Math.pow((t - 0.5) * 2.5, 2)) +
      Math.sin(t * Math.PI * 2 + phase * 0.7) * amplitude * 0.15;
    points.push(i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`);
  }
  return points.join(' ');
}

// ---------------------------------------------------------------------------
// Stylised "M" path (identical to AppIcon.tsx)
// ---------------------------------------------------------------------------
function generateMPath(cx, cy, size) {
  const half = size * 0.6;
  const peakH = size * 0.52;
  const valley = size * 0.03;
  return [
    `M ${cx - half} ${cy + half * 0.35}`,
    `L ${cx - half * 0.5} ${cy - peakH}`,
    `L ${cx} ${cy + valley}`,
    `L ${cx + half * 0.5} ${cy - peakH}`,
    `L ${cx + half} ${cy + half * 0.35}`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Build SVG string
// ---------------------------------------------------------------------------
function buildSVG() {
  const S = 1024;
  const cx = S / 2;
  const cy = S / 2;
  const waveLines = 5;
  const waveAmplitude = 110;
  const waveWidth = 520;

  // --- Constellation lines ---
  const constellationSVG = constellationLines.map(([a, b]) =>
    `<line x1="${sparkles[a].x}" y1="${sparkles[a].y}" x2="${sparkles[b].x}" y2="${sparkles[b].y}" stroke="${aurora.cyan}" stroke-width="0.8" opacity="0.4"/>`
  ).join('\n          ');

  // --- Sparkle stars ---
  const sparklesSVG = sparkles.map(s => {
    let g = `<g filter="url(#sparkle-glow)">
            <circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="white" opacity="${s.o}"/>`;
    if (s.r > 2) {
      g += `
            <line x1="${s.x - s.r * 3}" y1="${s.y}" x2="${s.x + s.r * 3}" y2="${s.y}" stroke="white" stroke-width="0.6" opacity="${s.o * 0.5}"/>
            <line x1="${s.x}" y1="${s.y - s.r * 3}" x2="${s.x}" y2="${s.y + s.r * 3}" stroke="white" stroke-width="0.6" opacity="${s.o * 0.5}"/>`;
    }
    g += '\n          </g>';
    return g;
  }).join('\n          ');

  // --- Waveform lines ---
  const wavesSVG = Array.from({ length: waveLines }, (_, i) => {
    const offset = (i - Math.floor(waveLines / 2)) * 28;
    const phase = i * 0.8;
    const opacity = 1 - Math.abs(i - Math.floor(waveLines / 2)) * 0.18;
    const sw = 3 - Math.abs(i - Math.floor(waveLines / 2)) * 0.3;
    const d = generateWaveformPath(cx, cy + offset, waveWidth, waveAmplitude - Math.abs(offset) * 0.3, 200, phase);
    return `<path d="${d}" fill="none" stroke="url(#wave-grad)" stroke-width="${sw}" stroke-linecap="round" opacity="${opacity}" filter="url(#glow)"/>`;
  }).join('\n          ');

  // --- M path ---
  const mPath = generateMPath(cx, cy - 10, 200);

  return `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background aurora radial -->
    <radialGradient id="bg-glow" cx="50%" cy="45%" r="72%">
      <stop offset="0%" stop-color="#0f1a2e"/>
      <stop offset="50%" stop-color="#0a0e1a"/>
      <stop offset="100%" stop-color="#040810"/>
    </radialGradient>

    <!-- Aurora sweep gradient -->
    <linearGradient id="aurora-sweep" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${aurora.teal}"/>
      <stop offset="30%" stop-color="${aurora.cyan}"/>
      <stop offset="60%" stop-color="${aurora.purple}"/>
      <stop offset="100%" stop-color="${aurora.pink}"/>
    </linearGradient>

    <!-- Waveform glow gradient -->
    <linearGradient id="wave-grad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${aurora.teal}" stop-opacity="0.3"/>
      <stop offset="25%" stop-color="${aurora.cyan}"/>
      <stop offset="50%" stop-color="${aurora.purple}"/>
      <stop offset="75%" stop-color="${aurora.pink}"/>
      <stop offset="100%" stop-color="${aurora.teal}" stop-opacity="0.3"/>
    </linearGradient>

    <!-- M letter gradient -->
    <linearGradient id="m-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${aurora.cyan}"/>
      <stop offset="100%" stop-color="${aurora.purple}"/>
    </linearGradient>

    <!-- Frosted glass inner circle -->
    <radialGradient id="frost" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="white" stop-opacity="0.08"/>
      <stop offset="70%" stop-color="white" stop-opacity="0.02"/>
      <stop offset="100%" stop-color="white" stop-opacity="0"/>
    </radialGradient>

    <!-- Outer glow filter -->
    <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="25"/>
    </filter>

    <filter id="sparkle-glow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>

    <!-- Clip to circle for internal elements -->
    <clipPath id="circle-clip">
      <circle cx="${cx}" cy="${cy}" r="480"/>
    </clipPath>
  </defs>

  <!-- ===== Background — full bleed, no transparent corners ===== -->
  <rect x="0" y="0" width="${S}" height="${S}" fill="url(#bg-glow)"/>

  <!-- Aurora atmosphere -->
  <ellipse cx="${cx}" cy="${cy - 60}" rx="350" ry="200" fill="url(#aurora-sweep)" opacity="0.12" filter="url(#soft-glow)" clip-path="url(#circle-clip)"/>

  <!-- Second aurora wash -->
  <ellipse cx="${cx + 80}" cy="${cy + 100}" rx="280" ry="160" fill="${aurora.purple}" opacity="0.08" filter="url(#soft-glow)" clip-path="url(#circle-clip)"/>

  <!-- ===== Constellation lines ===== -->
  <g clip-path="url(#circle-clip)" opacity="0.25">
    ${constellationSVG}
  </g>

  <!-- ===== Sparkle stars ===== -->
  <g clip-path="url(#circle-clip)">
    ${sparklesSVG}
  </g>

  <!-- ===== Waveform lines ===== -->
  <g clip-path="url(#circle-clip)">
    ${wavesSVG}
  </g>

  <!-- ===== Stylised "M" mark ===== -->
  <path d="${mPath}" fill="none" stroke="url(#m-grad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" filter="url(#glow)"/>

  <!-- ===== Frosted glass inner ring ===== -->
  <circle cx="${cx}" cy="${cy}" r="420" fill="url(#frost)" clip-path="url(#circle-clip)"/>

  <!-- ===== Neon edge ring ===== -->
  <circle cx="${cx}" cy="${cy}" r="478" fill="none" stroke="url(#aurora-sweep)" stroke-width="2.5" opacity="0.7"/>

  <!-- Outer glow ring -->
  <circle cx="${cx}" cy="${cy}" r="478" fill="none" stroke="url(#aurora-sweep)" stroke-width="8" opacity="0.15" filter="url(#soft-glow)"/>

  <!-- Inner subtle ring -->
  <circle cx="${cx}" cy="${cy}" r="440" fill="none" stroke="white" stroke-width="0.5" opacity="0.08"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// iconutil size spec:  name -> pixels
// ---------------------------------------------------------------------------
const ICON_SIZES = [
  { name: 'icon_16x16.png',        size: 16 },
  { name: 'icon_16x16@2x.png',     size: 32 },
  { name: 'icon_32x32.png',        size: 32 },
  { name: 'icon_32x32@2x.png',     size: 64 },
  { name: 'icon_128x128.png',      size: 128 },
  { name: 'icon_128x128@2x.png',   size: 256 },
  { name: 'icon_256x256.png',      size: 256 },
  { name: 'icon_256x256@2x.png',   size: 512 },
  { name: 'icon_512x512.png',      size: 512 },
  { name: 'icon_512x512@2x.png',   size: 1024 },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('Building SVG...');
  const svg = buildSVG();

  // Ensure output dirs exist
  mkdirSync(OUT_DIR, { recursive: true });

  // Clean previous iconset
  rmSync(ICONSET, { recursive: true, force: true });
  mkdirSync(ICONSET, { recursive: true });

  // Render 1024px master PNG from SVG buffer
  console.log('Rasterising 1024px master PNG...');
  const svgBuffer = Buffer.from(svg);
  const masterPng = await sharp(svgBuffer, { density: 144 })
    .resize(1024, 1024)
    .png()
    .toBuffer();

  // Generate all icon sizes
  for (const { name, size } of ICON_SIZES) {
    const outPath = join(ICONSET, name);
    console.log(`  ${name}  (${size}x${size})`);
    await sharp(masterPng)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(outPath);
  }

  // Also write the master 1024 for reference
  writeFileSync(join(OUT_DIR, 'AppIcon-1024.png'), masterPng);
  console.log('Wrote AppIcon-1024.png');

  // Run iconutil
  console.log('Running iconutil...');
  execSync(`iconutil -c icns "${ICONSET}" -o "${ICNS}"`, { stdio: 'inherit' });

  // Clean up iconset dir
  rmSync(ICONSET, { recursive: true, force: true });

  console.log(`\nDone! Icon written to ${ICNS}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
