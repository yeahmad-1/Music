import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Text, Switch, Divider, useTheme, Button, TextInput, Dialog, Portal, IconButton, Card } from 'react-native-paper';
import { adService, WheelAdConfig, defaultAdConfig } from '../services/AdService';
import { keepAliveService, KeepAliveConfig } from '../services/KeepAliveService';

const SettingsScreen = ({ route }: any) => {
  const theme = useTheme();
  const { toggleTheme } = route.params;
  const isDarkMode = theme.dark;

  // Owner Admin States
  const [isOwnerUnlocked, setIsOwnerUnlocked] = useState(false);
  const [pinDialogVisible, setPinDialogVisible] = useState(false);
  const [changePinDialogVisible, setChangePinDialogVisible] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [newPinInput, setNewPinInput] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Ad Configuration States
  const [adConfig, setAdConfig] = useState<WheelAdConfig>(defaultAdConfig);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Server Keep-Alive States
  const [keepAliveConfig, setKeepAliveConfig] = useState<KeepAliveConfig>(keepAliveService.getConfig());
  const [isPingingNow, setIsPingingNow] = useState(false);
  const [pingFeedback, setPingFeedback] = useState<string | null>(null);

  useEffect(() => {
    loadAdSettings();
    keepAliveService.init().then(cfg => {
      setKeepAliveConfig({ ...cfg });
    });
    const unsubscribe = keepAliveService.subscribe((cfg) => {
      setKeepAliveConfig({ ...cfg });
    });
    return () => unsubscribe();
  }, []);

  const loadAdSettings = async () => {
    const config = await adService.getAdConfig();
    setAdConfig(config);
  };

  const handleVerifyPin = async () => {
    const isValid = await adService.verifyPin(pinInput);
    if (isValid) {
      setIsOwnerUnlocked(true);
      setPinDialogVisible(false);
      setPinInput('');
      setPinError(null);
    } else {
      setPinError('Incorrect Owner PIN. Default PIN is 1994.');
    }
  };

  const handleChangePin = async () => {
    if (newPinInput.trim().length >= 4) {
      await adService.setCustomPin(newPinInput.trim());
      setChangePinDialogVisible(false);
      setNewPinInput('');
      Alert.alert('Success', 'Owner PIN updated successfully.');
    } else {
      Alert.alert('Error', 'PIN must be at least 4 characters.');
    }
  };

  const handleSaveAdConfig = async () => {
    await adService.saveAdConfig(adConfig);
    setSaveSuccessMsg('Ad settings saved successfully!');
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleManualPing = async () => {
    if (!keepAliveConfig.serverUrl.trim()) return;
    setIsPingingNow(true);
    setPingFeedback(null);
    try {
      const result = await keepAliveService.sendPing();
      setPingFeedback(result.message);
    } catch (e: any) {
      setPingFeedback(`Error: ${e?.message || 'Failed'}`);
    } finally {
      setIsPingingNow(false);
    }
  };

  const handleSaveKeepAlive = async () => {
    const updated = await keepAliveService.updateConfig({
      serverUrl: keepAliveConfig.serverUrl.trim(),
      enabled: keepAliveConfig.enabled,
    });
    setKeepAliveConfig(updated);
    setPingFeedback('Keep-Alive configuration saved! Server will be pinged every 4 minutes.');
    setTimeout(() => setPingFeedback(null), 4000);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={{ flex: 1 }}>
        {/* Appearance Section */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary, letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 14 }]}>
            Appearance
          </Text>
          <View style={styles.row}>
            <Text style={{ color: theme.colors.onSurface, fontSize: 16 }}>Dark Mode</Text>
            <Switch value={isDarkMode} onValueChange={toggleTheme} color={theme.colors.primary} />
          </View>
        </View>

        <Divider />

        {/* Server Keep-Alive Section */}
        <View style={styles.section}>
          <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary, letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 14 }]}>
            Server Keep-Alive Heartbeat
          </Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
            Automatically sends a lightweight request to your backend every 4 minutes to prevent free-tier cloud servers (Render, Heroku, Railway, etc.) from sleeping.
          </Text>

          <View style={[styles.row, { paddingVertical: 4 }]}>
            <Text style={{ color: theme.colors.onSurface, fontSize: 15, fontWeight: 'bold' }}>4-Minute Heartbeat Ping</Text>
            <Switch
              value={keepAliveConfig.enabled}
              onValueChange={async (val) => {
                const updated = await keepAliveService.updateConfig({ enabled: val });
                setKeepAliveConfig(updated);
              }}
              color={theme.colors.primary}
            />
          </View>

          <TextInput
            label="Server URL to Ping"
            placeholder="https://my-backend.onrender.com/health"
            value={keepAliveConfig.serverUrl}
            onChangeText={(text) => setKeepAliveConfig({ ...keepAliveConfig, serverUrl: text })}
            mode="outlined"
            style={[styles.input, { marginTop: 8 }]}
            autoCapitalize="none"
            autoCorrect={false}
            activeOutlineColor={theme.colors.primary}
          />

          {keepAliveConfig.lastPingTime && (
            <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginTop: 4, marginBottom: 8 }}>
              Last Ping: {new Date(keepAliveConfig.lastPingTime).toLocaleTimeString()} ({keepAliveConfig.lastPingStatus || 'Pending'})
            </Text>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Button
              mode="outlined"
              icon="radio-tower"
              onPress={handleManualPing}
              loading={isPingingNow}
              disabled={isPingingNow || !keepAliveConfig.serverUrl.trim()}
              textColor={theme.colors.primary}
              style={{ flex: 1 }}
            >
              Ping Now
            </Button>
            <Button
              mode="contained"
              icon="content-save"
              onPress={handleSaveKeepAlive}
              buttonColor={theme.colors.primary}
              style={{ flex: 1 }}
            >
              Save URL
            </Button>
          </View>

          {pingFeedback && (
            <Text variant="bodySmall" style={{ color: pingFeedback.startsWith('Failed') ? '#D32F2F' : '#4CAF50', marginTop: 8, fontWeight: 'bold' }}>
              {pingFeedback}
            </Text>
          )}
        </View>

        <Divider />

        {/* Owner & Ad Management Section */}
        <View style={styles.section}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary, letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 14, marginBottom: 0 }]}>
              App Owner & Ads Management
            </Text>
            {isOwnerUnlocked && (
              <IconButton
                icon="lock"
                size={20}
                iconColor={theme.colors.primary}
                onPress={() => setIsOwnerUnlocked(false)}
              />
            )}
          </View>

          {!isOwnerUnlocked ? (
            <Card style={{ backgroundColor: theme.colors.surface, elevation: 1, padding: 8 }}>
              <Card.Content>
                <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 14 }}>
                  Only the app owner can configure advertisements, wheel banners, and remote ad sync endpoints.
                </Text>
                <Button
                  mode="contained"
                  icon="shield-key"
                  onPress={() => {
                    setPinError(null);
                    setPinDialogVisible(true);
                  }}
                  buttonColor={theme.colors.primary}
                >
                  Unlock Owner Dashboard
                </Button>
              </Card.Content>
            </Card>
          ) : (
            <Card style={{ backgroundColor: theme.colors.surface, elevation: 2, padding: 6 }}>
              <Card.Content>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                  <IconButton icon="check-decagram" iconColor={theme.colors.secondary} size={24} style={{ margin: 0, marginRight: 8 }} />
                  <Text variant="titleSmall" style={{ color: theme.colors.secondary, fontWeight: 'bold' }}>
                    OWNER MODE ACTIVE
                  </Text>
                </View>

                {/* Ad Toggle */}
                <View style={[styles.row, { paddingVertical: 6 }]}>
                  <Text style={{ color: theme.colors.onSurface, fontWeight: 'bold' }}>Enable Wheel Ads</Text>
                  <Switch
                    value={adConfig.enabled}
                    onValueChange={(val) => setAdConfig({ ...adConfig, enabled: val })}
                    color={theme.colors.secondary}
                  />
                </View>

                {/* Sponsor Name */}
                <TextInput
                  label="Sponsor Name"
                  placeholder="e.g. My Brand / Partner"
                  value={adConfig.sponsorName}
                  onChangeText={(text) => setAdConfig({ ...adConfig, sponsorName: text })}
                  mode="outlined"
                  style={styles.input}
                  activeOutlineColor={theme.colors.secondary}
                />

                {/* Ad Image URL */}
                <TextInput
                  label="Wheel Ad Image URL (PNG/JPG)"
                  placeholder="https://example.com/ad-logo.png"
                  value={adConfig.imageUrl}
                  onChangeText={(text) => setAdConfig({ ...adConfig, imageUrl: text })}
                  mode="outlined"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  activeOutlineColor={theme.colors.secondary}
                />

                {/* Sponsor Target Link */}
                <TextInput
                  label="Sponsor Destination URL (Click Link)"
                  placeholder="https://example.com/promo"
                  value={adConfig.targetUrl}
                  onChangeText={(text) => setAdConfig({ ...adConfig, targetUrl: text })}
                  mode="outlined"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  activeOutlineColor={theme.colors.secondary}
                />

                {/* Remote Sync Config URL */}
                <TextInput
                  label="Remote Sync Config URL (Optional)"
                  placeholder="https://raw.githubusercontent.com/.../ads.json"
                  value={adConfig.remoteConfigUrl || ''}
                  onChangeText={(text) => setAdConfig({ ...adConfig, remoteConfigUrl: text })}
                  mode="outlined"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  activeOutlineColor={theme.colors.secondary}
                />
                <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
                  Set a live JSON URL to update ads across all user devices anytime after deployment.
                </Text>

                {saveSuccessMsg && (
                  <Text variant="bodySmall" style={{ color: '#4CAF50', fontWeight: 'bold', marginBottom: 10 }}>
                    {saveSuccessMsg}
                  </Text>
                )}

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                  <Button
                    mode="outlined"
                    onPress={() => setChangePinDialogVisible(true)}
                    textColor={theme.colors.onSurfaceVariant}
                    style={{ flex: 1, marginRight: 8 }}
                  >
                    Change PIN
                  </Button>
                  <Button
                    mode="contained"
                    icon="content-save"
                    onPress={handleSaveAdConfig}
                    buttonColor={theme.colors.primary}
                    style={{ flex: 1 }}
                  >
                    Save Ads
                  </Button>
                </View>
              </Card.Content>
            </Card>
          )}
        </View>

        <Divider />
      </ScrollView>

      {/* PIN Verification Modal */}
      <Portal>
        <Dialog visible={pinDialogVisible} onDismiss={() => setPinDialogVisible(false)} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title style={{ fontWeight: 'bold' }}>Owner Authentication</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 14 }}>
              Enter your Owner Secret PIN to access ad campaign controls. (Default PIN: 1994)
            </Text>
            <TextInput
              label="Owner PIN"
              value={pinInput}
              onChangeText={(text) => {
                setPinInput(text);
                setPinError(null);
              }}
              secureTextEntry
              keyboardType="numeric"
              mode="outlined"
              activeOutlineColor={theme.colors.primary}
            />
            {pinError && (
              <Text variant="bodySmall" style={{ color: '#D32F2F', marginTop: 8 }}>
                {pinError}
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPinDialogVisible(false)}>Cancel</Button>
            <Button onPress={handleVerifyPin} textColor={theme.colors.primary}>Unlock</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Change PIN Modal */}
        <Dialog visible={changePinDialogVisible} onDismiss={() => setChangePinDialogVisible(false)} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title style={{ fontWeight: 'bold' }}>Change Owner PIN</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="New PIN (min 4 digits)"
              value={newPinInput}
              onChangeText={setNewPinInput}
              secureTextEntry
              keyboardType="numeric"
              mode="outlined"
              activeOutlineColor={theme.colors.primary}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setChangePinDialogVisible(false)}>Cancel</Button>
            <Button onPress={handleChangePin} textColor={theme.colors.primary}>Update PIN</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>

      <View style={[styles.footer, { borderTopColor: theme.colors.outline }]}>
        <Text style={{ color: theme.colors.onSurfaceVariant, letterSpacing: 2, fontWeight: 'bold', fontSize: 11 }}>
          ALL RIGHTS RESERVED TO SHAHIDr
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    marginBottom: 15,
    fontWeight: 'bold',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  input: {
    marginBottom: 10,
  },
  footer: {
    padding: 20,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  }
});

export default SettingsScreen;
