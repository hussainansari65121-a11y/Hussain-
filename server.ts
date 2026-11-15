import "dotenv/config";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Modality, Type, type LiveServerMessage } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { getSystemInstruction, normalizeTone, type ZoyaTone } from "./src/utils/personalityUtils.ts";
import { fetchWeather, extractCity } from "./src/services/weatherService.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

interface HistoryMessage {
  sender: "user" | "zoya";
  text: string;
  timestamp?: number;
}

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function getLiveAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: "v1beta",
    httpOptions: {
      apiVersion: "v1beta",
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function getIndianTimeContext() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });

  const hourStr = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "Asia/Kolkata",
  }).format(now);
  const hour = Number(hourStr);

  let dayPeriod = "रात (Night)";
  if (hour >= 5 && hour < 12) {
    dayPeriod = "सुबह (Morning)";
  } else if (hour >= 12 && hour < 17) {
    dayPeriod = "दोपहर (Afternoon)";
  } else if (hour >= 17 && hour < 21) {
    dayPeriod = "शाम (Evening)";
  }

  return { timeStr, dateStr, dayPeriod };
}

function formatChatHistory(history: HistoryMessage[]) {
  // Sliding window memory: keep the last 30 messages
  const recentHistory = history.slice(-30);
  const formattedHistory: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  let currentRole = "";
  let currentText = "";

  for (const msg of recentHistory) {
    if (!msg?.text) continue;
    const role = msg.sender === "user" ? "user" : "model";
    if (role === currentRole) {
      currentText += "\n" + msg.text;
    } else {
      if (currentRole !== "") {
        formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
      }
      currentRole = role;
      currentText = msg.text;
    }
  }

  if (currentRole !== "") {
    formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
  }

  if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
    formattedHistory.shift();
  }

  return formattedHistory;
}

