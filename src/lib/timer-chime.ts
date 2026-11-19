export function createTimerChime() {
  let context: AudioContext | undefined;

  function prepare() {
    if (typeof AudioContext === 'undefined') return;
    try {
      context ??= new AudioContext();
      if (context.state !== 'running') void context.resume().catch(() => {});
    } catch {
      // Audio can be unavailable under the browser's playback policy.
    }
  }

  function play() {
    const audio = context;
    if (!audio || audio.state !== 'running') return;
    const notes = [659.25, 880];
    for (const [index, frequency] of notes.entries()) {
      const start = audio.currentTime + index * 0.16;
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.001, start);
      volume.gain.exponentialRampToValueAtTime(0.065, start + 0.03);
      volume.gain.exponentialRampToValueAtTime(0.001, start + 0.28);
      oscillator.connect(volume);
      volume.connect(audio.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        volume.disconnect();
      };
      oscillator.start(start);
      oscillator.stop(start + 0.3);
    }
  }

  function dispose() {
    if (context) void context.close().catch(() => {});
    context = undefined;
  }

  return { prepare, play, dispose };
}
