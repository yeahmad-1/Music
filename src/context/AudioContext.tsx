import React, { createContext, useState, useContext, useEffect, useRef, useMemo } from "react";
import { Platform } from "react-native";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { YoutubeService } from "../services/YoutubeService";
import { webAudioStorage } from "../services/WebAudioStorage";
import { webAudioPlayer } from "../services/WebAudioPlayer";

export interface Song {
  id: string;
  uri: string;
  name: string;
  isFavorite: boolean;
  addedAt?: number;
  source?: "local" | "youtube";
  sourceUrl?: string;
}

export interface CustomPlaylist {
  id: string;
  name: string;
  songIds: string[];
}

export interface DownloadTask {
  id: string;
  url: string;
  title: string;
  status: 'downloading' | 'completed' | 'error';
  errorMessage?: string;
  needsCookies?: boolean;
  startedAt: number;
  song?: Song;
}

type RepeatMode = "none" | "one" | "all";

interface AudioContextType {
  playlist: Song[];
  customPlaylists: CustomPlaylist[];
  currentSong: Song | null;
  isPlaying: boolean;
  playbackStatus: any;
  isShuffle: boolean;
  repeatMode: RepeatMode;
  downloadTasks: DownloadTask[];
  startBackgroundDownload: (url: string, customName?: string) => Promise<string>;
  dismissDownloadTask: (id: string) => void;
  retryDownloadTask: (id: string) => void;
  importSongs: (assets: any[]) => Promise<void>;
  downloadFromYoutube: (url: string, customName?: string) => Promise<{ success: boolean; message?: string; song?: Song }>;
  playSong: (song: Song, customQueue?: Song[]) => Promise<void>;
  pauseSong: () => Promise<void>;
  resumeSong: () => Promise<void>;
  nextSong: () => Promise<void>;
  previousSong: () => Promise<void>;
  deleteSong: (id: string) => Promise<void>;
  deleteSongsBulk: (ids: string[]) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setFavoritesBulk: (ids: string[], status: boolean) => Promise<void>;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  seek: (position: number) => Promise<void>;
  createCustomPlaylist: (name: string, songIds: string[]) => Promise<void>;
  deleteCustomPlaylist: (id: string) => Promise<void>;
  updateCustomPlaylistOrder: (playlistId: string, newSongIds: string[]) => Promise<void>;
  removeSongsFromCustomPlaylist: (playlistId: string, songIds: string[]) => Promise<void>;
  reorderSongs: (oldIndex: number, newIndex: number) => Promise<void>;
  updatePlaylistOrder: (newPlaylist: Song[]) => Promise<void>;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);
const PlaybackStatusContext = createContext<any>(null);