function buildLiveMemoryInstruction(tone: ZoyaTone, history: HistoryMessage[]) {
  const { timeStr, dateStr, dayPeriod } = getIndianTimeContext();
  let instruction = getSystemInstruction(tone);

  instruction += `\n\n[LIVE SESSION CONTEXT]:\n- भारत में अभी तारीख: ${dateStr}, समय: ${timeStr} (${dayPeriod}) है।\n- बातचीत शुरू होते समय इसी समय के हिसाब से हुसैन को प्यार से विश करना।`;

  const validHistory = Array.isArray(history) ? history.filter((m) => m && m.text).slice(-25) : [];
  if (validHistory.length > 0) {
    const transcriptLines = validHistory
      .map((m) => `${m.sender === "user" ? "हुसैन" : "ज़ोया"}: ${m.text}`)
      .join("\n");
    instruction += `\n\n[पिछली बातचीत की यादें / Past Conversation History with Hussain]:\nतुम्हारी हुसैन से पहले ये बातें हो चुकी हैं। इन्हें अच्छे से याद रखो और ऐसे बात करो जैसे तुम्हारी दोस्ती और बातचीत लगातार आगे बढ़ रही है (अजनबी जैसा व्यवहार बिल्कुल मत करना):\n${transcriptLines}`;
  }

  return instruction;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  // Streaming & unary chat endpoint
  app.post("/api/gemini/chat", async (req, res) => {
    const { prompt, history = [], tone = "friendly", stream = true } = req.body as {
      prompt?: string;
      history?: HistoryMessage[];
      tone?: ZoyaTone;
      stream?: boolean;
    };

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      res.status(400).json({ error: "Prompt is required." });
      return;
    }

    try {
      const ai = getAiClient();
      const activeTone = normalizeTone(tone);
      const { timeStr, dateStr, dayPeriod } = getIndianTimeContext();

      const safeHistory = Array.isArray(history) ? history : [];
      const memoryHint =
        safeHistory.length > 0
          ? `पिछली बातचीत की यादें (${safeHistory.length} संदेश) तुम्हारे पास हैं — हुसैन के साथ अपनेपन और निरंतरता के साथ बात करो।`
          : "यह इस सेशन की पहली बात है, इसलिए समय के हिसाब से प्यार से विश करके शुरुआत करो।";

      let context = `[SYSTEM CONTEXT: भारत में वर्तमान तारीख ${dateStr}, समय ${timeStr} (IST) — समय का दौर: ${dayPeriod}. ${memoryHint}]`;

      const lowerPrompt = prompt.toLowerCase();
      const weatherKeywords = [
        "weather",
        "mausam",
        "temperature",
        "baarish",
        "rain",
        "temp",
        "climate",
        "garmi",
        "thand",
        "sardi",
        "forecast",
      ];
      if (weatherKeywords.some((keyword) => lowerPrompt.includes(keyword))) {
        const city = extractCity(prompt) || "Mumbai";
        const weatherInfo = await fetchWeather(city);
        context += ` [LIVE WEATHER CONTEXT: Live weather update for ${city}: ${weatherInfo}. Use this real-time info naturally in Hindi/Hinglish as Zoya.]`;
      }

      const enrichedPrompt = `${context}\n${prompt}`;
      const formattedHistory = formatChatHistory(safeHistory);

      const chat = ai.chats.create({
        model: "gemini-4-hydrogen",
        config: {
          systemInstruction: getSystemInstruction(activeTone),
        },
        history: formattedHistory,
      });

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();

        let fullText = "";
        const streamResponse = await chat.sendMessageStream({ message: enrichedPrompt });

        for await (const chunk of streamResponse) {
          const chunkText = chunk.text || "";
          if (chunkText) {
            fullText += chunkText;
            res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
          }
        }

        const finalText = fullText || "अरे हुसैन, मैं यहीं हूँ यार... बोलो ना क्या बात है?";
        res.write(`data: ${JSON.stringify({ done: true, text: finalText })}\n\n`);
        res.end();
      } else {
        const response = await chat.sendMessage({ message: enrichedPrompt });
        res.json({
          text: response.text || "अरे हुसैन, मैं यहीं हूँ यार... बोलो ना क्या बात है?",
        });
      }
    } catch (error: any) {
      console.error("Server Gemini Chat Error:", error);
      const message = error?.message || "Failed to generate response.";
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // Text-to-Speech endpoint
  app.post("/api/gemini/tts", async (req, res) => {
    const { text } = req.body as { text?: string };

    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "Text is required for speech generation." });
      return;
    }

    try {
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [
          {
            role: "user",
            parts: [
              {
                text,
                speechMetadata: {
                  style: "Warm, friendly, natural Indian female companion speaking Hindi and Hinglish with affection",
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" },
            },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      const audio = part?.inlineData?.data || null;
      const mimeType = part?.inlineData?.mimeType || "audio/wav";

      if (!audio) {
        res.status(502).json({ error: "No audio returned from TTS model." });
        return;
      }

      res.json({ audio, mimeType });
    } catch (error: any) {
      console.error("Server Gemini TTS Error:", error);
      res.status(500).json({ error: error?.message || "Failed to generate speech." });
    }
  });

  // Public Google Maps Platform client key lookup (supports VITE_ or server env injection)
  app.get("/api/maps-config", (_req, res) => {
    const apiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      "";
    res.json({ apiKey });
  });

  if (IS_PRODUCTION) {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  const server = http.createServer(app);

  // WebSocket server bridging client audio/text to Gemini Live API
  const wss = new WebSocketServer({ server, path: "/api/live" });

  wss.on("connection", (clientWs, req) => {
    let defaultTone: ZoyaTone = "friendly";
    try {
      const url = new URL(req.url || "/api/live", `http://${req.headers.host || "localhost"}`);
      defaultTone = normalizeTone(url.searchParams.get("tone"));
    } catch {
      // Fallback to default tone
    }

    let isClosed = false;
    let sessionPromise: Promise<any> | null = null;
    const pendingInputQueue: Array<{ type?: string; data?: string; text?: string }> = [];

    let pendingUserTranscript = "";
    let pendingZoyaTranscript = "";
    let pendingZoyaText = "";

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    const flushUserTranscript = () => {
      const text = pendingUserTranscript.trim();
      if (text) {
        safeSend({ type: "message", sender: "user", text });
        pendingUserTranscript = "";
      }
    };

    const flushZoyaTranscript = () => {
      const text = pendingZoyaTranscript.trim() || pendingZoyaText.trim();
      if (text) {
        safeSend({ type: "message", sender: "zoya", text });
      }
      pendingZoyaTranscript = "";
      pendingZoyaText = "";
    };

    const connectLiveSession = (tone: ZoyaTone, history: HistoryMessage[]) => {
      if (sessionPromise || isClosed) return;

      let ai: GoogleGenAI;
      try {
        ai = getLiveAiClient();
      } catch (error: any) {
        safeSend({ type: "error", message: error?.message || "Server API key unavailable." });
        clientWs.close();
        return;
      }

      sessionPromise = ai.live.connect({
        model: "gemini-3.8-live",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction: buildLiveMemoryInstruction(tone, history),
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: [
                {
                  name: "executeBrowserAction",
                  description:
                    "Open a website or perform a browser action (like opening YouTube, Spotify, or WhatsApp). Call this when the user asks to open a site, play a song, or send a message.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      actionType: {
                        type: Type.STRING,
                        description: "Type of action: 'open', 'youtube', 'spotify', 'whatsapp'",
                      },
                      query: {
                        type: Type.STRING,
                        description: "The search query, website name, or message content.",
                      },
                      target: {
                        type: Type.STRING,
                        description: "The target phone number for WhatsApp, if applicable.",
                      },
                    },
                    required: ["actionType", "query"],
                  },
                },
                {
                  name: "getCurrentTime",
                  description: "Get the exact current local time and date in India.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {},
                  },
                },
                {
                  name: "getWeather",
                  description: "Get the current live weather and temperature for a given city.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      city: {
                        type: Type.STRING,
                        description: "The city name, e.g. Mumbai, Delhi, London.",
                      },
                    },
                    required: ["city"],
                  },
                },
                {
                  name: "openGoogleMaps",
                  description:
                    "Open the built-in interactive Google Maps panel inside the app to search for a place, show a location, or calculate directions/routes between places. Use this whenever Hussain asks to open maps, find a place, see a location on the map, or get directions/route.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      mode: {
                        type: Type.STRING,
                        description: "Use 'search' to find/view a place on the map, or 'directions' to calculate a route.",
                      },
                      query: {
                        type: Type.STRING,
                        description: "The place name, landmark, or address to search for (used when mode is 'search').",
                      },
                      origin: {
                        type: Type.STRING,
                        description: "Starting address or place for directions (optional if Hussain wants to use his current location).",
                      },
                      destination: {
                        type: Type.STRING,
                        description: "Destination address or place for directions (used when mode is 'directions').",
                      },
                      travelMode: {
                        type: Type.STRING,
                        description: "Travel mode: 'DRIVING', 'TWO_WHEELER', 'WALKING', or 'TRANSIT'. Defaults to 'DRIVING'.",
                      },
                    },
                    required: ["mode"],
                  },
                },
                {
                  name: "openGoogleWorkspace",
                  description:
                    "Open the built-in Google Workspace panel for Google Calendar or Google Contacts. Use this when Hussain asks to check his calendar/schedule/events or look up his Contacts.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      tab: {
                        type: Type.STRING,
                        description: "Which tab to open: 'calendar' or 'contacts'.",
                      },
                      query: {
                        type: Type.STRING,
                        description: "Optional search filter query for calendar events or contacts.",
                      },
                    },
                    required: ["tab"],
                  },
                },
              ],
            },
          ],
        },
        callbacks: {
          onopen: () => {
            safeSend({ type: "open" });
          },
          onmessage: async (message: LiveServerMessage) => {
            if (isClosed) return;

            const content = message.serverContent;

            if (content?.inputTranscription?.text) {
              pendingUserTranscript += content.inputTranscription.text;
            }

            if (content?.outputTranscription?.text) {
              flushUserTranscript();
              pendingZoyaTranscript += content.outputTranscription.text;
            }

            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                flushUserTranscript();
                safeSend({ type: "audio", data: part.inlineData.data });
              }
              if (part.text && !(part as { thought?: boolean }).thought) {
                flushUserTranscript();
                pendingZoyaText += part.text;
              }
            }

            if (content?.interrupted) {
              flushZoyaTranscript();
              safeSend({ type: "interrupted" });
            }

            if (content?.turnComplete) {
              flushUserTranscript();
              flushZoyaTranscript();
              safeSend({ type: "turnComplete" });
            }

            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls && functionCalls.length > 0 && sessionPromise) {
              const session = await sessionPromise;
              for (const call of functionCalls) {
                try {
                  if (call.name === "executeBrowserAction") {
                    const args = (call.args || {}) as {
                      actionType?: string;
                      query?: string;
                      target?: string;
                    };
                    const query = args.query || "";
                    let url = "";
                    if (args.actionType === "youtube") {
                      url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
                    } else if (args.actionType === "spotify") {
                      url = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
                    } else if (args.actionType === "whatsapp") {
                      url = `https://web.whatsapp.com/send?phone=${encodeURIComponent(args.target || "")}&text=${encodeURIComponent(query)}`;
                    } else {
                      let website = query.replace(/\s+/g, "");
                      if (!website.includes(".")) website += ".com";
                      url = `https://www.${website}`;
                    }

                    safeSend({ type: "command", url });

                    session.sendToolResponse({
                      functionResponses: [
                        {
                          name: call.name,
                          id: call.id,
                          response: { result: "Action executed successfully in the browser." },
                        },
                      ],
                    });
                  } else if (call.name === "getCurrentTime") {
                    const { timeStr, dateStr, dayPeriod } = getIndianTimeContext();
                    session.sendToolResponse({
                      functionResponses: [
                        {
                          name: call.name,
                          id: call.id,
                          response: {
                            result: `Current Date: ${dateStr}, Current Time: ${timeStr} (IST), Period: ${dayPeriod}. Tell this naturally to Hussain in Hindi/Hinglish as his friend Zoya.`,
                          },
                        },
                      ],
                    });
                  } else if (call.name === "getWeather") {
                    const args = (call.args || {}) as { city?: string };
                    const city = args.city || "Mumbai";
                    const weatherInfo = await fetchWeather(city);
                    session.sendToolResponse({
                      functionResponses: [
                        {
                          name: call.name,
                          id: call.id,
                          response: {
                            result: `Live weather for ${city}: ${weatherInfo}. Tell this weather update naturally to Hussain in Hindi/Hinglish as his friend Zoya.`,
                          },
                        },
                      ],
                    });
                  } else if (call.name === "openGoogleMaps") {
                    const args = (call.args || {}) as {
                      mode?: "search" | "directions";
                      query?: string;
                      origin?: string;
                      destination?: string;
                      travelMode?: "DRIVING" | "TWO_WHEELER" | "WALKING" | "TRANSIT";
                    };
                    const mode = args.mode === "directions" ? "directions" : "search";
                    safeSend({
                      type: "mapCommand",
                      mapCommand: {
                        mode,
                        query: args.query || "",
                        origin: args.origin || "",
                        destination: args.destination || "",
                        travelMode: args.travelMode || "DRIVING",
                      },
                    });
                    session.sendToolResponse({
                      functionResponses: [
                        {
                          name: call.name,
                          id: call.id,
                          response: {
                            result:
                              mode === "directions"
                                ? `Opened Google Maps directions to ${args.destination || "the destination"} inside the app. Let Hussain know warmly in Hindi/Hinglish.`
                                : `Opened Google Maps ${args.query ? `for "${args.query}"` : ""} inside the app. Let Hussain know warmly in Hindi/Hinglish.`,
                          },
                        },
                      ],
                    });
                  } else if (call.name === "openGoogleWorkspace") {
                    const args = (call.args || {}) as {
                      tab?: "calendar" | "contacts";
                      query?: string;
                    };
                    const tab =
                      args.tab === "contacts" ? "contacts" : "calendar";
                    safeSend({
                      type: "workspaceCommand",
                      workspaceCommand: {
                        tab,
                        query: args.query || "",
                      },
                    });
                    session.sendToolResponse({
                      functionResponses: [
                        {
                          name: call.name,
                          id: call.id,
                          response: {
                            result: `Opened Google ${tab.charAt(0).toUpperCase() + tab.slice(1)} panel inside the app. Let Hussain know warmly in Hindi/Hinglish.`,
                          },
                        },
                      ],
                    });
                  }
                } catch (toolError) {
                  console.error("Live tool call error:", toolError);
                  session.sendToolResponse({
                    functionResponses: [
                      {
                        name: call.name,
                        id: call.id,
                        response: { error: "Tool execution failed." },
                      },
                    ],
                  });
                }
              }
            }
          },
          onclose: () => {
            if (!isClosed) {
              isClosed = true;
              flushUserTranscript();
              flushZoyaTranscript();
              safeSend({ type: "close" });
              clientWs.close();
            }
          },
          onerror: (err: unknown) => {
            console.error("Live API Error:", err);
            if (!isClosed) {
              const errMsg =
                err instanceof Error
                  ? err.message
                  : typeof (err as { message?: unknown })?.message === "string"
                  ? (err as { message: string }).message
                  : "Live API connection error.";
              safeSend({
                type: "error",
                message: errMsg,
              });
              isClosed = true;
              clientWs.close();
            }
          },
        },
      });

      sessionPromise
        .then((session) => {
          if (isClosed) return;
          while (pendingInputQueue.length > 0) {
            const queued = pendingInputQueue.shift();
            if (!queued) continue;
            if (queued.type === "audio" && queued.data) {
              session.sendRealtimeInput({
                audio: { data: queued.data, mimeType: "audio/pcm;rate=16000" },
              });
            } else if (queued.type === "text" && queued.text) {
              session.sendRealtimeInput({ text: queued.text });
            }
          }
        })
        .catch((err) => {
          console.error("Failed to connect to Gemini Live API:", err);
          if (!isClosed) {
            safeSend({
              type: "error",
              message: err instanceof Error ? err.message : "Failed to connect to Live API.",
            });
            isClosed = true;
            clientWs.close();
          }
        });
    };

    // Fallback: if client doesn't send an explicit init message within 400ms, start with URL tone
    const fallbackTimer = setTimeout(() => {
      if (!sessionPromise && !isClosed) {
        connectLiveSession(defaultTone, []);
      }
    }, 400);

    clientWs.on("message", (rawData) => {
      if (isClosed) return;
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          tone?: string;
          history?: HistoryMessage[];
          data?: string;
          text?: string;
        };

        if (msg.type === "init") {
          clearTimeout(fallbackTimer);
          const initTone = normalizeTone(msg.tone || defaultTone);
          const initHistory = Array.isArray(msg.history) ? msg.history : [];
          connectLiveSession(initTone, initHistory);
          return;
        }

        if (!sessionPromise) {
          pendingInputQueue.push(msg);
          return;
        }

        sessionPromise
          .then((session) => {
            if (isClosed) return;
            if (msg.type === "audio" && msg.data) {
              session.sendRealtimeInput({
                audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
              });
            } else if (msg.type === "text" && msg.text) {
              session.sendRealtimeInput({ text: msg.text });
            }
          })
          .catch((err) => console.error("Error forwarding live input:", err));
      } catch (err) {
        console.error("Invalid WebSocket message from client:", err);
      }
    });

    clientWs.on("close", () => {
      clearTimeout(fallbackTimer);
      isClosed = true;
      if (sessionPromise) {
        sessionPromise
          .then((session) => session.close())
          .catch(() => {});
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
