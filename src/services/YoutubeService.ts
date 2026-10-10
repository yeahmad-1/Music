/**
 * Service to resolve audio stream URLs and titles from YouTube links.
 * Uses a multi-instance fallback (Cobalt API, Invidious, and Piped) to guarantee high availability.
 */

export interface YoutubeAudioResult {
  title: string;
  streamUrl: string;
  videoId: string;
}

export class YoutubeService {
  /**
   * Extract video ID from various YouTube link formats:
   * - https://www.youtube.com/watch?v=...
   * - https://youtu.be/...
   * - https://www.youtube.com/shorts/...
   * - https://music.youtube.com/watch?v=...
   */
  static extractVideoId(url: string): string | null {
    if (!url) return null;
    const cleanUrl = url.trim();

    // youtu.be/ID
    const shortMatch = cleanUrl.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (shortMatch && shortMatch[1]) return shortMatch[1];

    // watch?v=ID
    const watchMatch = cleanUrl.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (watchMatch && watchMatch[1]) return watchMatch[1];

    // shorts/ID
    const shortsMatch = cleanUrl.match(/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

    // embed/ID
    const embedMatch = cleanUrl.match(/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch && embedMatch[1]) return embedMatch[1];

    // raw 11-char video ID
    const directMatch = cleanUrl.match(/^([a-zA-Z0-9_-]{11})$/);
    if (directMatch && directMatch[1]) return directMatch[1];

    return null;
  }

  /**
   * Resolve audio stream URL and video title.
   */
  static async resolveAudio(url: string): Promise<YoutubeAudioResult> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL or ID. Please paste a valid YouTube track link.');
    }

    const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // On Web (browser): Always use the backend API endpoint to prevent browser CORS blocks!
    if (typeof window !== 'undefined') {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000);
      try {
        const res = await fetch(`/api/youtube?url=${encodeURIComponent(fullUrl)}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success && data.streamUrl) {
          return {
            title: data.title,
            streamUrl: data.streamUrl,
            videoId: data.videoId || videoId,
          };
        } else {
          throw new Error(data?.error || `Server extraction failed (status ${res.status})`);
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Audio extraction timed out. Please try again.');
        }
        throw new Error(err.message || 'Could not extract audio stream from this link. Please verify the URL.');
      }
    }

    // On Mobile (Platform.OS !== 'web'):
    // 1. Try server endpoint first
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000);
      const res = await fetch(`https://music-hlq1.onrender.com/api/youtube?url=${encodeURIComponent(fullUrl)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.success && data.streamUrl) {
        const streamUrl = data.streamUrl.startsWith('/')
          ? `https://music-hlq1.onrender.com${data.streamUrl}`
          : data.streamUrl;
        return {
          title: data.title,
          streamUrl,
          videoId: data.videoId || videoId,
        };
      }
    } catch (_) {}

    // 2. Direct mobile Invidious fallback
    const mobileInstances = [
      'https://invidious.f5.si',
      'https://invidious.nerdvpn.de',
      'https://yt.chocolatemoo53.com',
      'https://invidious.tiekoetter.com',
      'https://inv.nadeko.net'
    ];

    for (const base of mobileInstances) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const audioFormats = (data.adaptiveFormats || []).filter((f: any) => f.type && f.type.startsWith('audio/'));
          if (audioFormats.length > 0) {
            const m4a = audioFormats.find((f: any) => f.container === 'm4a' || f.type.includes('mp4') || f.itag === '140');
            const sorted = audioFormats.sort((a: any, b: any) => (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0));
            const best = m4a || sorted[0];
            return {
              title: data.title || `YouTube Audio - ${videoId}`,
              streamUrl: best.url,
              videoId,
            };
          }
        }
      } catch (_) {}
    }

    throw new Error('Could not extract audio stream from this video. Please verify the link.');
  }
}
