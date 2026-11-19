export const TIMER_MUTE_STORAGE_KEY = 'retrocks-timer-muted';

export function isTimerAudioMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TIMER_MUTE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function createTimerChime() {
  let context: AudioContext | undefined;

  function prepare() {
    if (typeof AudioContext === 'undefined') return;
    try {
      context ??= new AudioContext();
      if (context.state !== 'running') void context.resume?.().catch(() => {});
    } catch {
      // Audio can be unavailable under the browser's playback policy.
    }
  }

  function playNotes(options: {
    notes: readonly number[];
    stepSeconds: number;
    peakGain: number;
    attackSeconds: number;
    releaseSeconds: number;
    stopSeconds: number;
    type?: OscillatorType;
  }) {
    const audio = context;
    if (!audio || audio.state !== 'running') return;
    for (const [index, frequency] of options.notes.entries()) {
      const start = audio.currentTime + index * options.stepSeconds;
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      if (options.type) oscillator.type = options.type;
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.001, start);
      volume.gain.exponentialRampToValueAtTime(options.peakGain, start + options.attackSeconds);
      volume.gain.exponentialRampToValueAtTime(0.001, start + options.releaseSeconds);
      oscillator.connect(volume);
      volume.connect(audio.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        volume.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + options.stopSeconds);
    }
  }

  function play() {
    playNotes({
      notes: [659.25, 880],
      stepSeconds: 0.16,
      peakGain: 0.065,
      attackSeconds: 0.03,
      releaseSeconds: 0.28,
      stopSeconds: 0.3,
    });
  }

  function playRevealShimmer() {
    playNotes({
      notes: [523.25, 659.25, 783.99, 1046.5],
      stepSeconds: 0.065,
      peakGain: 0.035,
      attackSeconds: 0.14,
      releaseSeconds: 0.55,
      stopSeconds: 0.58,
      type: 'sine',
    });
  }

  function dispose() {
    if (context) void context.close().catch(() => {});
    context = undefined;
  }

  return { prepare, play, playRevealShimmer, dispose };
}
