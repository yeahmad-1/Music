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

    return null;
  }

  /**
   * Resolve audio stream URL and video title.
   */
  static async resolveAudio(url: string): Promise<YoutubeAudioResult> {
    const videoId = this.extractVideoId(url);
    if (!videoId) {
      throw new Error('Invalid YouTube URL. Please paste a valid YouTube video or shorts link.');
    }

    const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let lastError: any = null;

    // Strategy 1: Cobalt API (fastest and cleanest MP3 audio extraction)
    const cobaltInstances = [
      'https://api.cobalt.tools',
      'https://cobalt-api.kwiatekm.tokyo',
      'https://cobalt.xy2401.com',
    ];

    for (const endpoint of cobaltInstances) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 9000);

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: fullUrl,
            downloadMode: 'audio',
            audioFormat: 'mp3',
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && (data.url || (data.status === 'stream' && data.url) || (data.status === 'tunnel' && data.url))) {
            return {
              title: data.filename ? data.filename.replace(/\.[^/.]+$/, '') : `YouTube Audio - ${videoId}`,
              streamUrl: data.url,
              videoId,
            };
          }
        }
      } catch (err) {
        lastError = err;
      }
    }

    // Strategy 2: Piped API audio stream instances
    const pipedInstances = [
      'https://pipedapi.kavin.rocks',
      'https://api.piped.privacydev.net',
      'https://piped-api.lunar.icu',
    ];

    for (const base of pipedInstances) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const res = await fetch(`${base}/streams/${videoId}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.audioStreams && data.audioStreams.length > 0) {
            // Pick highest quality audio stream
            const sorted = data.audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
            const bestStream = sorted[0];
            return {
              title: data.title || `YouTube Audio - ${videoId}`,
              streamUrl: bestStream.url,
              videoId,
            };
          }
        }
      } catch (err) {
        lastError = err;
      }
    }

    // Strategy 3: Invidious API audio streams
    const invidiousInstances = [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://vid.puffyan.us',
    ];

    for (const base of invidiousInstances) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);

        const res = await fetch(`${base}/api/v1/videos/${videoId}`, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.adaptiveFormats) {
            const audioFormats = data.adaptiveFormats.filter((f: any) => f.type && f.type.startsWith('audio/'));
            if (audioFormats.length > 0) {
              const bestAudio = audioFormats[0];
              return {
                title: data.title || `YouTube Audio - ${videoId}`,
                streamUrl: bestAudio.url,
                videoId,
              };
            }
          }
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(lastError?.message || 'Could not extract audio stream from this video. Please verify the URL.');
  }
}
