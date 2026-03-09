# Circle of Fifths — Quadrant Zoom Handover

## Feature Request

When a MIDI note lights up a node on the outer ring, the viewport should smoothly zoom into the quadrant containing that node. This lets the user see the connected chords (adjacent fifths, relative minor, diminished) more clearly without squinting at the full circle.

## Current State

- 5 Remotion compositions at `MagicDAW-UI/src/compositions/CircleOfFifths{1-5}.tsx`
- All render at 1920×1080 in an SVG viewBox
- `playedIndices` (Set of fifths-circle indices 0-11) derived from `activeNotes` prop
- Only the **outer ring** (major keys) highlights played notes
- Center of the circle: `CX = 960, CY = 540` (or `W/2, H/2`)
- Outer ring radius: `OUTER_R = 320`
- Node positions computed via: `polarToXY(CX, CY, OUTER_R, nodeAngle(i))`
- `nodeAngle(i) = (i * 30 - 90) * (Math.PI / 180)` — i.e., index 0 (C) is at top (12 o'clock)

## Implementation Plan

### Approach: Animated SVG viewBox

The cleanest approach is to animate the `viewBox` attribute of the `<svg>` element. Instead of always showing `"0 0 1920 1080"`, zoom into a region centered on the played node's quadrant.

### Step-by-step

1. **Compute zoom target** from `playedIndices`:
   - If `playedIndices` is empty, target = full view: `{ x: 0, y: 0, w: 1920, h: 1080 }`
   - If one or more notes are played, find the centroid of their positions on the outer ring
   - Compute a zoom window centered on that centroid, sized ~900×500 (roughly 2× zoom)
   - Clamp the window to stay within 0-1920 / 0-1080

2. **Smooth transition** using Remotion's `spring()`:
   - Track `prevViewBox` and `targetViewBox` in the component
   - Use `interpolate()` with a spring-driven progress value (0→1) to lerp between them
   - Spring config: `{ damping: 18, stiffness: 60, mass: 0.8 }` for a smooth, organic zoom
   - When notes release (playedIndices becomes empty), spring back to the full view

3. **Apply to SVG**:
   ```tsx
   const viewBox = `${vx} ${vy} ${vw} ${vh}`;
   <svg width={W} height={H} viewBox={viewBox}>
   ```

### Key implementation details

```typescript
// In each composition component:

// 1. Compute zoom target based on played notes
const zoomTarget = useMemo(() => {
  if (playedIndices.size === 0) return { x: 0, y: 0, w: W, h: H };

  // Find centroid of played nodes
  let sumX = 0, sumY = 0, count = 0;
  playedIndices.forEach((idx) => {
    const [nx, ny] = polarToXY(CX, CY, OUTER_R, nodeAngle(idx));
    sumX += nx;
    sumY += ny;
    count++;
  });
  const cx = sumX / count;
  const cy = sumY / count;

  // Zoom window: ~50% of full viewport, centered on centroid
  const zw = W * 0.55;
  const zh = H * 0.55;
  return {
    x: Math.max(0, Math.min(W - zw, cx - zw / 2)),
    y: Math.max(0, Math.min(H - zh, cy - zh / 2)),
    w: zw,
    h: zh,
  };
}, [playedIndices]);

// 2. Track zoom state with spring animation
// Use a ref to track when the target changes, and a frame-based spring
const [zoomChangeFrame, setZoomChangeFrame] = useState(0);
// ... spring from zoomChangeFrame to current frame

// 3. Interpolate viewBox
const progress = spring({
  frame: frame - zoomChangeFrame,
  fps,
  config: { damping: 18, stiffness: 60, mass: 0.8 },
  durationInFrames: fps * 2,
});

const vx = interpolate(progress, [0, 1], [prevTarget.x, zoomTarget.x]);
const vy = interpolate(progress, [0, 1], [prevTarget.y, zoomTarget.y]);
const vw = interpolate(progress, [0, 1], [prevTarget.w, zoomTarget.w]);
const vh = interpolate(progress, [0, 1], [prevTarget.h, zoomTarget.h]);
```

### Considerations

- **Diatonic keyboard panel**: Currently at `x=1660`. When zoomed to a quadrant on the left side of the circle, the keyboard panel may be outside the viewBox. Options:
  - Move the panel position dynamically to always be in the visible area
  - OR keep it fixed and accept it's only visible when zoomed out or in the right quadrant
  - OR render it as an HTML overlay outside the SVG (won't scale with viewBox)

- **Chord progression trail**: Currently at the bottom. Same visibility concern when zoomed.

- **Multiple played notes**: If playing a chord (C+E+G), the centroid of those 3 positions determines the zoom center. The zoom window should be wide enough to contain all played nodes with some padding.

- **Zoom level**: Start with ~55% viewport (1.8× zoom). User may want this configurable later.

- **Performance**: `viewBox` animation is free — the browser handles the viewport transform natively. No additional SVG elements or filters needed.

- **Composition 5 (Gravity Well)**: The minimalist aesthetic might benefit from a tighter zoom (40% viewport = 2.5× zoom) since there are fewer visual elements.

### Files to modify

- `MagicDAW-UI/src/compositions/CircleOfFifths1.tsx` — primary composition, do this first
- `MagicDAW-UI/src/compositions/CircleOfFifths{2,3,4,5}.tsx` — same pattern, adapt per aesthetic
- Consider extracting the zoom logic into a shared hook in `MiniKeyboard.tsx` or a new `useCircleZoom.ts`

### Testing

- Play a single note on MIDI keyboard → circle should smoothly zoom to that node's quadrant
- Release the note → circle should smoothly zoom back to full view
- Play a chord → zoom should center on the centroid of the chord's nodes
- Rapid note changes → zoom should spring smoothly without jitter
- Verify the diatonic keyboard panel stays readable during zoom

## Current file structure

```
MagicDAW-UI/src/
├── components/
│   └── CircleOfFifthsPanel.tsx    — wrapper, subscribes to MIDI/chord/key events
├── compositions/
│   ├── CircleOfFifths1.tsx        — "Harmonic Gravity" (874 lines)
│   ├── CircleOfFifths2.tsx        — "Sacred Aurora" (981 lines)
│   ├── CircleOfFifths3.tsx        — "Orbital Mechanics" (829 lines)
│   ├── CircleOfFifths4.tsx        — "Crystalline Mandala" (1323 lines)
│   ├── CircleOfFifths5.tsx        — "Gravity Well" (526 lines)
│   └── MiniKeyboard.tsx           — shared mini keyboard + diatonic panel
└── bridge.ts                      — MIDI events: midi_note_on/off → activeNotes
```

## Recent fixes context

- **MIDIRouter was overwriting bridge's onNoteOn** — fixed so bridge owns callbacks, calls router explicitly
- **SVG blur filters reduced** from 10+ to 2-3 per composition for performance
- **Played notes only highlight outer ring** (not minor/diminished) — fixed this session
- **No throttle** on activeNotes — Remotion's 30fps frame rate is the only limiter
