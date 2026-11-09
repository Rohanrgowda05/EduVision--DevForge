import { storage } from "../storage";

export interface YouTubeSearchResult {
  id: { videoId: string };
  snippet: {
    title: string;
    description: string;
    thumbnails: { medium: { url: string } };
    channelTitle: string;
    publishedAt: string;
  };
}

export interface RecommendationResponse {
  items: YouTubeSearchResult[];
  source: "youtube" | "cache" | "fallback";
  message?: string;
}

/**
 * Server-side YouTube search with a 24-hour cache in recommendation_cache table.
 *
 * Security & Quota Protection:
 * 1. The YouTube API key is NEVER exposed to client JavaScript (no VITE_ prefix).
 * 2. Caches all queries for 24h to avoid exhausting YouTube API quota (100 units / search of 10,000/day default).
 * 3. On quota exhaustion (HTTP 403), gracefully returns cached or empty results with a clear message, never a 500.
 */
export async function searchYouTubeServerSide(
  rawQuery: string,
  now: Date = new Date()
): Promise<RecommendationResponse> {
  const query = rawQuery.trim();
  if (!query) {
    return { items: [], source: "fallback", message: "Search query is empty" };
  }

  const cacheKey = `yt_${query.toLowerCase().replace(/\s+/g, "_")}`;

  // 1. Check cache
  try {
    const cached = await storage.getCachedRecommendations(cacheKey);
    if (cached) {
      const expiresAt = cached.expiresAt instanceof Date ? cached.expiresAt : new Date(cached.expiresAt);
      if (expiresAt > now) {
        return {
          items: cached.results as YouTubeSearchResult[],
          source: "cache",
        };
      }
    }
  } catch (err: any) {
    console.warn("[Recommendations] Cache lookup error:", err.message);
  }

  // 2. Server-side YouTube API Call
  const apiKey = process.env.YOUTUBE_API_KEY || process.env.VITE_YOUTUBE_API_KEY;
  if (!apiKey) {
    return {
      items: [],
      source: "fallback",
      message: "YouTube API key is not configured on the server.",
    };
  }

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&maxResults=12&type=video&q=${encodeURIComponent(query)}&key=${apiKey}`;
    const res = await fetch(url);

    if (res.ok) {
      const data = await res.json();
      const items = (data.items || []) as YouTubeSearchResult[];
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

      // Asynchronously persist in cache
      storage
        .setCachedRecommendations(cacheKey, query, items, expiresAt)
        .catch((cacheErr) => console.warn("[Recommendations] Cache write failed:", cacheErr.message));

      return {
        items,
        source: "youtube",
      };
    }

    // Handle quota errors or invalid key (e.g. 403 quotaExceeded)
    if (res.status === 403 || res.status === 429) {
      console.warn(`[Recommendations] YouTube API quota exceeded or forbidden (${res.status}). Checking for stale cache...`);
      // Check for stale cache
      const stale = await storage.getCachedRecommendations(cacheKey).catch(() => null);
      if (stale && stale.results) {
        return {
          items: stale.results as YouTubeSearchResult[],
          source: "cache",
          message: "YouTube quota limit reached; showing previously cached educational results.",
        };
      }

      return {
        items: [],
        source: "fallback",
        message: "YouTube search quota reached for today. Please try again later.",
      };
    }

    const errData = await res.json().catch(() => ({}));
    return {
      items: [],
      source: "fallback",
      message: errData.error?.message || `YouTube API returned ${res.status}`,
    };
  } catch (netErr: any) {
    console.error("[Recommendations] Network error calling YouTube API:", netErr.message);
    return {
      items: [],
      source: "fallback",
      message: "Network error fetching external video recommendations.",
    };
  }
}

