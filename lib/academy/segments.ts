/**
 * Extract the segment + checkpoint structure from a course markdown script.
 * Mirrors the parser in scripts/generate-academy-audio.ts so the player UI
 * surfaces exactly the same six segments and two checkpoints that the audio
 * pipeline rendered into Storage.
 */

export type VoiceKey = 'brian' | 'charlotte' | 'daniel' | 'rachel';

export interface SegmentInfo {
  key: string;
  index: number;
  title: string;
  voice: VoiceKey;
  /** Approximate runtime in minutes for UI display (10 by default per the course spec). */
  estimatedMinutes: number;
  /** Whether a checkpoint follows this segment (after segment 3 or 5). */
  hasCheckpointAfter: boolean;
}

export interface CheckpointInfo {
  key: 'cp-a' | 'cp-b';
  afterSegment: number;
  voice: VoiceKey;
  letter: 'A' | 'B';
}

const VOICE_ROTATION: Record<string, VoiceKey> = {
  'seg-1': 'brian',
  'seg-2': 'brian',
  'seg-3': 'charlotte',
  'cp-a-prompt': 'charlotte',
  'cp-a-wrong': 'charlotte',
  'seg-4': 'daniel',
  'seg-5': 'daniel',
  'cp-b-prompt': 'rachel',
  'cp-b-wrong': 'rachel',
  'seg-6': 'rachel',
};

export function extractSegments(markdown: string): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  const re = /## Segment (\d+) — ([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const index = Number(m[1]);
    const title = m[2].trim();
    const key = `seg-${index}`;
    const voice = VOICE_ROTATION[key];
    if (!voice) continue;
    segments.push({
      key,
      index,
      title,
      voice,
      estimatedMinutes: 10,
      hasCheckpointAfter: index === 3 || index === 5,
    });
  }
  return segments.sort((a, b) => a.index - b.index);
}

export function checkpointsFromSegments(): CheckpointInfo[] {
  return [
    { key: 'cp-a', afterSegment: 3, voice: 'charlotte', letter: 'A' },
    { key: 'cp-b', afterSegment: 5, voice: 'rachel', letter: 'B' },
  ];
}

const VOICE_DETAILS: Record<VoiceKey, { displayName: string; accent: string; gender: 'm' | 'f' }> = {
  brian: { displayName: 'Brian', accent: 'US', gender: 'm' },
  charlotte: { displayName: 'Charlotte', accent: 'UK', gender: 'f' },
  daniel: { displayName: 'Daniel', accent: 'UK', gender: 'm' },
  rachel: { displayName: 'Rachel', accent: 'US', gender: 'f' },
};

export function describeVoice(voice: VoiceKey) {
  return VOICE_DETAILS[voice];
}

/**
 * SRT cue parser. Produces one entry per cue in the file, with start/end
 * times in seconds.
 */
export interface SrtCue {
  index: number;
  startSec: number;
  endSec: number;
  text: string;
}

export function parseSrt(srt: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = srt.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;
    const idx = Number(lines[0].trim());
    const timing = lines[1].trim();
    const text = lines.slice(2).join(' ').trim();
    const m = timing.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!m) continue;
    const startSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const endSec = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
    cues.push({ index: idx, startSec, endSec, text });
  }
  return cues;
}
