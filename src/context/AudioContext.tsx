import React, { createContext, useState, useContext, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { YoutubeService } from "../services/YoutubeService";
import { webAudioStorage } from "../services/WebAudioStorage";

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

type RepeatMode = "none" | "one" | "all";

interface AudioContextType {
  playlist: Song[];
  customPlaylists: CustomPlaylist[];
  currentSong: Song | null;
  isPlaying: boolean;
  playbackStatus: any;
  isShuffle: boolean;
  repeatMode: RepeatMode;
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
  reorderSongs: (oldIndex: number, newIndex: number) => Promise<void>;
  updatePlaylistOrder: (newPlaylist: Song[]) => Promise<void>;
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

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

  const soundRef = useRef<Audio.Sound | null>(null);

  // Use refs to avoid closure stale state in status updates
  const stateRef = useRef({ repeatMode, isShuffle, currentQueue, playlist, currentSong });
  useEffect(() => {
    stateRef.current = { repeatMode, isShuffle, currentQueue, playlist, currentSong };
  }, [repeatMode, isShuffle, currentQueue, playlist, currentSong]);

  useEffect(() => {
    loadData();
    setupAudio();
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }
    };
  }, []);

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
        const response = await fetch(audioInfo.streamUrl);
        if (!response.ok) {
          throw new Error(`Download failed with HTTP status ${response.status}`);
        }
        const blob = await response.blob();
        destinationUri = await webAudioStorage.storeAudio(id, blob);
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

      const updatedPlaylist = [newSong, ...playlist];
      setPlaylist(updatedPlaylist);
      await savePlaylist(updatedPlaylist);

      return { success: true, song: newSong };
    } catch (err: any) {
      console.error("Error downloading from YouTube:", err);
      return { success: false, message: err?.message || "Failed to download audio from YouTube" };
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
      nextIndex = (currentIndex + 1);
      if (nextIndex >= activeQueue.length) {
        if (repeatMode === "all") {
          nextIndex = 0;
        } else {
          return;
        }
      }
    }
    playSong(activeQueue[nextIndex]);
  };

  const onPlaybackStatusUpdate = (status: any) => {
    setPlaybackStatus(status);
    setIsPlaying(status.isPlaying ?? false);
    if (status.didJustFinish) {
      const { repeatMode } = stateRef.current;
      if (repeatMode === "one") {
        soundRef.current?.replayAsync().catch(() => {});
      } else {
        internalNextSong();
      }
    }
  };

  const playSong = async (song: Song, customQueue?: Song[]) => {
    try {
      if (customQueue) {
        setCurrentQueue(customQueue);
      } else if (currentQueue.length === 0 || !currentQueue.find(s => s.id === song.id)) {
        setCurrentQueue(playlist);
      }

      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
      }

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: song.uri },
        { shouldPlay: true, progressUpdateIntervalMillis: 250 },
        onPlaybackStatusUpdate
      );

      soundRef.current = newSound;
      setSound(newSound);
      setCurrentSong(song);
      setIsPlaying(true);
    } catch (error) {
      console.error("Error playing song", error);
    }
  };

  const pauseSong = async () => {
    if (soundRef.current) {
      await soundRef.current.pauseAsync().catch(() => {});
      setIsPlaying(false);
    }
  };

  const resumeSong = async () => {
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
    const songToDelete = playlist.find(s => s.id === id);
    if (songToDelete) {
      try {
        if (Platform.OS === 'web') {
          await webAudioStorage.deleteAudio(id);
        } else {
          await FileSystem.deleteAsync(songToDelete.uri, { idempotent: true });
        }
        const updatedPlaylist = playlist.filter(s => s.id !== id);
        setPlaylist(updatedPlaylist);
        await savePlaylist(updatedPlaylist);
        
        const updatedCustom = customPlaylists.map(cp => ({
          ...cp,
          songIds: cp.songIds.filter(sid => sid !== id)
        }));
        setCustomPlaylists(updatedCustom);
        await saveCustomPlaylists(updatedCustom);

        if (currentSong?.id === id) {
          if (soundRef.current) {
            await soundRef.current.unloadAsync().catch(() => {});
            soundRef.current = null;
            setSound(null);
          }
          setCurrentSong(null);
          setIsPlaying(false);
        }
      } catch (error) {
        console.error("Error deleting song file", error);
      }
    }
  };

  const deleteSongsBulk = async (ids: string[]) => {
    const remaining = playlist.filter(s => !ids.includes(s.id));
    const deleted = playlist.filter(s => ids.includes(s.id));

    for (const song of deleted) {
      try {
        if (Platform.OS === 'web') {
          await webAudioStorage.deleteAudio(song.id);
        } else {
          await FileSystem.deleteAsync(song.uri, { idempotent: true });
        }
      } catch (error) {
        console.error("Error deleting song file", error);
      }
    }

    setPlaylist(remaining);
    await savePlaylist(remaining);

    const updatedCustom = customPlaylists.map(cp => ({
      ...cp,
      songIds: cp.songIds.filter(sid => !ids.includes(sid))
    }));
    setCustomPlaylists(updatedCustom);
    await saveCustomPlaylists(updatedCustom);

    if (currentSong && ids.includes(currentSong.id)) {
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {});
        soundRef.current = null;
        setSound(null);
      }
      setCurrentSong(null);
      setIsPlaying(false);
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
    await savePlaylist(updated);
    if (currentQueue === playlist) {
      setCurrentQueue(updated);
    }
  };

  const updatePlaylistOrder = async (newPlaylist: Song[]) => {
    setPlaylist(newPlaylist);
    await savePlaylist(newPlaylist);
    if (currentQueue === playlist) {
      setCurrentQueue(newPlaylist);
    }
  };

  return (
    <AudioContext.Provider value={{
      playlist,
      customPlaylists,
      currentSong,
      isPlaying,
      playbackStatus,
      isShuffle,
      repeatMode,
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
      reorderSongs,
      updatePlaylistOrder
    }}>
      {children}
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

