import type { MapCommandPayload } from "../types/maps";
import type { WorkspaceCommandPayload } from "../types/workspace";

export function processCommand(command: string): {
  action: string;
  url?: string;
  mapAction?: MapCommandPayload;
  workspaceAction?: WorkspaceCommandPayload;
  isBrowserAction: boolean;
} {
  const trimmed = command.trim();
  const lowerCmd = trimmed.toLowerCase();

  // Google Workspace shortcuts: Calendar, Contacts
  if (
    /^(?:open|show|check)\s+(?:my\s+)?(?:google\s+)?(?:calendar|schedule|events)\b/i.test(trimmed) ||
    trimmed.includes("कैलेंडर")
  ) {
    return {
      action: `लो हुसैन, तुम्हारा Google Calendar खोल रही हूँ यार!`,
      workspaceAction: { tab: "calendar" },
      isBrowserAction: true,
    };
  }

  if (
    /^(?:open|show|check)\s+(?:my\s+)?(?:google\s+)?contacts\b/i.test(trimmed) ||
    trimmed.includes("कॉन्टैक्ट्स")
  ) {
    return {
      action: `लो हुसैन, तुम्हारे Google Contacts खोल रही हूँ यार!`,
      workspaceAction: { tab: "contacts" },
      isBrowserAction: true,
    };
  }

  if (/^(?:open|show)\s+(?:google\s+)?workspace\b/i.test(trimmed)) {
    return {
      action: `लो हुसैन, तुम्हारा Google Workspace पैनल खोल दिया है यार!`,
      workspaceAction: { tab: "calendar" },
      isBrowserAction: true,
    };
  }

  // Directions: "directions from [origin] to [destination]" or "route from [origin] to [destination]"
  const dirFromToMatch = trimmed.match(/^(?:directions?|route|navigate)\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (dirFromToMatch) {
    const origin = dirFromToMatch[1].trim();
    const destination = dirFromToMatch[2].trim();
    return {
      action: `लो हुसैन, ${origin} से ${destination} का रास्ता Google Maps पर दिखा रही हूँ यार!`,
      mapAction: {
        mode: "directions",
        origin,
        destination,
        travelMode: "DRIVING",
      },
      isBrowserAction: true,
    };
  }

  // Directions to destination: "directions to [place]" / "navigate to [place]" / "route to [place]"
  const dirToMatch = trimmed.match(/^(?:directions?|route|navigate)(?:\s+to)?\s+(.+)$/i);
  if (dirToMatch && dirToMatch[1].trim()) {
    const destination = dirToMatch[1].trim();
    return {
      action: `चलो हुसैन, ${destination} का रास्ता यहीं Google Maps पर खोल रही हूँ!`,
      mapAction: {
        mode: "directions",
        destination,
        travelMode: "DRIVING",
      },
      isBrowserAction: true,
    };
  }

  // Map place search: "show [place] on map" / "find [place] on map" / "search [place] on map" / "locate [place]"
  const showOnMapMatch = trimmed.match(
    /^(?:show|find|search|locate)\s+(.+?)(?:\s+on\s+(?:google\s+)?maps?)?$/i
  );
  if (
    showOnMapMatch &&
    (lowerCmd.includes("map") || lowerCmd.startsWith("locate "))
  ) {
    const query = showOnMapMatch[1].trim();
    return {
      action: `ये लो हुसैन, ${query} को Google Maps पर ढूँढ दिया है यार!`,
      mapAction: {
        mode: "search",
        query,
      },
      isBrowserAction: true,
    };
  }

  // Direct open map command
  if (
    /^(?:open|show)\s+(?:google\s+)?maps?$/i.test(trimmed) ||
    trimmed === "नक्शा खोलो" ||
    trimmed === "मैप खोलो"
  ) {
    return {
      action: `लो हुसैन, तुम्हारे लिए यहीं Google Maps खोल दिया है यार! बताओ कहाँ चलना है?`,
      mapAction: {
        mode: "search",
        query: "",
      },
      isBrowserAction: true,
    };
  }

  // General Browsing: "Open [website name]"
  const openMatch = lowerCmd.match(/^open\s+(.+)$/);
  if (
    openMatch &&
    !lowerCmd.includes("youtube") &&
    !lowerCmd.includes("spotify")
  ) {
    let website = openMatch[1].trim().replace(/\s+/g, "");
    if (!website.includes(".")) {
      website += ".com";
    }
    return {
      action: `लो हुसैन, तुम्हारे लिए अभी ${openMatch[1]} खोल रही हूँ यार!`,
      url: `https://www.${website}`,
      isBrowserAction: true,
    };
  }

  // Media Search: "Play [song/video] on YouTube"
  const ytMatch = lowerCmd.match(/^play\s+(.+?)\s+on\s+youtube$/);
  if (ytMatch) {
    const query = encodeURIComponent(ytMatch[1].trim());
    return {
      action: `हुसैन, अभी YouTube पर ${ytMatch[1]} चला रही हूँ। चलो थोड़ा चिल करो यार!`,
      url: `https://www.youtube.com/results?search_query=${query}`,
      isBrowserAction: true,
    };
  }

  // Media Search: "Search [query] on Spotify"
  const spotifyMatch = lowerCmd.match(/^search\s+(.+?)\s+on\s+spotify$/);
  if (spotifyMatch) {
    const query = encodeURIComponent(spotifyMatch[1].trim());
    return {
      action: `दोस्त, Spotify पर ${spotifyMatch[1]} ढूँढ रही हूँ तुम्हारे लिए!`,
      url: `https://open.spotify.com/search/${query}`,
      isBrowserAction: true,
    };
  }

  // WhatsApp Web: "Send a WhatsApp message to [number] saying [message]"
  const waMatch = lowerCmd.match(
    /^send\s+a\s+whatsapp\s+message\s+to\s+([\d\+\s]+)\s+saying\s+(.+)$/,
  );
  if (waMatch) {
    const number = waMatch[1].replace(/\s+/g, "");
    const message = encodeURIComponent(waMatch[2].trim());
    return {
      action: `लो हुसैन, तुम्हारा WhatsApp मैसेज भेज रही हूँ यार!`,
      url: `https://web.whatsapp.com/send?phone=${number}&text=${message}`,
      isBrowserAction: true,
    };
  }

  return { action: "", isBrowserAction: false };
}
