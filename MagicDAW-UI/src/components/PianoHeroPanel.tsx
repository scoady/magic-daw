import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { Player } from '@remotion/player';
import { PianoHero } from '../compositions/PianoHero';
import type { PianoHeroProps, SongNote, KeyRange } from '../compositions/PianoHero';
import { onMidiStateChange, previewNote, openFilePicker, openURL, onFilePicked } from '../bridge';

// ── Song type ──────────────────────────────────────────────────────────────

interface Song {
  id: string;
  title: string;
  artist: string;
  bpm: number;
  difficulty: 'easy' | 'medium' | 'hard';
  notes: SongNote[];
  aiGenerated?: boolean;
}

// ── Helper: beats → seconds ────────────────────────────────────────────────

function b2s(beat: number, bpm: number): number {
  return beat * (60 / bpm);
}

const LEAD_IN = 5; // seconds of empty scrolling before notes start

function melodyToNotes(
  bpm: number,
  rawNotes: [number, number, number][], // [midi, startBeat, durationBeats]
): SongNote[] {
  return rawNotes.map(([midi, start, dur]) => ({
    midi,
    time: b2s(start, bpm) + LEAD_IN,
    dur: b2s(dur, bpm),
  }));
}

// ── Built-in songs ─────────────────────────────────────────────────────────

const BUILT_IN_SONGS: Song[] = [
  {
    id: 'twinkle', title: 'Twinkle Twinkle Little Star', artist: 'Traditional', bpm: 110, difficulty: 'easy',
    notes: melodyToNotes(110, [
      // C C G G A A G- | F F E E D D C-
      [60,0,1],[60,1,1],[67,2,1],[67,3,1],[69,4,1],[69,5,1],[67,6,2],
      [65,8,1],[65,9,1],[64,10,1],[64,11,1],[62,12,1],[62,13,1],[60,14,2],
      // G G F F E E D- | G G F F E E D-
      [67,16,1],[67,17,1],[65,18,1],[65,19,1],[64,20,1],[64,21,1],[62,22,2],
      [67,24,1],[67,25,1],[65,26,1],[65,27,1],[64,28,1],[64,29,1],[62,30,2],
    ]),
  },
  {
    id: 'ode-to-joy', title: 'Ode to Joy', artist: 'Beethoven', bpm: 120, difficulty: 'easy',
    notes: melodyToNotes(120, [
      // E E F G | G F E D | C C D E | E. D D-
      [64,0,1],[64,1,1],[65,2,1],[67,3,1],[67,4,1],[65,5,1],[64,6,1],[62,7,1],
      [60,8,1],[60,9,1],[62,10,1],[64,11,1],[64,12,1.5],[62,13.5,0.5],[62,14,2],
      // E E F G | G F E D | C C D E | D. C C-
      [64,16,1],[64,17,1],[65,18,1],[67,19,1],[67,20,1],[65,21,1],[64,22,1],[62,23,1],
      [60,24,1],[60,25,1],[62,26,1],[64,27,1],[62,28,1.5],[60,29.5,0.5],[60,30,2],
    ]),
  },
  {
    id: 'mary-lamb', title: 'Mary Had a Little Lamb', artist: 'Traditional', bpm: 120, difficulty: 'easy',
    notes: melodyToNotes(120, [
      // E D C D | E E E- | D D D- | E G G-
      [64,0,1],[62,1,1],[60,2,1],[62,3,1],[64,4,1],[64,5,1],[64,6,2],
      [62,8,1],[62,9,1],[62,10,2],[64,12,1],[67,13,1],[67,14,2],
      // E D C D | E E E E | D D E D | C---
      [64,16,1],[62,17,1],[60,18,1],[62,19,1],[64,20,1],[64,21,1],[64,22,1],[64,23,1],
      [62,24,1],[62,25,1],[64,26,1],[62,27,1],[60,28,4],
    ]),
  },
  {
    id: 'fur-elise', title: 'Für Elise (Opening)', artist: 'Beethoven', bpm: 140, difficulty: 'medium',
    notes: melodyToNotes(140, [
      // E5 D#5 E5 D#5 E5 B4 D5 C5 A4-
      [76,0,0.5],[75,0.5,0.5],[76,1,0.5],[75,1.5,0.5],[76,2,0.5],[71,2.5,0.5],[74,3,0.5],[72,3.5,0.5],[69,4,1],
      // C4 E4 A4 B4-
      [48,5,0.5],[52,5.5,0.5],[57,6,0.5],[59,6.5,0.5],[71,7,1],
      // E4 G#4 B4 C5-
      [52,8,0.5],[56,8.5,0.5],[59,9,0.5],[60,9.5,0.5],[64,10,1],
      // E5 D#5 E5 D#5 E5 B4 D5 C5 A4-
      [76,11,0.5],[75,11.5,0.5],[76,12,0.5],[75,12.5,0.5],[76,13,0.5],[71,13.5,0.5],[74,14,0.5],[72,14.5,0.5],[69,15,1],
      // C4 E4 A4 B4 | E4 C5 B4 A4--
      [48,16,0.5],[52,16.5,0.5],[57,17,0.5],[59,17.5,0.5],[71,18,1],
      [52,19,0.5],[60,19.5,0.5],[59,20,0.5],[57,20.5,0.5],[69,21,2],
    ]),
  },
  {
    id: 'canon-melody', title: 'Canon in D (Melody)', artist: 'Pachelbel', bpm: 80, difficulty: 'medium',
    notes: melodyToNotes(80, [
      // F#5 E5 D5 C#5 | B4 A4 B4 C#5
      [78,0,1],[76,1,1],[74,2,1],[73,3,1],[71,4,1],[69,5,1],[71,6,1],[73,7,1],
      // D5 C#5 B4 A4 | G4 F#4 G4 E4
      [74,8,1],[73,9,1],[71,10,1],[69,11,1],[67,12,1],[66,13,1],[67,14,1],[64,15,1],
    ]),
  },
  {
    id: 'c-scale', title: 'C Major Scale (2 Oct)', artist: 'Exercise', bpm: 100, difficulty: 'easy',
    notes: melodyToNotes(100, [
      [60,0,1],[62,1,1],[64,2,1],[65,3,1],[67,4,1],[69,5,1],[71,6,1],[72,7,1],
      [74,8,1],[76,9,1],[77,10,1],[79,11,1],[81,12,1],[83,13,1],[84,14,2],
      // descending
      [83,16,1],[81,17,1],[79,18,1],[77,19,1],[76,20,1],[74,21,1],[72,22,1],
      [71,23,1],[69,24,1],[67,25,1],[65,26,1],[64,27,1],[62,28,1],[60,29,2],
    ]),
  },
];

