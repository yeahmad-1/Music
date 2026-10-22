import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, ActivityIndicator, IconButton, Button, useTheme, Surface } from 'react-native-paper';
import { useAudio, DownloadTask } from '../context/AudioContext';

export const DownloadStatusBanner: React.FC = () => {
  const { downloadTasks, dismissDownloadTask, retryDownloadTask, playSong } = useAudio();
  const theme = useTheme();

  if (!downloadTasks || downloadTasks.length === 0) {
    return null;
  }

  // Display only the latest 2 tasks to avoid taking too much screen space
  const visibleTasks = downloadTasks.slice(0, 2);

  return (
    <View style={styles.outerContainer} pointerEvents="box-none">
      {visibleTasks.map((task: DownloadTask) => {
        const isDownloading = task.status === 'downloading';
        const isCompleted = task.status === 'completed';
        const isError = task.status === 'error';

        const borderColor = isDownloading
          ? theme.colors.primary
          : isCompleted
          ? '#10B981'
          : '#EF4444';

        const iconName = isDownloading
          ? 'download'
          : isCompleted
          ? 'check-circle'
          : 'alert-circle';

        const iconColor = isDownloading
          ? theme.colors.primary
          : isCompleted
          ? '#10B981'
          : '#EF4444';

        return (
          <Surface
            key={task.id}
            elevation={4}
            style={[
              styles.card,
              {
                backgroundColor: theme.dark ? '#1E293B' : '#FFFFFF',
                borderColor,
                borderLeftWidth: 4,
              },
            ]}
          >
            <View style={styles.row}>
              <View style={styles.iconContainer}>
                {isDownloading ? (
                  <ActivityIndicator animating={true} size="small" color={theme.colors.primary} />
                ) : (
                  <IconButton
                    icon={iconName}
                    size={22}
                    iconColor={iconColor}
                    style={styles.noMargin}
                  />
                )}
              </View>

              <View style={styles.infoContainer}>
                <Text
                  variant="labelMedium"
                  style={[styles.statusTitle, { color: iconColor }]}
                  numberOfLines={1}
                >
                  {isDownloading
                    ? 'Downloading in Background...'
                    : isCompleted
                    ? 'Download Complete!'
                    : 'Download Failed'}
                </Text>
                <Text
                  variant="bodySmall"
                  style={[styles.songTitle, { color: theme.colors.onSurface }]}
                  numberOfLines={1}
                >
                  {task.title || 'YouTube Audio Track'}
                </Text>
                {isDownloading && (
                  <Text variant="labelSmall" style={{ color: theme.colors.outline, fontSize: 11 }}>
                    You can keep playing and browsing music uninterrupted.
                  </Text>
                )}
                {isError && task.errorMessage && (
                  <Text variant="labelSmall" style={{ color: '#EF4444', fontSize: 11 }} numberOfLines={1}>
                    {task.errorMessage}
                  </Text>
                )}
              </View>

              <View style={styles.actionsContainer}>
                {isCompleted && task.song && (
                  <Button
                    mode="contained"
                    compact
                    icon="play"
                    buttonColor="#10B981"
                    textColor="#FFFFFF"
                    style={styles.playButton}
                    labelStyle={styles.playButtonLabel}
                    onPress={() => {
                      if (task.song) {
                        playSong(task.song);
                      }
                      dismissDownloadTask(task.id);
                    }}
                  >
                    Play
                  </Button>
                )}

                {isError && (
                  <Button
                    mode="outlined"
                    compact
                    style={styles.retryButton}
                    labelStyle={{ fontSize: 11 }}
                    textColor={theme.colors.primary}
                    onPress={() => retryDownloadTask(task.id)}
                  >
                    Retry
                  </Button>
                )}

                <IconButton
                  icon="close"
                  size={18}
                  iconColor={theme.colors.outline}
                  style={styles.closeButton}
                  onPress={() => dismissDownloadTask(task.id)}
                />
              </View>
            </View>
          </Surface>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  outerContainer: {
    position: 'absolute',
    bottom: 20,
    left: 12,
    right: 12,
    zIndex: 99999,
    gap: 8,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  noMargin: {
    margin: 0,
    padding: 0,
  },
  infoContainer: {
    flex: 1,
    marginRight: 8,
  },
  statusTitle: {
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  songTitle: {
    fontWeight: '600',
    marginTop: 1,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  playButton: {
    marginRight: 4,
    borderRadius: 8,
  },
  playButtonLabel: {
    fontSize: 12,
    marginVertical: 4,
    marginHorizontal: 8,
  },
  retryButton: {
    marginRight: 4,
    borderRadius: 8,
  },
  closeButton: {
    margin: 0,
    padding: 0,
  },
});
