export async function playPCM(base64Data: string): Promise<void> {
  try {
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const isWav =
      bytes.length >= 4 &&
      bytes[0] === 0x52 && // R
      bytes[1] === 0x49 && // I
      bytes[2] === 0x46 && // F
      bytes[3] === 0x46; // F

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) {
      if (isWav) {
        const blob = new Blob([bytes], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        return new Promise<void>((resolve) => {
          audio.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          audio.play().catch(() => resolve());
        });
      }
      console.warn("AudioContext not supported");
      return;
    }

    const audioCtx = new AudioContextClass({ sampleRate: 24000 });

    let audioBuffer: AudioBuffer;
    if (isWav) {
      audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    } else {
      const buffer = new Int16Array(bytes.buffer);
      audioBuffer = audioCtx.createBuffer(1, buffer.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 32768.0;
      }
    }

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start();

    return new Promise<void>((resolve) => {
      source.onended = () => {
        audioCtx.close().catch(() => {});
        resolve();
      };
    });
  } catch (error) {
    console.error("Error playing audio:", error);
  }
}
