# Circle of Fifths — Marquee Feature Handover

## Direction

User reviewed 10 visual mockups. Two winners:
- **Gravitational Field** (cof-7): Physics sim, accretion disks, orbital transfers, harmonic gravity
- **Sacred Geometry** (cof-3): Golden ratio spirals, dodecagons, mandala, flower of life

Final implementation: **Remotion compositions** — 5 variations blending these two aesthetics, rendered at 30fps via `<Player>`. This is the hero visual of the entire app. Multiple refinement passes.

## Aesthetic DNA

### From Gravitational Field
- Nodes as mass points with gravitational pull
- Accretion disk particle orbits around active key
- Field lines showing harmonic "force" between keys
- Active key as gravitational attractor — nearby nodes pulled inward
- Hohmann transfer arc pathfinder trajectories
- Harmonic distance / gravity metrics
- Canvas particle systems for field visualization

### From Sacred Geometry
- Dodecagonal construction with visible geometric scaffolding
- Golden ratio spirals connecting related keys
- Hexagram (Star of David) patterns for minor keys
- Flower of life segments as connection patterns
- Mandala rotation in background
- Gold / cream / deep purple palette on dark
- Ancient/timeless aesthetic — mathematical beauty

### Aurora Glass (Magic DAW brand)
- Deep navy base (#080e18)
- Frosted glass panels with backdrop-filter blur
- Cyan / teal / purple / pink neon accents
- Constellation star backgrounds
- Spring physics on all transitions

## Core Features (All 5 Compositions)

### Data Layer
```typescript
interface CircleOfFifthsProps {
  activeKey: string;                    // e.g. "C", "F#", "Bb"
  activeMode: 'major' | 'minor';
  detectedChord: string | null;         // e.g. "Am7"
  activeNotes: number[];                // MIDI pitches currently held
  chordProgression: string[];           // recent chord history
  pathfinderFrom: string | null;
  pathfinderTo: string | null;
  pathfinderPaths: string[][];          // array of paths, each an array of key names
  highlightedDegrees: number[];         // scale degrees to highlight (1-7)
}
```

### Three Rings
- **Outer ring** (12 nodes): Major keys — C, G, D, A, E, B/Cb, F#/Gb, Db/C#, Ab, Eb, Bb, F
- **Middle ring** (12 nodes): Relative minor keys — Am, Em, Bm, F#m, C#m, G#m, Ebm, Bbm, Fm, Cm, Gm, Dm
- **Inner ring** (12 nodes): Diminished chords — Bdim, F#dim, C#dim, G#dim, D#dim, A#dim, Edim, etc.

### Interactive Behaviors
1. **Active key**: Dramatic highlight with spring animation, connected keys illuminate
2. **Hover**: Show diatonic chords (I-ii-iii-IV-V-vi-vii°) as satellite nodes
3. **Click**: Select key, zoom/rotate toward it
4. **Pathfinder**: Highlight all routes between two keys with distinct visual per path
5. **Live MIDI**: Notes map to keys on the wheel, glow intensity = velocity

### Connections
- **Fifths**: Adjacent keys on the outer ring (C→G, G→D, etc.)
- **Relative major/minor**: Outer to middle ring (C→Am, G→Em)
- **Parallel keys**: Same root, different mode (C major → C minor)
- **Tritone substitutions**: Opposite side of the wheel
- **Secondary dominants**: V/V, V/vi, etc.

### Scale Degree Legend
- Major key: I-ii-iii-IV-V-vi-vii°
- Minor key: i-ii°-III-iv-v-VI-VII

## 5 Compositions to Build

### 1. "Harmonic Gravity" (Primary — gravitational field + aurora)
The main composition, most polished. Physics-meets-aurora.
- Gravitational field heatmap as background (warm near active, cool far)
- Major keys: massive aurora-glowing bodies with particle accretion disks
- Minor keys: medium bodies with orbital rings
- Diminished: small dim particles
- Active key = gravitational attractor pulling nearby nodes via spring physics
- Connections as field lines with thickness proportional to harmonic strength
- Pathfinder: Hohmann transfer arcs with aurora-gradient particle streams
- Sacred geometry construction lines visible as faint golden scaffolding underneath
- Diatonic chords orbit the active key with correct gravitational spacing
- Background: deep navy + constellation stars + subtle golden ratio spiral overlay

### 2. "Sacred Aurora" (Sacred geometry + aurora glass)
Mathematical beauty with aurora treatment.
- Full dodecagonal construction with visible compass-and-straightedge lines in gold
- Major keys at dodecagon vertices, connected by golden spirals
- Minor keys form hexagram pattern
- Flower of life segments connect related keys
- Active key illuminates surrounding geometry — triangles, pentagons light up
- Aurora gradient fills inside geometric shapes
- Frosted glass node circles with aurora borders
- Slowly rotating mandala in the background
- Pathfinder traces along geometric construction lines
- Everything rendered with aurora color palette (cyan, teal, purple on gold scaffolding)

### 3. "Orbital Mechanics" (Deep gravitational simulation)
Most "scientific" — pure physics aesthetic.
- Black background with field strength contour lines (like a topographic map of gravity)
- Keys shown with mass indicators and accretion particle systems
- Connections shown as Lagrange point bridges between bodies
- Active key causes visible space-time warping (subtle fisheye distortion on nearby elements)
- Pathfinder shows actual orbital transfer windows with delta-V annotations
- Data readouts: harmonic distance, fifths distance, gravity %, tension index
- Monospace font, minimal color — let the physics visualization do the talking
- Real n-body simulation feel — particles obey inverse-square attraction

### 4. "Crystalline Mandala" (Sacred geometry, maximalist)
Most ornate and detailed. Stained glass cathedral meets mandala.
- Dense geometric pattern filling the entire viewport
- Multiple overlapping geometric constructions: dodecagon + hexagram + pentagon + golden spirals + flower of life
- Every construction line visible and animated (slow rotation at different speeds per layer)
- Color: rich golds, deep purples, emerald greens, ruby reds on dark background
- Active key causes a ripple through the geometry — shapes illuminate outward in concentric waves
- Connections are woven into the geometric fabric (not separate lines — part of the mandala itself)
- Pathfinder: the path literally illuminates through the mandala structure
- Most decorative, most "art piece" — could hang on a wall

### 5. "Gravity Well" (Minimalist gravitational, high contrast)
Stripped down, high contrast, maximum impact.
- Pure black void
- Only the active key and its immediate connections visible at full brightness
- Everything else exists but is barely visible (5% opacity)
- Active key: single bright point with dramatic radial glow
- Connections: thin bright lines that fade with distance
- When you hover a distant key, a "gravity beam" reaches from active to hovered, illuminating everything along the path
- Pathfinder: dramatic — a laser-bright path cutting through the darkness
- Minimal UI, maximum drama — the darkness IS the design
- Single accent color (pure white or ice blue) on black

## Technical Implementation

- Each composition: `src/compositions/CircleOfFifths{N}.tsx`
- Wrapper panel: `src/components/CircleOfFifthsPanel.tsx` — subscribes to bridge events, passes live data
- View tab: "Circle" or replace "Visualizer" tab
- All use `useCurrentFrame()` for continuous animation, `spring()` for transitions, `interpolate()` for mapping
- Target: 30fps, 1920x1080, looping

## Review Process

User will review all 5 compositions side-by-side. The winner gets multiple refinement passes to become the final marquee feature. May combine elements from multiple compositions.

## Files
- Mockups reviewed: `claude-manager/mockups/cof-{1..10}-*.html`
- Winning mockups: cof-3 (Sacred Geometry), cof-7 (Gravitational Field)
- Feature ideas: `magic-daw/feature_ideas.md` (top priority item)
