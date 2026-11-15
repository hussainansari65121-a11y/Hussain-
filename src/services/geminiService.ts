import type { ZoyaTone } from "../utils/personalityUtils";

export function resetZoyaSession() {
  // Server handles sliding-window history per request; kept for session lifecycle compatibility.
}

export async function getZoyaResponse(
  prompt: string,
  history: { sender: "user" | "zoya"; text: string }[] = [],
  tone: ZoyaTone = "friendly",
  onChunk?: (partialText: string) => void
): Promise<string> {
  try {
    const response = await fetch("/api/gemini/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, history, tone, stream: true }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server responded with ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/event-stream") && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const lines = event.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payloadStr = line.slice(6).trim();
            if (!payloadStr) continue;

            const payload = JSON.parse(payloadStr) as {
              chunk?: string;
              done?: boolean;
              text?: string;
              error?: string;
            };

            if (payload.error) {
              throw new Error(payload.error);
            }

            if (payload.chunk) {
              fullText += payload.chunk;
              onChunk?.(fullText);
            }

            if (payload.done && payload.text) {
              fullText = payload.text;
            }
          }
        }
      }

      return fullText || "अरे हुसैन, मैं यहीं हूँ यार... बोलो ना क्या बात है?";
    }

    const data = (await response.json()) as { text?: string };
    return data.text || "अरे हुसैन, मैं यहीं हूँ यार... बोलो ना क्या बात है?";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "अरे हुसैन, थोड़ा सा नेटवर्क अटक गया यार... पर मैं यहीं हूँ, एक बार फिर से बोलो ना!";
  }
}

export async function getZoyaAudio(text: string): Promise<string | null> {
  try {
    const response = await fetch("/api/gemini/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `TTS server responded with ${response.status}`);
    }

    const data = (await response.json()) as { audio?: string | null };
    return data.audio || null;
  } catch (error) {
    console.error("TTS Error:", error);
    return null;
  }
}
