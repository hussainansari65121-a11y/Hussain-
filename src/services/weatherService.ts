export const popularCities = [
  "mumbai", "delhi", "bangalore", "bengaluru", "kolkata", "chennai", "pune", "hyderabad", 
  "ahmedabad", "jaipur", "lucknow", "kanpur", "nagpur", "indore", "thane", "bhopal", 
  "patna", "vadodara", "ghaziabad", "ludhiana", "agra", "nashik", "ranchi", "faridabad", 
  "meerut", "rajkot", "kalyan", "vasai", "varanasi", "srinagar", "aurangabad", "dhanbad", 
  "amritsar", "navi mumbai", "allahabad", "howrah", "gwalior", "jabalpur", "coimbatore", 
  "vijayawada", "jodhpur", "madurai", "raipur", "kota", "chandigarh", "guwahati", 
  "solapur", "hubli", "dharwad", "bareilly", "moradabad", "mysore", "gurgaon", "noida", 
  "aligarh", "jalandhar", "tiruchirappalli", "bhubaneswar", "salem", "warangal", "guntur", 
  "dehradun", "london", "new york", "paris", "tokyo", "sydney", "dubai", "singapore"
];

export async function fetchWeather(city: string): Promise<string> {
  try {
    const response = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
    if (response.ok) {
      const data = await response.text();
      return data.trim();
    }
  } catch (e) {
    console.error("Weather fetch failed:", e);
  }
  return `Could not fetch weather for ${city}.`;
}

export function extractCity(prompt: string): string | null {
  const cleanPrompt = prompt.toLowerCase().replace(/[?,.!]/g, " ");
  
  // 1. Check our predefined popular cities list
  for (const city of popularCities) {
    if (cleanPrompt.includes(city)) {
      return city.charAt(0).toUpperCase() + city.slice(1);
    }
  }

  // 2. Look for patterns like "in <City>", "me <City>", "ka <City>", "of <City>"
  const patterns = [
    /\bin\s+([a-z]+)/i,
    /\bme\s+([a-z]+)/i,
    /\bmein\s+([a-z]+)/i,
    /\bka\s+([a-z]+)/i,
    /\bkaisa\s+hai\s+([a-z]+)\s+ka/i,
    /\bweather\s+([a-z]+)/i,
    /\bmausam\s+([a-z]+)/i
  ];

  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (match && match[1]) {
      const matchedWord = match[1].toLowerCase().trim();
      // Skip common stop words
      const stopWords = ["today", "now", "hai", "kaisa", "kya", "ko", "se", "aur", "ki", "ka"];
      if (!stopWords.includes(matchedWord)) {
        return matchedWord.charAt(0).toUpperCase() + matchedWord.slice(1);
      }
    }
  }

  return null;
}
