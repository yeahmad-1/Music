import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WheelAdConfig {
  enabled: boolean;
  imageUrl: string;
  targetUrl: string;
  sponsorName: string;
  remoteConfigUrl?: string;
  updatedAt: number;
}

const AD_CONFIG_KEY = 'wheel_ad_config';
const OWNER_PIN_KEY = 'owner_admin_pin';
const DEFAULT_OWNER_PIN = '1994';

export const defaultAdConfig: WheelAdConfig = {
  enabled: false,
  imageUrl: '',
  targetUrl: '',
  sponsorName: 'Sponsored',
  remoteConfigUrl: '',
  updatedAt: Date.now(),
};

/**
 * Service to manage owner-configured revolving wheel ads.
 * Supports local persistence, remote sync URL for post-deployment updates,
 * and PIN-protected owner authentication.
 */
class AdService {
  private cachedConfig: WheelAdConfig | null = null;

  async getAdConfig(): Promise<WheelAdConfig> {
    try {
      if (this.cachedConfig) {
        return this.cachedConfig;
      }

      const stored = await AsyncStorage.getItem(AD_CONFIG_KEY);
      let config: WheelAdConfig = stored ? JSON.parse(stored) : { ...defaultAdConfig };

      // If a remote sync URL is configured, attempt to fetch the latest manifest
      if (config.remoteConfigUrl && config.remoteConfigUrl.trim().startsWith('http')) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const response = await fetch(config.remoteConfigUrl, { signal: controller.signal });
          clearTimeout(timeoutId);

          if (response.ok) {
            const remoteData = await response.json();
            if (remoteData && typeof remoteData.enabled === 'boolean') {
              config = {
                ...config,
                enabled: remoteData.enabled,
                imageUrl: remoteData.imageUrl || config.imageUrl,
                targetUrl: remoteData.targetUrl || config.targetUrl,
                sponsorName: remoteData.sponsorName || config.sponsorName,
                updatedAt: remoteData.updatedAt || Date.now(),
              };
              await AsyncStorage.setItem(AD_CONFIG_KEY, JSON.stringify(config));
            }
          }
        } catch (fetchErr) {
          // Fall back to locally stored config if offline or remote unreachable
          console.log('AdService: using cached ad config (remote unreachable)');
        }
      }

      this.cachedConfig = config;
      return config;
    } catch (e) {
      console.error('Error in getAdConfig:', e);
      return { ...defaultAdConfig };
    }
  }

  async saveAdConfig(newConfig: WheelAdConfig): Promise<void> {
    try {
      const updated = {
        ...newConfig,
        updatedAt: Date.now(),
      };
      this.cachedConfig = updated;
      await AsyncStorage.setItem(AD_CONFIG_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Error saving ad config:', e);
    }
  }

  async verifyPin(inputPin: string): Promise<boolean> {
    try {
      const storedPin = await AsyncStorage.getItem(OWNER_PIN_KEY);
      const activePin = storedPin || DEFAULT_OWNER_PIN;
      return inputPin.trim() === activePin;
    } catch {
      return inputPin.trim() === DEFAULT_OWNER_PIN;
    }
  }

  async setCustomPin(newPin: string): Promise<void> {
    if (newPin && newPin.trim().length >= 4) {
      await AsyncStorage.setItem(OWNER_PIN_KEY, newPin.trim());
    }
  }
}

export const adService = new AdService();
