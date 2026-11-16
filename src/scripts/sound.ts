// Tiny synthesised sounds (no audio files) + text-to-speech.
// Browsers only allow audio after the first touch, so the context is unlocked on any tap.

export type Sound = 'chime' | 'bell' | 'gentle' | 'alarm';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
window.addEventListener('pointerdown', () => audio(), { passive: true });

function tone(c: AudioContext, freq: number, at: number, dur: number, type: OscillatorType = 'sine', peak = 0.25) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** A struck bell: fundamental plus a couple of inharmonic partials */
function strike(c: AudioContext, freq: number, at: number, dur = 1.8, peak = 0.22) {
  tone(c, freq, at, dur, 'sine', peak);
  tone(c, freq * 2.01, at, dur * 0.6, 'sine', peak * 0.35);
  tone(c, freq * 3.0, at, dur * 0.35, 'sine', peak * 0.15);
}

export function play(kind: Sound) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.05;
  switch (kind) {
    case 'chime': // four-note doorbell-style chime
      [659.25, 523.25, 587.33, 392.0].forEach((f, i) => strike(c, f, t + i * 0.55, 1.6));
      break;
    case 'bell': // school-bell rings
      for (let i = 0; i < 3; i++) strike(c, 880, t + i * 0.7, 1.4, 0.28);
      break;
    case 'gentle': // soft rising arpeggio
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, f, t + i * 0.22, 1.2, 'triangle', 0.18));
      break;
    case 'alarm': // kitchen-timer beeps
      for (let i = 0; i < 4; i++) tone(c, 1046.5, t + i * 0.22, 0.14, 'square', 0.12);
      break;
  }
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 0.95;
    const voice = speechSynthesis.getVoices().find((v) => v.lang === 'en-GB');
    if (voice) u.voice = voice;
    speechSynthesis.speak(u);
  } catch {
    /* speech not available */
  }
}
