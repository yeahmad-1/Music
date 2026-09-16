import AsyncStorage from '@react-native-async-storage/async-storage';

export interface KeepAliveConfig {
  enabled: boolean;
  serverUrl: string;
  intervalMinutes: number; // default: 4 minutes
  lastPingTime?: number;
  lastPingStatus?: string;
}

function getDefaultServerUrl(): string {
  if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin.startsWith('http')) {
    return `${window.location.origin}/ping`;
  }
  return 'https://music-hlq1.onrender.com/ping';
}

function getDefaultConfig(): KeepAliveConfig {
  return {
    enabled: true,
    serverUrl: getDefaultServerUrl(),
    intervalMinutes: 4,
  };
}

const KEEP_ALIVE_KEY = 'keep_alive_config';

/**
 * Service that sends an HTTP keep-alive heartbeat ping to a server
 * every 4 minutes to prevent free-tier cloud servers (Render, Heroku, Railway, etc.)
 * from going to sleep / spinning down.
 */
class KeepAliveService {
  private timer: any = null;
  private config: KeepAliveConfig = getDefaultConfig();
  private listeners: Array<(config: KeepAliveConfig) => void> = [];

  async init(): Promise<KeepAliveConfig> {
    try {
      const stored = await AsyncStorage.getItem(KEEP_ALIVE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.config = {
          ...getDefaultConfig(),
          ...parsed,
          serverUrl: parsed.serverUrl?.trim() || getDefaultServerUrl(),
          enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
        };
      } else {
        this.config = getDefaultConfig();
        await AsyncStorage.setItem(KEEP_ALIVE_KEY, JSON.stringify(this.config)).catch(() => {});
      }
    } catch {
      this.config = getDefaultConfig();
    }
    this.restartTimer();
    this.notify();
    return this.config;
  }

  getConfig(): KeepAliveConfig {
    return this.config;
  }

  async updateConfig(partial: Partial<KeepAliveConfig>): Promise<KeepAliveConfig> {
    this.config = { ...this.config, ...partial };
    if (!this.config.serverUrl || !this.config.serverUrl.trim()) {
      this.config.serverUrl = getDefaultServerUrl();
    }
    try {
      await AsyncStorage.setItem(KEEP_ALIVE_KEY, JSON.stringify(this.config));
    } catch (e) {
      console.error('Error saving keep alive config:', e);
    }
    this.restartTimer();
    this.notify();
    return this.config;
  }

  subscribe(listener: (config: KeepAliveConfig) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l(this.config));
  }

  private restartTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.config.enabled) {
      const intervalMs = (this.config.intervalMinutes || 4) * 60 * 1000;
      // Send an initial ping if none was sent recently
      const shouldSendInitial = !this.config.lastPingTime || (Date.now() - this.config.lastPingTime > intervalMs);
      if (shouldSendInitial) {
        this.sendPing();
      }

      this.timer = setInterval(() => {
        this.sendPing();
      }, intervalMs);
    }
  }

  async sendPing(): Promise<{ success: boolean; message: string; statusCode?: number }> {
    let url = this.config.serverUrl?.trim() || getDefaultServerUrl();
    if (!url.startsWith('http')) {
      const origin = (typeof window !== 'undefined' && window.location?.origin) ? window.location.origin : 'https://music-hlq1.onrender.com';
      url = `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'OfflineMusicApp-KeepAlive/1.0',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const statusText = `Success (HTTP ${res.status})`;
      this.config.lastPingTime = Date.now();
      this.config.lastPingStatus = statusText;
      await AsyncStorage.setItem(KEEP_ALIVE_KEY, JSON.stringify(this.config));
      this.notify();

      return { success: true, message: `Server replied with HTTP ${res.status}`, statusCode: res.status };
    } catch (err: any) {
      const errText = err?.name === 'AbortError' ? 'Timeout (12s)' : (err?.message || 'Network error');
      this.config.lastPingTime = Date.now();
      this.config.lastPingStatus = `Failed: ${errText}`;
      await AsyncStorage.setItem(KEEP_ALIVE_KEY, JSON.stringify(this.config));
      this.notify();

      return { success: false, message: `Ping failed: ${errText}` };
    }
  }
}

export const keepAliveService = new KeepAliveService();
