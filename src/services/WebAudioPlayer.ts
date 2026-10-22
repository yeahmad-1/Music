import { Platform } from 'react-native';

export interface WebAudioStatus {
  isLoaded: boolean;
  isPlaying: boolean;
  durationMillis: number;
  positionMillis: number;
  didJustFinish: boolean;
  isBuffering: boolean;
  rate?: number;
  volume?: number;
}

export interface MediaSessionActions {
  play: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (positionMs: number) => void;
}

/**
 * WebAudioPlayer: Singleton persistent audio controller for Web & Mobile Browsers.
 *
 * KEY ARCHITECTURE:
 * 1. Maintains ONE persistent HTMLAudioElement throughout the web app lifecycle.
 *    Reusing the same element prevents mobile browsers (Chrome on Android, Safari on iOS)
 *    from blocking autoplay on track transitions when the screen is locked or tab is in background.
 * 2. Directly integrates W3C navigator.mediaSession for lockscreen controls, notification drawer
 *    media widget, and preventing OS process freezing during background playback.
 * 3. Immediately triggers song transitions on native 'ended' DOM events with zero dead time.
 */
export class WebAudioPlayer {
  private static instance: WebAudioPlayer | null = null;
  private audio: HTMLAudioElement | null = null;
  private onStatusUpdate: ((status: WebAudioStatus) => void) | null = null;
  private onSongEnded: (() => void) | null = null;
  private currentSongInfo: { id: string; name: string; uri: string } | null = null;
  private mediaSessionActions: MediaSessionActions | null = null;
  private isEndedEmitted: boolean = false;