export const usePlaybackStatus = () => {
  return useContext(PlaybackStatusContext);
};

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [playlist, setPlaylist] = useState<Song[]>([]);
  const [customPlaylists, setCustomPlaylists] = useState<CustomPlaylist[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackStatus, setPlaybackStatus] = useState<any>(null);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("none");
  const [currentQueue, setCurrentQueue] = useState<Song[]>([]);
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);

  const soundRef = useRef<Audio.Sound | null>(null);

  // Use refs to avoid closure stale state in status updates
  const stateRef = useRef({ repeatMode, isShuffle, currentQueue, playlist, currentSong });
  useEffect(() => {
    stateRef.current = { repeatMode, isShuffle, currentQueue, playlist, currentSong };
  }, [repeatMode, isShuffle, currentQueue, playlist, currentSong]);

  const actionsRef = useRef<any>({});

  useEffect(() => {
    loadData();
    setupAudio();

    if (Platform.OS === 'web') {
      webAudioPlayer.setOnSongEnded(() => {
        handleSongFinished();
      });

      webAudioPlayer.setMediaSessionActions({
        play: () => actionsRef.current.resumeSong?.(),
        pause: () => actionsRef.current.pauseSong?.(),
        next: () => actionsRef.current.nextSong?.(),
        previous: () => actionsRef.current.previousSong?.(),
        seek: (posMs: number) => actionsRef.current.seek?.(posMs),
      });
    }

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      webAudioPlayer.updateMediaMetadata(currentSong);
    }
  }, [currentSong]);

  const setupAudio = async () => {
    try {
      if (Platform.OS !== 'web') {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          interruptionModeIOS: InterruptionModeIOS.DoNotMix,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
          playThroughEarpieceAndroid: false,
        });
      }
    } catch (error) {
      console.log("Error setting up audio mode:", error);
    }
  };

  const loadData = async () => {
    try {
      const savedPlaylist = await AsyncStorage.getItem("playlist");
      if (savedPlaylist) {
        const parsed: Song[] = JSON.parse(savedPlaylist);
        if (Platform.OS === 'web') {
          // Rehydrate blob URLs from IndexedDB for web
          const rehydrated = await Promise.all(
            parsed.map(async (song) => {
              try {
                const freshUrl = await webAudioStorage.getAudioUrl(song.id);
                if (freshUrl) {
                  return { ...song, uri: freshUrl };
                }
              } catch (e) {
                console.warn("Could not rehydrate audio for song", song.id, e);
              }

              // Resilience: If not found in IndexedDB, and song is from YouTube, prepare proxy URL fallback
              const videoId = song.sourceUrl
                ? YoutubeService.extractVideoId(song.sourceUrl)
                : (song.source === 'youtube' ? YoutubeService.extractVideoId(song.uri) : null);
              if (videoId) {
                return { ...song, uri: YoutubeService.getProxyUrl(videoId) };
              }
              return song;
            })
          );
          setPlaylist(rehydrated);
        } else {
          // iOS Sandbox Resilience:
          // On iOS, the sandbox container UUID changes across app reinstalls and updates.
          // If the stored URI no longer matches the current documentDirectory, update it.
          const docDir = FileSystem.documentDirectory || "";
          const updated = parsed.map(song => {
            if (docDir && song.uri) {
              const fileName = song.uri.split("/").pop();
              if (fileName && !song.uri.startsWith(docDir)) {
                return { ...song, uri: `${docDir}${fileName}` };
              }
            }
            return song;
          });
          setPlaylist(updated);
        }
      }
      const savedCustomPlaylists = await AsyncStorage.getItem("customPlaylists");
      if (savedCustomPlaylists) {
        setCustomPlaylists(JSON.parse(savedCustomPlaylists));
      }
    } catch (error) {
      console.error("Failed to load data", error);
    }
  };

  const savePlaylist = async (newPlaylist: Song[]) => {
    try {
      await AsyncStorage.setItem("playlist", JSON.stringify(newPlaylist));
    } catch (error) {
      console.error("Failed to save playlist", error);
    }
  };

  const saveCustomPlaylists = async (newPlaylists: CustomPlaylist[]) => {
    try {
      await AsyncStorage.setItem("customPlaylists", JSON.stringify(newPlaylists));
    } catch (error) {
      console.error("Failed to save custom playlists", error);
    }
  };

  const importSongs = async (assets: any[]) => {
    try {
      const newSongs: Song[] = [];
      const isWeb = Platform.OS === 'web';
      const docDir = isWeb ? "" : (FileSystem.documentDirectory || "");

      for (const asset of assets) {
        const rawName = asset.name || "audio.mp3";
        const sanitizedName = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const displayName = rawName.replace(/\.[^/.]+$/, "") || rawName;
        const id = Math.random().toString(36).substr(2, 9);
        let destinationUri = "";

        if (isWeb) {
          try {
            let blob: Blob;
            if (asset.file instanceof Blob) {
              blob = asset.file;
            } else if (asset.uri) {
              const res = await fetch(asset.uri);
              blob = await res.blob();
            } else {
              throw new Error("Unable to read audio file data on web");
            }
            destinationUri = await webAudioStorage.storeAudio(id, blob);
          } catch (webErr) {
            console.error("Failed to store web audio in IndexedDB:", webErr);
            destinationUri = asset.uri || "";
          }
        } else {
          const fileName = `${Date.now()}_${sanitizedName}`;
          destinationUri = `${docDir}${fileName}`;
          
          await FileSystem.copyAsync({
            from: asset.uri,
            to: destinationUri,
          });
        }

        newSongs.push({
          id,
          uri: destinationUri,
          name: displayName,
          isFavorite: false,
          addedAt: Date.now(),
          source: "local",
        });
      }

      const updatedPlaylist = [...newSongs, ...playlist];
      setPlaylist(updatedPlaylist);
      await savePlaylist(updatedPlaylist);
    } catch (error) {
      console.error("Error importing songs", error);
    }
  };

  const downloadFromYoutube = async (
    url: string,
    customName?: string
  ): Promise<{ success: boolean; message?: string; song?: Song }> => {
    try {
      const audioInfo = await YoutubeService.resolveAudio(url);
      const trackName = customName?.trim() || audioInfo.title;
      const sanitizedName = trackName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const id = Math.random().toString(36).substr(2, 9);
      let destinationUri = "";

      if (Platform.OS === 'web') {
        // In browser: download stream into Blob and store in IndexedDB
        const videoId = audioInfo.videoId || YoutubeService.extractVideoId(url) || '';
        const candidateStreamUrls = videoId
          ? YoutubeService.getCandidateProxyUrls(videoId)
          : [audioInfo.streamUrl];

        let response: Response | null = null;
        let lastFetchErr: any = null;

        for (const streamUrl of candidateStreamUrls) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000);
            const res = await fetch(streamUrl, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
              response = res;
              break;
            } else {
              const errText = await res.text().catch(() => '');
              lastFetchErr = new Error(errText || `Server returned HTTP ${res.status}`);
            }
          } catch (fetchErr: any) {
            lastFetchErr = fetchErr;
          }
        }

        if (!response || !response.ok) {
          if (lastFetchErr?.name === 'AbortError') {
            throw new Error('Download timed out after 2 minutes. Please verify your connection and try again.');
          }
          throw new Error(lastFetchErr?.message || 'Download failed. Audio stream could not be loaded.');
        }

        const blob = await response.blob();
        if (blob.size < 1000) {
          throw new Error('Downloaded audio stream is empty or invalid.');
        }

        const mime = response.headers.get('content-type') || blob.type || 'audio/mpeg';
        const properBlob = new Blob([blob], { type: mime });
        try {
          destinationUri = await webAudioStorage.storeAudio(id, properBlob);
        } catch {
          // If IndexedDB storage fails, fall back to in-memory blob URL
          destinationUri = URL.createObjectURL(properBlob);
        }
      } else {
        const fileName = `yt_${Date.now()}_${sanitizedName}.mp3`;
        const docDir = FileSystem.documentDirectory || "";
        destinationUri = `${docDir}${fileName}`;

        const downloadResult = await FileSystem.downloadAsync(audioInfo.streamUrl, destinationUri);
        if (downloadResult.status !== 200 && downloadResult.status !== 206) {
          throw new Error(`Download failed with HTTP status ${downloadResult.status}`);
        }
      }

      const newSong: Song = {
        id,
        uri: destinationUri,
        name: trackName,
        isFavorite: false,
        addedAt: Date.now(),
        source: "youtube",
        sourceUrl: url,
      };

      setPlaylist(prev => {
        const updated = [newSong, ...prev.filter(s => s.id !== newSong.id)];
        savePlaylist(updated);
        return updated;
      });

      return { success: true, song: newSong };
    } catch (err: any) {
      console.error("Error downloading from YouTube:", err);
      return { success: false, message: err?.message || "Failed to download audio from YouTube" };
    }
  };

  const startBackgroundDownload = async (url: string, customName?: string): Promise<string> => {
    const taskId = Math.random().toString(36).substr(2, 9);
    const initialTitle = customName?.trim() || 'Downloading audio track...';

    const newTask: DownloadTask = {
      id: taskId,
      url,
      title: initialTitle,
      status: 'downloading',
      startedAt: Date.now(),
    };

    setDownloadTasks(prev => [newTask, ...prev]);

    // Asynchronous background download so the UI remains 100% responsive
    (async () => {
      try {
        const result = await downloadFromYoutube(url, customName);
        if (result.success && result.song) {
          const downloadedSong = result.song;
          setDownloadTasks(prev =>
            prev.map(t =>
              t.id === taskId
                ? {
                    ...t,
                    status: 'completed',
                    song: downloadedSong,
                    title: downloadedSong.name,
                  }
                : t
            )
          );
          // Auto-dismiss completed banner after 7 seconds
          setTimeout(() => {
            setDownloadTasks(prev => prev.filter(t => t.id !== taskId));
          }, 7000);
        } else {
          const rawMsg = result.message || '';
          const isBot = rawMsg.toLowerCase().includes('bot') || rawMsg.toLowerCase().includes('sign in');
          const friendlyMsg = isBot
            ? 'YouTube bot verification required on cloud host. Please configure cookies or run locally.'
            : (rawMsg || 'Download failed. Please check the URL.');
          setDownloadTasks(prev =>
            prev.map(t =>
              t.id === taskId
                ? {
                    ...t,
                    status: 'error',
                    errorMessage: friendlyMsg,
                    needsCookies: isBot,
                  }
                : t
            )
          );
        }
      } catch (err: any) {
        const rawMsg = err?.message || '';
        const isBot = rawMsg.toLowerCase().includes('bot') || rawMsg.toLowerCase().includes('sign in');
        const friendlyMsg = isBot
          ? 'YouTube bot verification required on cloud host. Please configure cookies or run locally.'
          : (rawMsg || 'Download failed.');
        setDownloadTasks(prev =>
          prev.map(t =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'error',
                  errorMessage: friendlyMsg,
                  needsCookies: isBot,
                }
              : t
          )
        );
      }
    })();

    return taskId;
  };

  const dismissDownloadTask = (id: string) => {
    setDownloadTasks(prev => prev.filter(t => t.id !== id));
  };

  const retryDownloadTask = (id: string) => {
    const task = downloadTasks.find(t => t.id === id);
    if (task) {
      dismissDownloadTask(id);
      startBackgroundDownload(task.url, task.title);
    }
  };

  const isHandlingFinishRef = useRef(false);
  const playRequestIdRef = useRef(0);

  const handleSongFinished = () => {
    if (isHandlingFinishRef.current) return;
    isHandlingFinishRef.current = true;

    const { repeatMode } = stateRef.current;
    if (repeatMode === "one") {
      isHandlingFinishRef.current = false;
      if (Platform.OS === 'web') {
        webAudioPlayer.replay().catch(() => {});
      } else {
        soundRef.current?.replayAsync().catch(() => {});
      }
    } else {
      internalNextSong();
    }
  };

  const internalNextSong = () => {
    const { isShuffle, currentQueue, playlist, currentSong, repeatMode } = stateRef.current;
    const activeQueue = currentQueue.length > 0 ? currentQueue : playlist;
    if (activeQueue.length === 0) return;
    
    let nextIndex = 0;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * activeQueue.length);
    } else {
      const currentIndex = activeQueue.findIndex(s => s.id === currentSong?.id);
      nextIndex = currentIndex + 1;
      if (nextIndex >= activeQueue.length) {
        if (repeatMode === "all") {
          nextIndex = 0;
        } else {
          // Reached end of queue in repeatMode "none"
          setIsPlaying(false);
          return;
        }
      }
    }
    playSong(activeQueue[nextIndex]);
  };

  const onPlaybackStatusUpdate = (status: any) => {
    setPlaybackStatus(status);
    setIsPlaying(status.isPlaying ?? false);

    const isFinished =
      status.didJustFinish ||
      (status.isLoaded &&
        !status.isPlaying &&
        status.durationMillis &&
        status.positionMillis &&
        status.durationMillis > 0 &&
        status.positionMillis >= status.durationMillis - 400);

    if (isFinished) {
      handleSongFinished();
    }
  };

  const playSong = async (song: Song, customQueue?: Song[]) => {
    const currentRequestId = ++playRequestIdRef.current;
    try {
      isHandlingFinishRef.current = false;

      const queueToUse = customQueue || (stateRef.current.currentQueue.length > 0 ? stateRef.current.currentQueue : playlist);
      setCurrentQueue(queueToUse);
      stateRef.current.currentQueue = queueToUse;
      setCurrentSong(song);
      stateRef.current.currentSong = song;

      // On Web: Always use webAudioPlayer to preserve the single persistent <audio> element
      // and prevent mobile browser background/lock-screen autoplay restriction!
      if (Platform.OS === 'web') {
        let targetUri = song.uri;
        if (!targetUri) {
          try {
            const fresh = await webAudioStorage.getAudioUrl(song.id);
            if (fresh) {
              targetUri = fresh;
              song.uri = fresh;
            }
          } catch (_) {}
        }

        if (currentRequestId !== playRequestIdRef.current) return;

        const videoId = song.sourceUrl
          ? YoutubeService.extractVideoId(song.sourceUrl)
          : (song.source === 'youtube' ? YoutubeService.extractVideoId(song.uri) : null);

        if (!targetUri && videoId) {
          targetUri = YoutubeService.getProxyUrl(videoId);
        }

        webAudioPlayer.setOnPlaybackStatusUpdate((st) => {
          onPlaybackStatusUpdate(st);
        });

        let usedProxyStreamUrl: string | null = null;
        try {
          await webAudioPlayer.loadAndPlay(targetUri, song);
          if (currentRequestId !== playRequestIdRef.current) return;
          if (targetUri && targetUri.includes('/api/proxy-audio')) {
            usedProxyStreamUrl = targetUri;
          }
        } catch (playErr: any) {
          if (
            currentRequestId !== playRequestIdRef.current ||
            playErr?.name === 'AbortError' ||
            (playErr?.message && playErr.message.includes('interrupted'))
          ) {
            return;
          }

          console.warn('[WebAudioPlayer] Primary playback failed, trying candidate endpoints:', playErr?.message);
          let recovered = false;
          if (videoId) {
            const candidates = YoutubeService.getCandidateProxyUrls(videoId);
            for (const cand of candidates) {
              if (currentRequestId !== playRequestIdRef.current) return;
              try {
                await webAudioPlayer.loadAndPlay(cand, song);
                if (currentRequestId !== playRequestIdRef.current) return;
                recovered = true;
                usedProxyStreamUrl = cand;
                break;
              } catch (_) {}
            }
          }
          if (!recovered && currentRequestId === playRequestIdRef.current) throw playErr;
        }

        if (currentRequestId !== playRequestIdRef.current) return;

        if (usedProxyStreamUrl) {
          fetch(usedProxyStreamUrl)
            .then(r => r.blob())
            .then(async b => {
              if (b && b.size > 1000) {
                const newUrl = await webAudioStorage.storeAudio(song.id, b);
                song.uri = newUrl;
              }
            })
            .catch(() => {});
        }

        const webSoundWrapper: any = {
          unloadAsync: async () => webAudioPlayer.unload(),
          pauseAsync: async () => webAudioPlayer.pause(),
          playAsync: async () => webAudioPlayer.resume(),
          replayAsync: async () => webAudioPlayer.replay(),
          setPositionAsync: async (ms: number) => webAudioPlayer.seek(ms),
          setStatusAsync: async (st: any) => {
            if (st.positionMillis !== undefined) webAudioPlayer.seek(st.positionMillis);
            if (st.shouldPlay === true) await webAudioPlayer.resume();
            else if (st.shouldPlay === false) await webAudioPlayer.pause();
          },
          getStatusAsync: async () => webAudioPlayer.getStatus(),
          setOnPlaybackStatusUpdate: (cb: any) => webAudioPlayer.setOnPlaybackStatusUpdate(cb),
        };

        soundRef.current = webSoundWrapper;
        setSound(webSoundWrapper);
        setIsPlaying(true);
        isHandlingFinishRef.current = false;
        return;
      }

      // Native platform (iOS/Android) Expo AV playback
      if (soundRef.current) {
        try {
          await soundRef.current.unloadAsync();
        } catch (_) {}
        soundRef.current = null;
      }

      let targetUri = song.uri;
      const videoId = song.sourceUrl
        ? YoutubeService.extractVideoId(song.sourceUrl)
        : (song.source === 'youtube' ? YoutubeService.extractVideoId(song.uri) : null);

      let newSound: Audio.Sound | null = null;
      try {
        const result = await Audio.Sound.createAsync(
          { uri: targetUri },
          { shouldPlay: true, progressUpdateIntervalMillis: 250 },
          onPlaybackStatusUpdate
        );
        if (!result.status || !result.status.isLoaded) {
          throw new Error((result.status as any)?.error || 'Audio source failed to load');
        }
        newSound = result.sound;
      } catch (playErr: any) {
        console.warn(`[AudioContext Native] Primary playback failed:`, playErr?.message);
        if (videoId) {
          const candidates = YoutubeService.getCandidateProxyUrls(videoId);
          for (const candidate of candidates) {
            try {
              const fallbackResult = await Audio.Sound.createAsync(
                { uri: candidate },
                { shouldPlay: true, progressUpdateIntervalMillis: 250 },
                onPlaybackStatusUpdate
              );
              if (fallbackResult.status && fallbackResult.status.isLoaded) {
                newSound = fallbackResult.sound;
                break;
              }
            } catch (_) {}
          }
        }
        if (!newSound) throw playErr;
      }

      soundRef.current = newSound;
      setSound(newSound);
      setIsPlaying(true);
      isHandlingFinishRef.current = false;
    } catch (error: any) {
      if (
        error?.name === 'AbortError' ||
        (error?.message && error.message.includes('interrupted'))
      ) {
        return;
      }
      console.error("Error playing song", error);
    }
  };

  const pauseSong = async () => {
    if (Platform.OS === 'web') {
      await webAudioPlayer.pause();
      setIsPlaying(false);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.pauseAsync().catch(() => {});
      setIsPlaying(false);
    }
  };

  const resumeSong = async () => {
    if (Platform.OS === 'web') {
      await webAudioPlayer.resume();
      setIsPlaying(true);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.playAsync().catch(() => {});
      setIsPlaying(true);
    }
  };

  const nextSong = async () => {
    internalNextSong();
  };

  const previousSong = async () => {
    const activeQueue = currentQueue.length > 0 ? currentQueue : playlist;
    if (activeQueue.length === 0) return;
    const currentIndex = activeQueue.findIndex(s => s.id === currentSong?.id);
    const prevIndex = (currentIndex - 1 + activeQueue.length) % activeQueue.length;
    await playSong(activeQueue[prevIndex]);
  };

  const deleteSong = async (id: string) => {
    try {
      const songToDelete = playlist.find(s => s.id === id);
      if (!songToDelete) return;

      if (Platform.OS === 'web') {
        if (songToDelete.uri && songToDelete.uri.startsWith('blob:')) {
          try { URL.revokeObjectURL(songToDelete.uri); } catch (_) {}
        }
        await webAudioStorage.deleteAudio(id);
      } else {
        await FileSystem.deleteAsync(songToDelete.uri, { idempotent: true }).catch(() => {});
      }

      const updatedPlaylist = playlist.filter(s => s.id !== id);
      setPlaylist(updatedPlaylist);
      setCurrentQueue(prev => prev.filter(s => s.id !== id));
      await savePlaylist(updatedPlaylist);
      
      const updatedCustom = customPlaylists.map(cp => ({
        ...cp,
        songIds: cp.songIds.filter(sid => sid !== id)
      }));
      setCustomPlaylists(updatedCustom);
      await saveCustomPlaylists(updatedCustom);

      if (currentSong?.id === id) {
        if (Platform.OS === 'web') {
          await webAudioPlayer.unload();
        } else if (soundRef.current) {
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
        setSound(null);
        setCurrentSong(null);
        setIsPlaying(false);
        setPlaybackStatus(null);
      }
    } catch (error) {
      console.error("Error deleting song file", error);
    }
  };

  const deleteSongsBulk = async (ids: string[]) => {
    try {
      const remaining = playlist.filter(s => !ids.includes(s.id));
      const deleted = playlist.filter(s => ids.includes(s.id));

      for (const song of deleted) {
        try {
          if (Platform.OS === 'web') {
            if (song.uri && song.uri.startsWith('blob:')) {
              try { URL.revokeObjectURL(song.uri); } catch (_) {}
            }
            await webAudioStorage.deleteAudio(song.id);
          } else {
            await FileSystem.deleteAsync(song.uri, { idempotent: true }).catch(() => {});
          }
        } catch (error) {
          console.error("Error deleting song file", error);
        }
      }

      setPlaylist(remaining);
      setCurrentQueue(prev => prev.filter(s => !ids.includes(s.id)));
      await savePlaylist(remaining);

      const updatedCustom = customPlaylists.map(cp => ({
        ...cp,
        songIds: cp.songIds.filter(sid => !ids.includes(sid))
      }));
      setCustomPlaylists(updatedCustom);
      await saveCustomPlaylists(updatedCustom);

      if (currentSong && ids.includes(currentSong.id)) {
        if (Platform.OS === 'web') {
          await webAudioPlayer.unload();
        } else if (soundRef.current) {
          await soundRef.current.unloadAsync().catch(() => {});
          soundRef.current = null;
        }
        setSound(null);
        setCurrentSong(null);
        setIsPlaying(false);
        setPlaybackStatus(null);
      }
    } catch (error) {
      console.error("Error deleting song files", error);
    }
  };

  const toggleFavorite = async (id: string) => {
    const updatedPlaylist = playlist.map(s => 
      s.id === id ? { ...s, isFavorite: !s.isFavorite } : s
    );
    setPlaylist(updatedPlaylist);
    await savePlaylist(updatedPlaylist);
    if (currentSong?.id === id) {
      setCurrentSong({ ...currentSong, isFavorite: !currentSong.isFavorite });
    }
  };

  const setFavoritesBulk = async (ids: string[], status: boolean) => {
    const updatedPlaylist = playlist.map(s => 
      ids.includes(s.id) ? { ...s, isFavorite: status } : s
    );
    setPlaylist(updatedPlaylist);
    await savePlaylist(updatedPlaylist);
    if (currentSong && ids.includes(currentSong.id)) {
      setCurrentSong({ ...currentSong, isFavorite: status });
    }
  };

  const toggleShuffle = () => setIsShuffle(!isShuffle);

  const toggleRepeat = () => {
    const modes: RepeatMode[] = ["none", "all", "one"];
    const nextMode = modes[(modes.indexOf(repeatMode) + 1) % modes.length];
    setRepeatMode(nextMode);
  };

  const seek = async (position: number) => {
    setPlaybackStatus((prev: any) => (prev ? { ...prev, positionMillis: position } : prev));
    if (Platform.OS === 'web') {
      await webAudioPlayer.seek(position);
      return;
    }
    if (soundRef.current) {
      await soundRef.current.setPositionAsync(position).catch(() => {});
    }
  };

  const createCustomPlaylist = async (name: string, songIds: string[]) => {
    const newPlaylist: CustomPlaylist = {
      id: Math.random().toString(36).substr(2, 9),
      name,
      songIds
    };
    const updated = [...customPlaylists, newPlaylist];
    setCustomPlaylists(updated);
    await saveCustomPlaylists(updated);
  };

  const deleteCustomPlaylist = async (id: string) => {
    const updated = customPlaylists.filter(cp => cp.id !== id);
    setCustomPlaylists(updated);
    await saveCustomPlaylists(updated);
  };

  const reorderSongs = async (oldIndex: number, newIndex: number) => {
    const updated = [...playlist];
    const [moved] = updated.splice(oldIndex, 1);
    updated.splice(newIndex, 0, moved);
    setPlaylist(updated);
    setCurrentQueue(updated);
    await savePlaylist(updated);
  };

  const updatePlaylistOrder = async (newPlaylist: Song[]) => {
    setPlaylist(newPlaylist);
    setCurrentQueue(newPlaylist);
    await savePlaylist(newPlaylist);
  };

  const updateCustomPlaylistOrder = async (playlistId: string, newSongIds: string[]) => {
    const updated = customPlaylists.map(cp =>
      cp.id === playlistId ? { ...cp, songIds: newSongIds } : cp
    );
    setCustomPlaylists(updated);
    await saveCustomPlaylists(updated);
  };

  const removeSongsFromCustomPlaylist = async (playlistId: string, songIds: string[]) => {
    const updated = customPlaylists.map(cp =>
      cp.id === playlistId ? { ...cp, songIds: cp.songIds.filter(id => !songIds.includes(id)) } : cp
    );
    setCustomPlaylists(updated);
    await saveCustomPlaylists(updated);
  };

  actionsRef.current = {
    playSong,
    pauseSong,
    resumeSong,
    nextSong,
    previousSong,
    seek,
  };

  const audioContextValue = useMemo(() => ({
    playlist,
    customPlaylists,
    currentSong,
    isPlaying,
    playbackStatus,
    isShuffle,
    repeatMode,
    downloadTasks,
    startBackgroundDownload,
    dismissDownloadTask,
    retryDownloadTask,
    importSongs,
    downloadFromYoutube,
    playSong,
    pauseSong,
    resumeSong,
    nextSong,
    previousSong,
    deleteSong,
    deleteSongsBulk,
    toggleFavorite,
    setFavoritesBulk,
    toggleShuffle,
    toggleRepeat,
    seek,
    createCustomPlaylist,
    deleteCustomPlaylist,
    updateCustomPlaylistOrder,
    removeSongsFromCustomPlaylist,
    reorderSongs,
    updatePlaylistOrder,
  }), [
    playlist,
    customPlaylists,
    currentSong,
    isPlaying,
    isShuffle,
    repeatMode,
    downloadTasks,
  ]);

  return (
    <AudioContext.Provider value={audioContextValue}>
      <PlaybackStatusContext.Provider value={playbackStatus}>
        {children}
      </PlaybackStatusContext.Provider>
    </AudioContext.Provider>
  );
};

export const useAudio = () => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudio must be used within an AudioProvider");
  }
  return context;
};

