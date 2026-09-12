import AsyncStorage from '@react-native-async-storage/async-storage';

export interface KeepAliveConfig {
  enabled: boolean;
  serverUrl: string;
  intervalMinutes: number; // default: 4 minutes
  lastPingTime?: number;
  lastPingStatus?: string;
}

const KEEP_ALIVE_KEY = 'keep_alive_config';
const DEFAULT_CONFIG: KeepAliveConfig = {
  enabled: false,
  serverUrl: '',
  intervalMinutes: 4,
};

/**
 * Service that sends an HTTP keep-alive heartbeat ping to a server
 * every 4 minutes to prevent free-tier cloud servers (Render, Heroku, Railway, etc.)
 * from going to sleep / spinning down.
 */
class KeepAliveService {
  private timer: any = null;
  private config: KeepAliveConfig = { ...DEFAULT_CONFIG };
  private listeners: Array<(config: KeepAliveConfig) => void> = [];

  async init(): Promise<KeepAliveConfig> {
    try {
      const stored = await AsyncStorage.getItem(KEEP_ALIVE_KEY);
      if (stored) {
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(stored) };
      }
    } catch {
      this.config = { ...DEFAULT_CONFIG };
    }
    this.restartTimer();
    return this.config;
  }

  getConfig(): KeepAliveConfig {
    return this.config;
  }

  async updateConfig(partial: Partial<KeepAliveConfig>): Promise<KeepAliveConfig> {
    this.config = { ...this.config, ...partial };
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

    if (this.config.enabled && this.config.serverUrl && this.config.serverUrl.trim().startsWith('http')) {
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
    const url = this.config.serverUrl?.trim();
    if (!url || !url.startsWith('http')) {
      return { success: false, message: 'Please enter a valid HTTP/HTTPS server URL' };
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