  private constructor() {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.initAudioElement();
    }
  }

  public static getInstance(): WebAudioPlayer {
    if (!WebAudioPlayer.instance) {
      WebAudioPlayer.instance = new WebAudioPlayer();
    }
    return WebAudioPlayer.instance;
  }

  private initAudioElement() {
    try {
      let existing = document.getElementById('offline-music-persistent-audio') as HTMLAudioElement | null;
      if (!existing) {
        existing = document.createElement('audio');
        existing.id = 'offline-music-persistent-audio';
        existing.preload = 'auto';
        existing.setAttribute('playsinline', 'true');
        existing.setAttribute('webkit-playsinline', 'true');
        existing.style.position = 'fixed';
        existing.style.bottom = '-9999px';
        existing.style.left = '-9999px';
        existing.style.width = '1px';
        existing.style.height = '1px';
        existing.style.opacity = '0';
        existing.style.pointerEvents = 'none';
        document.body.appendChild(existing);
      }

      this.audio = existing;

      // Native DOM Event Listeners
      this.audio.addEventListener('timeupdate', () => {
        this.emitStatus(false);
      });

      this.audio.addEventListener('play', () => {
        this.isEndedEmitted = false;
        this.emitStatus(false);
        this.updateMediaPlaybackState('playing');
      });

      this.audio.addEventListener('pause', () => {
        if (!this.audio?.ended) {
          this.emitStatus(false);
          this.updateMediaPlaybackState('paused');
        }
      });

      this.audio.addEventListener('ended', () => {
        if (this.isEndedEmitted) return;
        this.isEndedEmitted = true;
        this.emitStatus(true);
        this.updateMediaPlaybackState('paused');

        // Immediately notify AudioContext to start next track without delay
        if (this.onSongEnded) {
          this.onSongEnded();
        }
      });

      this.audio.addEventListener('loadedmetadata', () => {
        this.emitStatus(false);
      });

      this.audio.addEventListener('error', (e) => {
        console.warn('[WebAudioPlayer] Audio playback error event:', this.audio?.error, e);
      });
    } catch (err) {
      console.error('[WebAudioPlayer] Failed to initialize persistent audio element:', err);
    }
  }

  private emitStatus(didJustFinish: boolean) {
    if (!this.onStatusUpdate || !this.audio) return;
    const duration = isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration * 1000
      : 0;
    const position = isFinite(this.audio.currentTime) && this.audio.currentTime >= 0
      ? this.audio.currentTime * 1000
      : 0;

    const status: WebAudioStatus = {
      isLoaded: true,
      isPlaying: !this.audio.paused && !this.audio.ended,
      durationMillis: duration,
      positionMillis: position,
      didJustFinish,
      isBuffering: this.audio.readyState < 3 && !this.audio.paused && !this.audio.ended,
      rate: this.audio.playbackRate || 1,
      volume: this.audio.volume ?? 1,
    };

    this.onStatusUpdate(status);
  }

  public async loadAndPlay(
    uri: string,
    songInfo?: { id: string; name: string; uri: string },
    initialPositionMs: number = 0
  ): Promise<void> {
    if (!this.audio) {
      this.initAudioElement();
    }
    if (!this.audio) throw new Error('HTMLAudioElement not available on this platform');

    this.isEndedEmitted = false;
    if (songInfo) {
      this.currentSongInfo = songInfo;
    }

    // Reuse persistent audio element: swap source directly
    const currentSrc = this.audio.src;
    const isSameSource = currentSrc === uri || (currentSrc && uri && currentSrc.endsWith(uri));

    if (!isSameSource) {
      this.audio.src = uri;
      this.audio.currentTime = initialPositionMs > 0 ? initialPositionMs / 1000 : 0;
      this.audio.load();
    } else if (initialPositionMs > 0) {
      this.audio.currentTime = initialPositionMs / 1000;
    }

    try {
      const playPromise = this.audio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      this.updateMediaPlaybackState('playing');
    } catch (err: any) {
      console.warn('[WebAudioPlayer] play() call was rejected or suspended:', err?.message);
      throw err;
    }
  }

  public async pause(): Promise<void> {
    if (this.audio) {
      this.audio.pause();
      this.updateMediaPlaybackState('paused');
    }
  }

  public async resume(): Promise<void> {
    if (this.audio) {
      const playPromise = this.audio.play();
      if (playPromise !== undefined) {
        await playPromise;
      }
      this.updateMediaPlaybackState('playing');
    }
  }

  public async replay(): Promise<void> {
    if (this.audio) {
      this.isEndedEmitted = false;
      this.audio.currentTime = 0;
      await this.resume();
    }
  }

  public async seek(positionMs: number): Promise<void> {
    if (this.audio) {
      const targetSec = Math.max(0, positionMs / 1000);
      this.audio.currentTime = targetSec;
      this.emitStatus(false);
    }
  }

  public async unload(): Promise<void> {
    if (this.audio) {
      this.audio.pause();
      // Keep src intact or reset without destroying element
      this.updateMediaPlaybackState('none');
    }
  }

  public getStatus(): WebAudioStatus {
    if (!this.audio) {
      return {
        isLoaded: false,
        isPlaying: false,
        durationMillis: 0,
        positionMillis: 0,
        didJustFinish: false,
        isBuffering: false,
      };
    }
    const duration = isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration * 1000
      : 0;
    const position = isFinite(this.audio.currentTime) && this.audio.currentTime >= 0
      ? this.audio.currentTime * 1000
      : 0;

    return {
      isLoaded: true,
      isPlaying: !this.audio.paused && !this.audio.ended,
      durationMillis: duration,
      positionMillis: position,
      didJustFinish: this.audio.ended,
      isBuffering: this.audio.readyState < 3 && !this.audio.paused && !this.audio.ended,
      rate: this.audio.playbackRate || 1,
      volume: this.audio.volume ?? 1,
    };
  }

  public setOnPlaybackStatusUpdate(callback: ((status: WebAudioStatus) => void) | null) {
    this.onStatusUpdate = callback;
    if (callback) {
      this.emitStatus(false);
    }
  }

  public setOnSongEnded(callback: (() => void) | null) {
    this.onSongEnded = callback;
  }

  // --- W3C MediaSession Integration ---

  public setMediaSessionActions(actions: MediaSessionActions) {
    this.mediaSessionActions = actions;
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    try {
      navigator.mediaSession.setActionHandler('play', () => {
        actions.play();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        actions.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        actions.previous();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        actions.next();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) {
          actions.seek(details.seekTime * 1000);
        }
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        actions.pause();
      });
    } catch (e) {
      console.warn('[WebAudioPlayer] Error binding mediaSession action handlers:', e);
    }
  }

  public updateMediaMetadata(song: { name: string; source?: string } | null) {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    if (!song) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
      return;
    }

    try {
      const isYt = song.source === 'youtube';
      navigator.mediaSession.metadata = new (window as any).MediaMetadata({
        title: song.name || 'Unknown Track',
        artist: isYt ? 'YouTube Audio' : 'Offline Music',
        album: 'My Playlist',
        artwork: [
          { src: '/icon.png', sizes: '512x512', type: 'image/png' },
          { src: '/assets/icon.png', sizes: '192x192', type: 'image/png' },
        ],
      });
    } catch (err) {
      console.warn('[WebAudioPlayer] Error updating MediaMetadata:', err);
    }
  }

  private updateMediaPlaybackState(state: 'playing' | 'paused' | 'none') {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = state;
    } catch (_) {}
  }
}

export const webAudioPlayer = WebAudioPlayer.getInstance();
