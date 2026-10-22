/**
 * Service to resolve audio stream URLs and titles from YouTube links.
 * Backed by yt-dlp + ffmpeg backend with automatic fallback endpoints.
 */

export interface YoutubeAudioResult {
  title: string;
  streamUrl: string;
  directUrl?: string;
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

    // query param id=ID
    const idParam = cleanUrl.match(/[?&]id=([a-zA-Z0-9_-]{11})/);
    if (idParam && idParam[1]) return idParam[1];

    return null;
  }

  /**
   * Determine available backend API endpoints with multi-tier fallback.
   * Works on localhost:8081 (Expo web), localhost:3000 (node server),
   * Render production deployment, and mobile native apps.
   */
  static getApiBaseUrls(): string[] {
    const urls: string[] = [];
    if (typeof window !== 'undefined' && window.location) {
      const port = window.location.port;
      const hostname = window.location.hostname;
      const origin = window.location.origin;

      // 1. If currently loaded directly on port 3000 or on Render / custom domain
      if (port === '3000' || (!port && hostname !== 'localhost' && hostname !== '127.0.0.1')) {
        urls.push(origin);
      } else {
        // 2. Running on Expo dev server (port 8081 or 19006):
        // Try local node server on port 3000 first
        urls.push('http://localhost:3000');
        // If testing on LAN phone, try same host on port 3000
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
          urls.push(`http://${hostname}:3000`);
        }
      }
      // Always include production cloud backend as fallback
      urls.push('https://music-hlq1.onrender.com');
    } else {
      // Native iOS / Android
      urls.push('http://localhost:3000');
      urls.push('https://music-hlq1.onrender.com');
    }

    // Deduplicate preserving order
    return Array.from(new Set(urls.filter(Boolean)));
  }

  /**
   * Generate an absolute proxy URL for a YouTube video track.
   */
  static getProxyUrl(videoId: string): string {
    const bases = this.getApiBaseUrls();
    const primary = bases[0] || 'http://localhost:3000';
    return `${primary}/api/proxy-audio?id=${videoId}`;
  }

  /**
   * Return candidate proxy URLs across all backend endpoints for failover.
   */
  static getCandidateProxyUrls(videoId: string): string[] {
    const bases = this.getApiBaseUrls();
    return bases.map(base => `${base}/api/proxy-audio?id=${videoId}`);
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
    const baseCandidates = this.getApiBaseUrls();

    let lastError: any = null;

    // Try server endpoints (local node backend, then Render cloud backend)
    for (const base of baseCandidates) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(`${base}/api/youtube?url=${encodeURIComponent(fullUrl)}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success && data.streamUrl) {
          const streamUrl = data.streamUrl.startsWith('/') ? `${base}${data.streamUrl}` : data.streamUrl;
          return {
            title: data.title || `YouTube Audio - ${videoId}`,
            streamUrl,
            directUrl: streamUrl,
            videoId: data.videoId || videoId,
          };
        } else if (data && data.error) {
          lastError = new Error(data.error);
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    throw new Error(
      lastError?.message ||
      'Could not extract audio from this YouTube video. Please make sure the backend server (port 3000) is running.'
    );
  }
}
