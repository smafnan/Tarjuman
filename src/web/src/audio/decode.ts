/**
 * Decode a complete audio file (a voice sample from the server) to mono samples at
 * `sampleRate`, as the recognizers take them. The server cannot do this for the voices'
 * compressed audio; the browser has the decoders built in.
 */
export async function decodeToMono(bytes: Uint8Array, sampleRate: number): Promise<Float32Array> {
  // An offline context resamples what it decodes to its own rate. Decoding takes over the
  // buffer it is given, so it gets a copy.
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const audio = await context.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
  if (audio.numberOfChannels === 1) return audio.getChannelData(0);
  const mono = new Float32Array(audio.length);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < mono.length; i++) mono[i] = (mono[i] ?? 0) + (data[i] ?? 0) / audio.numberOfChannels;
  }
  return mono;
}
