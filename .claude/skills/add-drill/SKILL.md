---
name: add-drill
description: Add a new practice drill to the Magic DAW Learn tab. Use when the user wants to add scales, chords, intervals, modes, or any other music theory drill.
argument-hint: <description of the drill to add>
---

# Add Practice Drill

Add a new drill to the Magic DAW practice drill system. The user's request: $ARGUMENTS

## How the drill system works

All drills are defined as DATA in the `DRILL_DEFS` array in:
```
MagicDAW-UI/src/components/IntervalTrainerPanel.tsx
```

The drill player is generic — it reads the definition and renders accordingly. **Adding a new drill is just adding an entry to `DRILL_DEFS`.**

## DrillDef interface

```typescript
interface DrillDef {
  id: DrillCategory;      // unique string identifier
  label: string;          // display name, e.g. "Dorian Mode"
  shortLabel: string;     // 3-4 char abbreviation for pill button, e.g. "DOR"
  color: string;          // hex color from aurora palette
  semitones: number[];    // intervals from root as semitones, e.g. [0, 2, 3, 5, 7, 9, 10]
  type: 'scale' | 'chord' | 'intervals';  // determines playback & visualization
  degreeLabels: string[]; // labels shown on keyboard, e.g. ['1','2','b3','4','5','6','b7']
}
```

- `type: 'scale'` — notes play sequentially (ascending), shown on 2-octave keyboard
- `type: 'chord'` — notes play simultaneously, shown on 2-octave keyboard
- `type: 'intervals'` — special mode using the original interval trainer (only used by the existing Intervals drill)

## Step-by-step: Adding a drill

### 1. Add the ID to DrillCategory type

Find the `DrillCategory` type union near the top of `IntervalTrainerPanel.tsx` and add your new ID:

```typescript
type DrillCategory =
  | 'intervals'
  | 'pentatonic-major'
  // ... existing entries ...
  | 'your-new-drill';    // ADD THIS
```

### 2. Add the DrillDef entry to DRILL_DEFS array

Add a new object to the `DRILL_DEFS` array:

```typescript
{
  id: 'your-new-drill',
  label: 'Your Drill Name',
  shortLabel: 'YDN',
  color: '#67e8f9',           // pick from aurora palette below
  semitones: [0, 2, 4, 7],   // the intervals that define this scale/chord
  type: 'scale',              // or 'chord'
  degreeLabels: ['1', '2', '3', '5'],  // must match semitones length
},
```

### 3. That's it!

The drill system automatically:
- Adds a pill button for the new drill in the selector bar
- Generates all 12 keys (C through B) from your semitone pattern
- Handles play/next/previous/auto-advance
- Tracks daily progress in localStorage
- Renders the keyboard visualization with highlighted notes and degree labels

## Aurora color palette (pick one per drill)

```
cyan:   '#67e8f9'  — used by Intervals
teal:   '#2dd4bf'  — used by Pentatonic scales
gold:   '#fbbf24'  — used by Major Scale
purple: '#a78bfa'  — used by Minor Scale
green:  '#34d399'  — used by Major Chords
pink:   '#f472b6'  — used by Minor Chords
orange: '#fb923c'  — used by Diminished Chords
```

For new drills, reuse colors by category or pick variations. Scales in warm tones, chords in cool tones works well.

## Common music theory reference

### Scales (type: 'scale')
| Name | Semitones | Degree Labels |
|------|-----------|---------------|
| Major | [0,2,4,5,7,9,11] | 1,2,3,4,5,6,7 |
| Natural Minor | [0,2,3,5,7,8,10] | 1,2,b3,4,5,b6,b7 |
| Harmonic Minor | [0,2,3,5,7,8,11] | 1,2,b3,4,5,b6,7 |
| Melodic Minor | [0,2,3,5,7,9,11] | 1,2,b3,4,5,6,7 |
| Dorian | [0,2,3,5,7,9,10] | 1,2,b3,4,5,6,b7 |
| Mixolydian | [0,2,4,5,7,9,10] | 1,2,3,4,5,6,b7 |
| Lydian | [0,2,4,6,7,9,11] | 1,2,3,#4,5,6,7 |
| Phrygian | [0,1,3,5,7,8,10] | 1,b2,b3,4,5,b6,b7 |
| Locrian | [0,1,3,5,6,8,10] | 1,b2,b3,4,b5,b6,b7 |
| Whole Tone | [0,2,4,6,8,10] | 1,2,3,#4,#5,b7 |
| Blues | [0,3,5,6,7,10] | 1,b3,4,b5,5,b7 |
| Major Pentatonic | [0,2,4,7,9] | 1,2,3,5,6 |
| Minor Pentatonic | [0,3,5,7,10] | 1,b3,4,5,b7 |
| Bebop Dominant | [0,2,4,5,7,9,10,11] | 1,2,3,4,5,6,b7,7 |

### Chords (type: 'chord')
| Name | Semitones | Degree Labels |
|------|-----------|---------------|
| Major | [0,4,7] | R,3,5 |
| Minor | [0,3,7] | R,b3,5 |
| Diminished | [0,3,6] | R,b3,b5 |
| Augmented | [0,4,8] | R,3,#5 |
| Major 7th | [0,4,7,11] | R,3,5,7 |
| Minor 7th | [0,3,7,10] | R,b3,5,b7 |
| Dominant 7th | [0,4,7,10] | R,3,5,b7 |
| Diminished 7th | [0,3,6,9] | R,b3,b5,bb7 |
| Half-dim 7th | [0,3,6,10] | R,b3,b5,b7 |
| Sus2 | [0,2,7] | R,2,5 |
| Sus4 | [0,5,7] | R,4,5 |
| Add9 | [0,2,4,7] | R,2,3,5 |
| Major 9th | [0,4,7,11,14] | R,3,5,7,9 |
| Minor 9th | [0,3,7,10,14] | R,b3,5,b7,9 |

## Build after changes

```bash
cd MagicDAW-UI && npm run build
```

Then `make dmg` from the repo root to update the app.

## Example: Adding Dorian Mode drill

1. Add `| 'dorian'` to `DrillCategory`
2. Add to `DRILL_DEFS`:
```typescript
{
  id: 'dorian', label: 'Dorian Mode', shortLabel: 'DOR',
  color: '#a78bfa', semitones: [0, 2, 3, 5, 7, 9, 10], type: 'scale',
  degreeLabels: ['1', '2', 'b3', '4', '5', '6', 'b7'],
},
```
3. Build. Done.