// ── Simple MIDI file parser ────────────────────────────────────────────────

function parseMidiFile(buffer: ArrayBuffer): SongNote[] {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let pos = 0;

  function readStr(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(data[pos++]);
    return s;
  }
  function read16(): number { const v = view.getUint16(pos); pos += 2; return v; }
  function read32(): number { const v = view.getUint32(pos); pos += 4; return v; }
  function readVarLen(): number {
    let val = 0;
    for (let i = 0; i < 4; i++) {
      const b = data[pos++];
      val = (val << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return val;
  }

  // Header
  const hdrId = readStr(4);
  if (hdrId !== 'MThd') throw new Error('Not a MIDI file');
  read32(); // header length
  const format = read16();
  const numTracks = read16();
  const division = read16();

  let microsecondsPerBeat = 500000; // default 120 BPM
  const ticksPerBeat = division & 0x7fff;

  // Collect all note events across tracks
  const rawNotes: { midi: number; tickOn: number; tickOff: number }[] = [];

  for (let t = 0; t < numTracks; t++) {
    const trkId = readStr(4);
    if (trkId !== 'MTrk') break;
    const trkLen = read32();
    const trkEnd = pos + trkLen;

    let tick = 0;
    let runningStatus = 0;
    const activeNotes: Map<number, number> = new Map(); // midi → tickOn

    while (pos < trkEnd) {
      const delta = readVarLen();
      tick += delta;

      let statusByte = data[pos];
      if (statusByte & 0x80) {
        runningStatus = statusByte;
        pos++;
      } else {
        statusByte = runningStatus;
      }

      const cmd = statusByte & 0xf0;

      if (cmd === 0x90) {
        // Note on
        const note = data[pos++];
        const vel = data[pos++];
        if (vel > 0) {
          activeNotes.set(note, tick);
        } else {
          // velocity 0 = note off
          const onTick = activeNotes.get(note);
          if (onTick !== undefined) {
            rawNotes.push({ midi: note, tickOn: onTick, tickOff: tick });
            activeNotes.delete(note);
          }
        }
      } else if (cmd === 0x80) {
        // Note off
        const note = data[pos++];
        pos++; // velocity
        const onTick = activeNotes.get(note);
        if (onTick !== undefined) {
          rawNotes.push({ midi: note, tickOn: onTick, tickOff: tick });
          activeNotes.delete(note);
        }
      } else if (statusByte === 0xff) {
        // Meta event
        const metaType = data[pos++];
        const metaLen = readVarLen();
        if (metaType === 0x51 && metaLen === 3) {
          microsecondsPerBeat = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
        }
        pos += metaLen;
      } else if (cmd === 0xc0 || cmd === 0xd0) {
        pos++; // 1 data byte
      } else if (cmd === 0xf0 || cmd === 0xf7) {
        const len = readVarLen();
        pos += len;
      } else {
        pos += 2; // default 2 data bytes
      }
    }
    pos = trkEnd;
  }

  // Convert ticks to seconds
  const secPerTick = microsecondsPerBeat / 1_000_000 / ticksPerBeat;
  const bpm = Math.round(60_000_000 / microsecondsPerBeat);

  return rawNotes
    .sort((a, b) => a.tickOn - b.tickOn)
    .map(n => ({
      midi: n.midi,
      time: n.tickOn * secPerTick + LEAD_IN,
      dur: Math.max((n.tickOff - n.tickOn) * secPerTick, 0.05),
    }));
}

// ── MusicXML parser ────────────────────────────────────────────────────────

const STEP_TO_SEMITONE: Record<string, number> = {
  'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
};

function parseMusicXML(xmlText: string): { notes: SongNote[]; bpm: number; title: string } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');

  // Title
  const titleEl = doc.querySelector('work-title') ?? doc.querySelector('movement-title');
  const title = titleEl?.textContent ?? 'Imported Score';

  // BPM from first <sound tempo="...">
  const soundEl = doc.querySelector('sound[tempo]');
  const bpm = soundEl ? parseFloat(soundEl.getAttribute('tempo') ?? '120') : 120;
  const beatDur = 60 / bpm;

  // Divisions (ticks per quarter note) — can vary per part
  const defaultDivisions = parseInt(doc.querySelector('attributes divisions')?.textContent ?? '1', 10);

  const notes: SongNote[] = [];
  const parts = doc.querySelectorAll('part');

  for (const part of parts) {
    let currentTime = 0; // in seconds
    let divisions = defaultDivisions;

    const measures = part.querySelectorAll('measure');
    for (const measure of measures) {
      let measureTime = currentTime;
      let maxForward = 0;

      for (const child of measure.children) {
        if (child.tagName === 'attributes') {
          const divEl = child.querySelector('divisions');
          if (divEl) divisions = parseInt(divEl.textContent ?? '1', 10);
        }

        if (child.tagName === 'forward') {
          const dur = parseInt(child.querySelector('duration')?.textContent ?? '0', 10);
          currentTime += (dur / divisions) * beatDur;
        }

        if (child.tagName === 'backup') {
          const dur = parseInt(child.querySelector('duration')?.textContent ?? '0', 10);
          currentTime -= (dur / divisions) * beatDur;
        }

        if (child.tagName === 'note') {
          const isRest = child.querySelector('rest') !== null;
          const isChord = child.querySelector('chord') !== null;
          const durEl = child.querySelector('duration');
          const duration = durEl ? parseInt(durEl.textContent ?? '0', 10) : divisions;
          const durSec = (duration / divisions) * beatDur;

          if (isChord) {
            // Chord note plays at the same time as previous note
            // Don't advance time
          }

          if (!isRest) {
            const pitchEl = child.querySelector('pitch');
            if (pitchEl) {
              const step = pitchEl.querySelector('step')?.textContent ?? 'C';
              const octave = parseInt(pitchEl.querySelector('octave')?.textContent ?? '4', 10);
              const alter = parseInt(pitchEl.querySelector('alter')?.textContent ?? '0', 10);
              const midi = (octave + 1) * 12 + (STEP_TO_SEMITONE[step] ?? 0) + alter;

              notes.push({
                midi,
                time: currentTime + LEAD_IN,
                dur: Math.max(durSec, 0.05),
              });
            }
          }

          if (!isChord) {
            currentTime += durSec;
          }
        }
      }
    }
  }

  return { notes: notes.sort((a, b) => a.time - b.time), bpm, title };
}

// Decompress MXL (compressed MusicXML) — it's a ZIP file
async function decompressMXL(buffer: ArrayBuffer): Promise<string> {
  // MXL is a ZIP containing .musicxml or .xml files + META-INF/container.xml
  // Use the browser's DecompressionStream API or fallback
  // For simplicity, try to find the XML content directly
  const bytes = new Uint8Array(buffer);

  // Find local file headers in ZIP and extract the largest XML file
  let bestXml = '';
  let pos = 0;

  while (pos < bytes.length - 30) {
    // Local file header signature: PK\x03\x04
    if (bytes[pos] !== 0x50 || bytes[pos + 1] !== 0x4b ||
        bytes[pos + 2] !== 0x03 || bytes[pos + 3] !== 0x04) {
      pos++;
      continue;
    }

    const fnLen = bytes[pos + 26] | (bytes[pos + 27] << 8);
    const extraLen = bytes[pos + 28] | (bytes[pos + 29] << 8);
    const compressedSize = bytes[pos + 18] | (bytes[pos + 19] << 8) |
      (bytes[pos + 20] << 16) | (bytes[pos + 21] << 24);
    const method = bytes[pos + 8] | (bytes[pos + 9] << 8);

    const fnStart = pos + 30;
    const fn = new TextDecoder().decode(bytes.slice(fnStart, fnStart + fnLen));
    const dataStart = fnStart + fnLen + extraLen;

    if ((fn.endsWith('.musicxml') || fn.endsWith('.xml')) && !fn.includes('META-INF')) {
      if (method === 0) {
        // Stored (no compression)
        const xml = new TextDecoder().decode(bytes.slice(dataStart, dataStart + compressedSize));
        if (xml.length > bestXml.length) bestXml = xml;
      } else if (method === 8) {
        // Deflate — use DecompressionStream
        try {
          const compressed = bytes.slice(dataStart, dataStart + compressedSize);
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compressed);
          writer.close();
          const reader = ds.readable.getReader();
          const chunks: Uint8Array[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const total = chunks.reduce((s, c) => s + c.length, 0);
          const result = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
          const xml = new TextDecoder().decode(result);
          if (xml.length > bestXml.length) bestXml = xml;
        } catch { /* skip this entry */ }
      }
    }

    pos = dataStart + compressedSize;
  }

  if (!bestXml) throw new Error('No MusicXML found in MXL archive');
  return bestXml;
}

// ── Song persistence ───────────────────────────────────────────────────────

function loadUserSongs(): Song[] {
  try {
    const raw = localStorage.getItem('piano-hero-songs');
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveUserSongs(songs: Song[]): void {
  localStorage.setItem('piano-hero-songs', JSON.stringify(songs));
}

// ── Ollama AI song generation ──────────────────────────────────────────────

const OLLAMA_URL = 'http://DESKTOP-D4U6J5M:11434';

async function generateSongWithAI(description: string): Promise<Song | null> {
  const prompt = `You are a music composition assistant. Generate a simple piano melody based on this description:

"${description}"

Output ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "title": "Song Title",
  "bpm": 120,
  "notes": [[midi, startBeat, durationBeats], ...]
}

Rules:
- midi: MIDI note number (60=middle C, 62=D, 64=E, 65=F, 67=G, 69=A, 71=B, 72=high C)
- startBeat: when the note starts (0 = beginning, 1 = beat 2, etc.)
- durationBeats: how long (1 = quarter note, 0.5 = eighth, 2 = half)
- Keep it 8-32 notes, musically coherent
- Use notes in range 48-84 (2 octaves around middle C)
- Make it sound good and match the description

Example for "happy waltz":
{"title":"Happy Waltz","bpm":150,"notes":[[60,0,1],[64,1,1],[67,2,1],[72,3,2],[67,5,1],[64,6,1],[60,7,2]]}`;

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:14b',
        prompt,
        stream: false,
        options: { temperature: 0.7 },
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.response || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const bpm = parsed.bpm || 120;
    const notes = melodyToNotes(bpm, parsed.notes);

    return {
      id: `ai-${Date.now()}`,
      title: parsed.title || description.slice(0, 40),
      artist: 'AI Generated',
      bpm,
      difficulty: 'medium' as const,
      notes,
      aiGenerated: true,
    };
  } catch (err) {
    console.error('AI song generation failed:', err);
    return null;
  }
}

// ── AI variation of existing song ──────────────────────────────────────────

async function generateVariation(song: Song): Promise<Song | null> {
  // Summarize the song as note data for the AI
  const notesSummary = song.notes.slice(0, 32).map(n => {
    const beat = Math.round((n.time - LEAD_IN) / (60 / song.bpm) * 2) / 2;
    const durBeat = Math.round(n.dur / (60 / song.bpm) * 2) / 2;
    return `[${n.midi},${beat},${durBeat}]`;
  }).join(',');

  const prompt = `You are a music composition assistant. Here is an existing piano melody called "${song.title}" at ${song.bpm} BPM:

notes: [${notesSummary}]

Create a VARIATION of this melody — keep the same feel and key but change the rhythm, add ornaments, transpose some phrases, or develop the theme further. Make it recognizably related but different.

Output ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "title": "Variation Title",
  "bpm": ${song.bpm},
  "notes": [[midi, startBeat, durationBeats], ...]
}

Rules:
- midi: MIDI note number (60=middle C)
- startBeat: beat position (0 = start)
- durationBeats: note length (1 = quarter, 0.5 = eighth, 2 = half)
- Keep similar length to original (${song.notes.length} notes)
- Stay in range 48-84`;

  try {
    const resp = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen2.5:14b',
        prompt,
        stream: false,
        options: { temperature: 0.8 },
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.response || '';

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const bpm = parsed.bpm || song.bpm;
    const notes = melodyToNotes(bpm, parsed.notes);

    return {
      id: `var-${Date.now()}`,
      title: parsed.title || `${song.title} (Variation)`,
      artist: 'AI Variation',
      bpm,
      difficulty: song.difficulty,
      notes,
      aiGenerated: true,
    };
  } catch (err) {
    console.error('AI variation failed:', err);
    return null;
  }
}

// ── Hit detection constants ────────────────────────────────────────────────

const HIT_WINDOW = 0.25; // seconds tolerance

// ── Component ──────────────────────────────────────────────────────────────

export const PianoHeroPanel: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [compSize, setCompSize] = useState<{ w: number; h: number } | null>(null);

  // Observe container size
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setCompSize({ w: Math.round(width / 2) * 2, h: Math.round(height / 2) * 2 });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ── Song library ──────────────────────────────────────────────────────
  const [userSongs, setUserSongs] = useState<Song[]>(loadUserSongs);
  const allSongs = useMemo(() => [...BUILT_IN_SONGS, ...userSongs], [userSongs]);
  const [selectedSongId, setSelectedSongId] = useState<string>(BUILT_IN_SONGS[0].id);
  const selectedSong = allSongs.find(s => s.id === selectedSongId) ?? null;

  // ── Playback state ────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeNotes, setActiveNotes] = useState<number[]>([]);
  const animFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // ── Scoring ───────────────────────────────────────────────────────────
  const [hitNoteIndices, setHitNoteIndices] = useState<number[]>([]);
  const [score, setScore] = useState({ hits: 0, total: 0, combo: 0, maxCombo: 0 });
  const processedRef = useRef<Set<number>>(new Set()); // notes already scored

  // ── AI generation ─────────────────────────────────────────────────────
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [showTrackList, setShowTrackList] = useState(true);
  const [keyRange, setKeyRange] = useState<KeyRange>(41);

  // ── MIDI input ────────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onMidiStateChange((notes) => {
      setActiveNotes(notes.map(n => n.note));
    });
    return unsub;
  }, []);

  // ── Playback loop ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying || !selectedSong) return;

    lastTimeRef.current = performance.now();

    const tick = () => {
      const now = performance.now();
      const dt = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      setCurrentTime(prev => {
        const next = prev + dt;
        // Auto-stop when song ends (2 sec past last note)
        const songEnd = selectedSong.notes.length > 0
          ? Math.max(...selectedSong.notes.map(n => n.time + n.dur)) + 2
          : 0;
        if (next > songEnd) {
          setIsPlaying(false);
          return prev;
        }
        return next;
      });

      animFrameRef.current = requestAnimationFrame(tick);
    };

    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, selectedSong]);

  // ── Hit detection ─────────────────────────────────────────────────────
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const activeNotesRef = useRef(activeNotes);
  activeNotesRef.current = activeNotes;

  useEffect(() => {
    if (!isPlaying || !selectedSong) return;

    const ct = currentTimeRef.current;
    const held = new Set(activeNotesRef.current.map(n => n % 12));
    if (held.size === 0) return;

    const notes = selectedSong.notes;
    let newHits: number[] = [];

    for (let i = 0; i < notes.length; i++) {
      if (processedRef.current.has(i)) continue;
      const n = notes[i];

      // Is this note in the hit window?
      if (Math.abs(n.time - ct) < HIT_WINDOW || (n.time <= ct && n.time + n.dur >= ct)) {
        if (held.has(n.midi % 12)) {
          newHits.push(i);
          processedRef.current.add(i);
        }
      }

      // Mark missed notes
      if (n.time + n.dur + HIT_WINDOW < ct && !processedRef.current.has(i)) {
        processedRef.current.add(i);
        setScore(prev => ({
          ...prev,
          total: prev.total + 1,
          combo: 0,
        }));
      }
    }

    if (newHits.length > 0) {
      setHitNoteIndices(prev => [...prev, ...newHits]);
      setScore(prev => {
        const newCombo = prev.combo + newHits.length;
        return {
          hits: prev.hits + newHits.length,
          total: prev.total + newHits.length,
          combo: newCombo,
          maxCombo: Math.max(prev.maxCombo, newCombo),
        };
      });
    }
  }, [currentTime, activeNotes, isPlaying, selectedSong]);

  // ── Playback controls ────────────────────────────────────────────────
  const handlePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  }, [isPlaying]);

  const handleRestart = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setHitNoteIndices([]);
    setScore({ hits: 0, total: 0, combo: 0, maxCombo: 0 });
    processedRef.current.clear();
  }, []);

  const handleSelectSong = useCallback((id: string) => {
    setSelectedSongId(id);
    setIsPlaying(false);
    setCurrentTime(0);
    setHitNoteIndices([]);
    setScore({ hits: 0, total: 0, combo: 0, maxCombo: 0 });
    processedRef.current.clear();
  }, []);

  // ── AI generate ──────────────────────────────────────────────────────
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim() || aiGenerating) return;
    setAiGenerating(true);
    const song = await generateSongWithAI(aiPrompt.trim());
    setAiGenerating(false);
    if (song) {
      const updated = [...userSongs, song];
      setUserSongs(updated);
      saveUserSongs(updated);
      setSelectedSongId(song.id);
      setAiPrompt('');
    }
  }, [aiPrompt, aiGenerating, userSongs]);

  // ── AI variation of current song ──────────────────────────────────────
  const handleAiVariation = useCallback(async () => {
    if (!selectedSong || aiGenerating) return;
    setAiGenerating(true);
    const song = await generateVariation(selectedSong);
    setAiGenerating(false);
    if (song) {
      const updated = [...userSongs, song];
      setUserSongs(updated);
      saveUserSongs(updated);
      setSelectedSongId(song.id);
    }
  }, [selectedSong, aiGenerating, userSongs]);

  // ── File import (via Swift bridge) ─────────────────────────────────────
  const handleImportFile = useCallback(() => {
    openFilePicker(['.mid', '.midi', '.musicxml', '.xml', '.mxl'], 'piano-hero');
  }, []);

  // Listen for file picked events from Swift
  useEffect(() => {
    const unsub = onFilePicked(async (payload) => {
      if (payload.pickerId !== 'piano-hero') return;

      try {
        const name = payload.path.toLowerCase();
        // Decode base64 to binary
        const binaryStr = atob(payload.data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
        const buffer = bytes.buffer;

        let notes: SongNote[] = [];
        let bpm = 120;
        let title = payload.path.replace(/\.[^.]+$/, '');

        if (name.endsWith('.musicxml') || name.endsWith('.xml')) {
          const text = new TextDecoder().decode(bytes);
          const result = parseMusicXML(text);
          notes = result.notes;
          bpm = result.bpm;
          title = result.title || title;
        } else if (name.endsWith('.mxl')) {
          const xmlText = await decompressMXL(buffer);
          const result = parseMusicXML(xmlText);
          notes = result.notes;
          bpm = result.bpm;
          title = result.title || title;
        } else {
          notes = parseMidiFile(buffer);
          const totalTime = Math.max(...notes.map(n => n.time + n.dur));
          bpm = Math.round(notes.length / (totalTime / 60) * 4);
        }

        if (notes.length === 0) return;

        const song: Song = {
          id: `import-${Date.now()}`,
          title,
          artist: 'Imported',
          bpm: Math.min(Math.max(bpm, 60), 200),
          difficulty: notes.length > 100 ? 'hard' : notes.length > 40 ? 'medium' : 'easy',
          notes,
        };

        setUserSongs(prev => {
          const updated = [...prev, song];
          saveUserSongs(updated);
          return updated;
        });
        setSelectedSongId(song.id);
      } catch (err) {
        console.error('Import failed:', err);
      }
    });
    return unsub;
  }, []);

  // ── Open MuseScore in browser ────────────────────────────────────────
  const handleBrowseMuseScore = useCallback(() => {
    openURL('https://musescore.com/sheetmusic');
  }, []);

  // ── Delete user song ─────────────────────────────────────────────────
  const handleDeleteSong = useCallback((id: string) => {
    const updated = userSongs.filter(s => s.id !== id);
    setUserSongs(updated);
    saveUserSongs(updated);
    if (selectedSongId === id) {
      setSelectedSongId(BUILT_IN_SONGS[0].id);
    }
  }, [userSongs, selectedSongId]);

  // ── Song duration ────────────────────────────────────────────────────
  const songDuration = selectedSong
    ? Math.max(...selectedSong.notes.map(n => n.time + n.dur), 0)
    : 0;

  // ── Composition input props ──────────────────────────────────────────
  const inputProps = useMemo((): PianoHeroProps => ({
    songNotes: selectedSong?.notes ?? [],
    songTitle: selectedSong?.title ?? '',
    currentTime,
    activeNotes,
    hitNoteIndices,
    isPlaying,
    score,
    keyRange,
  }), [selectedSong, currentTime, activeNotes, hitNoteIndices, isPlaying, score, keyRange]);

  // ── Styles ───────────────────────────────────────────────────────────
  const diffColor = (d: string) =>
    d === 'easy' ? '#34d399' : d === 'medium' ? '#fbbf24' : '#f87171';

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* ── Track list sidebar ──────────────────────────────────────── */}
      {showTrackList && (
        <div style={{
          width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column',
          background: 'rgba(8,14,24,0.9)',
          borderRight: '1px solid rgba(120,200,220,0.08)',
          overflow: 'hidden',
        }}>
          {/* AI generate bar */}
          <div style={{
            padding: '6px 8px',
            borderBottom: '1px solid rgba(120,200,220,0.08)',
          }}>
            <div style={{ display: 'flex', gap: 4 }}>
              <input
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAiGenerate()}
                placeholder="Describe a melody..."
                style={{
                  flex: 1, background: 'rgba(15,25,40,0.8)', color: 'var(--text)',
                  border: '1px solid rgba(103,232,249,0.15)', borderRadius: 4,
                  padding: '4px 8px', fontSize: 10, fontFamily: 'var(--font-mono)',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleAiGenerate}
                disabled={aiGenerating || !aiPrompt.trim()}
                style={{
                  background: aiGenerating ? 'rgba(103,232,249,0.05)' : 'rgba(103,232,249,0.12)',
                  color: 'var(--cyan)', border: '1px solid rgba(103,232,249,0.2)',
                  borderRadius: 4, padding: '4px 8px', fontSize: 9,
                  fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer',
                  opacity: aiGenerating ? 0.5 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {aiGenerating ? '...' : 'AI'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button onClick={handleImportFile} style={{
                flex: 1, background: 'rgba(15,25,40,0.6)', color: 'var(--text-dim)',
                border: '1px solid rgba(120,200,220,0.1)', borderRadius: 4,
                padding: '3px 6px', fontSize: 8, fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
              }}>
                Import File
              </button>
              <button onClick={handleAiVariation} disabled={!selectedSong || aiGenerating}
                style={{
                  flex: 1, background: 'rgba(167,139,250,0.08)', color: 'var(--purple)',
                  border: '1px solid rgba(167,139,250,0.15)', borderRadius: 4,
                  padding: '3px 6px', fontSize: 8, fontFamily: 'var(--font-mono)',
                  cursor: 'pointer', opacity: !selectedSong || aiGenerating ? 0.4 : 1,
                }}>
                AI Variation
              </button>
            </div>
            <div style={{ marginTop: 4 }}>
              <button onClick={handleBrowseMuseScore}
                style={{
                  display: 'block', width: '100%', textAlign: 'center',
                  background: 'rgba(45,212,191,0.06)', color: 'var(--teal)',
                  border: '1px solid rgba(45,212,191,0.12)', borderRadius: 4,
                  padding: '3px 6px', fontSize: 8, fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                }}>
                Browse MuseScore.com →
              </button>
              <div style={{
                color: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)',
                textAlign: 'center', marginTop: 2, opacity: 0.6,
              }}>
                Download MIDI or MusicXML, then Import
              </div>
            </div>
          </div>

          {/* Song list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
            {/* Built-in header */}
            <div style={{
              padding: '4px 10px', color: 'var(--text-muted)', fontSize: 8,
              fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em',
            }}>
              Built-in Songs
            </div>
            {BUILT_IN_SONGS.map(s => (
              <SongRow key={s.id} song={s} selected={selectedSongId === s.id}
                onSelect={handleSelectSong} />
            ))}

            {userSongs.length > 0 && (
              <>
                <div style={{
                  padding: '8px 10px 4px', color: 'var(--text-muted)', fontSize: 8,
                  fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em',
                }}>
                  My Songs
                </div>
                {userSongs.map(s => (
                  <SongRow key={s.id} song={s} selected={selectedSongId === s.id}
                    onSelect={handleSelectSong} onDelete={handleDeleteSong} />
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Main area: composition + controls ──────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Remotion Player */}
        <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
          {compSize && (
            <Player
              component={PianoHero}
              inputProps={inputProps}
              compositionWidth={compSize.w}
              compositionHeight={compSize.h}
              fps={30}
              durationInFrames={999999}
              style={{ width: '100%', height: '100%' }}
              loop
              autoPlay
              controls={false}
            />
          )}
        </div>

        {/* Controls bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: 'rgba(8,14,24,0.9)',
          borderTop: '1px solid rgba(120,200,220,0.1)',
          flexShrink: 0,
        }}>
          {/* Toggle sidebar */}
          <button onClick={() => setShowTrackList(prev => !prev)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: 14, cursor: 'pointer', padding: '2px 4px',
          }} title="Toggle track list">
            {showTrackList ? '◀' : '▶'}
          </button>

          {/* Restart */}
          <button onClick={handleRestart} style={{
            background: 'rgba(248,113,113,0.1)', color: '#f87171',
            border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4,
            padding: '4px 10px', fontSize: 11, fontFamily: 'var(--font-mono)',
            fontWeight: 700, cursor: 'pointer',
          }}>
            ↺
          </button>

          {/* Play/Pause */}
          <button onClick={handlePlay} style={{
            background: isPlaying ? 'rgba(251,191,36,0.12)' : 'rgba(103,232,249,0.12)',
            color: isPlaying ? 'var(--gold)' : 'var(--cyan)',
            border: `1px solid ${isPlaying ? 'rgba(251,191,36,0.3)' : 'rgba(103,232,249,0.3)'}`,
            borderRadius: 4, padding: '4px 18px', fontSize: 12,
            fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer',
          }}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          {/* Song info */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <span style={{
              color: 'var(--text)', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
            }}>
              {selectedSong?.title ?? 'No song'}
            </span>
            {selectedSong && (
              <span style={{
                color: 'var(--text-muted)', fontSize: 9, fontFamily: 'var(--font-mono)', marginLeft: 8,
              }}>
                {selectedSong.artist} · {selectedSong.bpm} BPM ·{' '}
                <span style={{ color: diffColor(selectedSong.difficulty) }}>
                  {selectedSong.difficulty}
                </span>
              </span>
            )}
          </div>

          {/* Key range toggle */}
          <button
            onClick={() => setKeyRange(prev => prev === 41 ? 88 : 41)}
            style={{
              background: 'rgba(167,139,250,0.1)',
              color: 'var(--purple)',
              border: '1px solid rgba(167,139,250,0.2)',
              borderRadius: 4, padding: '3px 8px', fontSize: 9,
              fontFamily: 'var(--font-mono)', fontWeight: 700, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={`Switch to ${keyRange === 41 ? '88' : '41'}-key keyboard`}
          >
            {keyRange} keys
          </button>

          {/* Timeline */}
          <span style={{
            color: 'var(--text-dim)', fontSize: 10, fontFamily: 'var(--font-mono)', opacity: 0.6,
          }}>
            {formatTime(currentTime)} / {formatTime(songDuration)}
          </span>

          {/* Score summary */}
          {score.total > 0 && (
            <span style={{
              color: 'var(--gold)', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700,
            }}>
              {Math.round(score.hits / score.total * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

const SongRow: React.FC<{
  song: Song;
  selected: boolean;
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}> = ({ song, selected, onSelect, onDelete }) => {
  const diffColor = song.difficulty === 'easy' ? '#34d399'
    : song.difficulty === 'medium' ? '#fbbf24' : '#f87171';

  return (
    <div
      onClick={() => onSelect(song.id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 10px', cursor: 'pointer',
        background: selected ? 'rgba(103,232,249,0.06)' : 'transparent',
        borderLeft: selected ? '2px solid #67e8f9' : '2px solid transparent',
        transition: 'all 0.1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: selected ? 'var(--text)' : 'var(--text-dim)',
          fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: selected ? 700 : 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {song.title}
        </div>
        <div style={{
          color: 'var(--text-muted)', fontSize: 8, fontFamily: 'var(--font-mono)',
          display: 'flex', gap: 6,
        }}>
          <span>{song.artist}</span>
          <span style={{ color: diffColor }}>{song.difficulty}</span>
          <span>{song.notes.length} notes</span>
          {song.aiGenerated && <span style={{ color: 'var(--purple)' }}>AI</span>}
        </div>
      </div>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(song.id); }}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            fontSize: 10, cursor: 'pointer', padding: '0 2px',
            opacity: 0.4,
          }}
          title="Delete"
        >
          ×
        </button>
      )}
    </div>
  );
};

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default PianoHeroPanel;
