import type { ZoyaTone } from "../utils/personalityUtils";
import type { MapCommandPayload } from "../types/maps";
import type { WorkspaceCommandPayload } from "../types/workspace";

interface LiveServerEvent {
  type:
    | "open"
    | "audio"
    | "interrupted"
    | "message"
    | "command"
    | "mapCommand"
    | "workspaceCommand"
    | "turnComplete"
    | "error"
    | "close";
  data?: string;
  sender?: "user" | "zoya";
  text?: string;
  url?: string;
  mapCommand?: MapCommandPayload;
  workspaceCommand?: WorkspaceCommandPayload;
  message?: string;
}

export interface LiveHistoryItem {
  sender: "user" | "zoya";
  text: string;
  timestamp?: number;
}

export class LiveSessionManager {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  // Audio playback state
  private playbackContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private isPlaying: boolean = false;
  private isStopped: boolean = false;
  public isMuted: boolean = false;
  public tone: ZoyaTone = "friendly";
  private history: LiveHistoryItem[] = [];

  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onMessage: (sender: "user" | "zoya", text: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};
  public onMapCommand: (cmd: MapCommandPayload) => void = () => {};
  public onWorkspaceCommand: (cmd: WorkspaceCommandPayload) => void = () => {};

  constructor(tone: ZoyaTone = "friendly", history: LiveHistoryItem[] = []) {
    this.tone = tone;
    this.history = history;
  }

  async start() {
    this.isStopped = false;
    this.onStateChange("processing");

    try {
      // Initialize Audio Contexts (16kHz input, 24kHz output)
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;

      // Get Microphone (throws if blocked/denied so caller can show PermissionModal)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.isStopped) return;

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < pcm16.length; i++) {
          view.setInt16(i * 2, pcm16[i], true);
        }

        let binary = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        this.ws.send(JSON.stringify({ type: "audio", data: base64Data }));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Connect to server WebSocket proxy for Gemini Live API
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/live?tone=${encodeURIComponent(this.tone)}`;

      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        this.ws = ws;
        let settled = false;

        ws.onopen = () => {
          ws.send(
            JSON.stringify({
              type: "init",
              tone: this.tone,
              history: this.history.slice(-25),
            })
          );
          if (!settled) {
            settled = true;
            resolve();
          }
        };

        ws.onmessage = (event) => {
          if (this.isStopped) return;
          try {
            const msg = JSON.parse(event.data) as LiveServerEvent;

            switch (msg.type) {
              case "open":
                this.onStateChange("listening");
                break;
              case "audio":
                if (msg.data) {
                  this.onStateChange("speaking");
                  this.playAudioChunk(msg.data);
                }
                break;
              case "interrupted":
                this.stopPlayback();
                this.onStateChange("listening");
                break;
              case "message":
                if (msg.sender && msg.text) {
                  this.onMessage(msg.sender, msg.text);
                }
                break;
              case "command":
                if (msg.url) {
                  this.onCommand(msg.url);
                }
                break;
              case "mapCommand":
                if (msg.mapCommand) {
                  this.onMapCommand(msg.mapCommand);
                }
                break;
              case "workspaceCommand":
                if (msg.workspaceCommand) {
                  this.onWorkspaceCommand(msg.workspaceCommand);
                }
                break;
              case "turnComplete":
                if (!this.isPlaying) {
                  this.onStateChange("listening");
                }
                break;
              case "error":
                console.error("Live API Error:", msg.message);
                this.stop();
                break;
              case "close":
                this.stop();
                break;
            }
          } catch (err) {
            console.error("Failed to parse server live message:", err);
          }
        };

        ws.onerror = (err) => {
          console.error("WebSocket Live Error:", err);
          if (!settled) {
            settled = true;
            reject(new Error("Failed to connect to live session."));
          } else {
            this.stop();
          }
        };

        ws.onclose = () => {
          if (!settled) {
            settled = true;
            reject(new Error("Live session closed before opening."));
          } else if (!this.isStopped) {
            this.stop();
          }
        };
      });
    } catch (error) {
      console.error("Failed to start Live Session:", error);
      this.stop();
      throw error;
    }
  }

  private playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.isMuted || this.isStopped) return;

    try {
      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const buffer = new Int16Array(bytes.buffer);
      const audioBuffer = this.playbackContext.createBuffer(1, buffer.length, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < buffer.length; i++) {
        channelData[i] = buffer[i] / 32768.0;
      }

      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);

      const currentTime = this.playbackContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }

      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      this.isPlaying = true;

      source.onended = () => {
        if (
          !this.isStopped &&
          this.playbackContext &&
          this.playbackContext.currentTime >= this.nextPlayTime - 0.1
        ) {
          this.isPlaying = false;
          this.onStateChange("listening");
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
    }
  }

  private stopPlayback() {
    if (this.playbackContext) {
      if (this.playbackContext.state !== "closed") {
        this.playbackContext.close().catch(() => {});
      }
      if (!this.isStopped) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
        this.nextPlayTime = this.playbackContext.currentTime;
      } else {
        this.playbackContext = null;
      }
      this.isPlaying = false;
    }
  }

  stop() {
    if (this.isStopped) return;
    this.isStopped = true;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      if (this.audioContext.state !== "closed") {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }

    this.stopPlayback();

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    this.onStateChange("idle");
  }

  sendText(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.isStopped) {
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }
}
