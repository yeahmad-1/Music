import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Animated, Dimensions, Image, TouchableOpacity, Linking, PanResponder } from 'react-native';
import { IconButton, Text, Surface, useTheme } from 'react-native-paper';
import { useAudio } from '../context/AudioContext';
import { adService, WheelAdConfig } from '../services/AdService';

const { width } = Dimensions.get('window');

const PlayerScreen = () => {
  const { 
    currentSong, isPlaying, pauseSong, resumeSong,
    nextSong, previousSong, playbackStatus, toggleFavorite,
    isShuffle, toggleShuffle, repeatMode, toggleRepeat,
    seek
  } = useAudio();

  const theme = useTheme();
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const [adConfig, setAdConfig] = useState<WheelAdConfig | null>(null);

  useEffect(() => {
    adService.getAdConfig().then((cfg) => {
      setAdConfig(cfg);
    });
  }, []);

  const handleWheelPress = () => {
    if (adConfig && adConfig.enabled && adConfig.targetUrl) {
      Linking.openURL(adConfig.targetUrl).catch((err) =>
        console.log('Error opening sponsor link:', err)
      );
    }
  };

  useEffect(() => {
    if (isPlaying) {
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 20000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      rotateAnim.stopAnimation();
    }
  }, [isPlaying]);

  const rotation = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPositionMillis, setScrubPositionMillis] = useState<number | null>(null);
  const sliderWidthRef = useRef(0);
  const sliderPageXRef = useRef(0);
  const sliderViewRef = useRef<View>(null);

  const durationMillis = playbackStatus?.durationMillis || 0;
  const currentPositionMillis = isScrubbing && scrubPositionMillis !== null
    ? scrubPositionMillis
    : (playbackStatus?.positionMillis || 0);

  const progressRatio = durationMillis > 0
    ? Math.min(Math.max(currentPositionMillis / durationMillis, 0), 1)
    : 0;

  const handleSeekFromEvent = (evt: any, isFinal: boolean) => {
    const width = sliderWidthRef.current;
    if (width <= 0 || durationMillis <= 0) return;

    let touchX = evt.nativeEvent.locationX;
    if (evt.nativeEvent.pageX !== undefined && sliderPageXRef.current > 0) {
      touchX = evt.nativeEvent.pageX - sliderPageXRef.current;
    }

    const clampedX = Math.max(0, Math.min(touchX, width));
    const ratio = clampedX / width;
    const targetMillis = Math.round(ratio * durationMillis);

    if (isFinal) {
      setIsScrubbing(false);
      setScrubPositionMillis(null);
      seek(targetMillis);
    } else {
      setIsScrubbing(true);
      setScrubPositionMillis(targetMillis);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (sliderViewRef.current) {
          sliderViewRef.current.measure((x, y, width, height, pageX) => {
            if (pageX) sliderPageXRef.current = pageX;
            if (width) sliderWidthRef.current = width;
          });
        }
        handleSeekFromEvent(evt, false);
      },
      onPanResponderMove: (evt) => {
        handleSeekFromEvent(evt, false);
      },
      onPanResponderRelease: (evt) => {
        handleSeekFromEvent(evt, true);
      },
      onPanResponderTerminate: () => {
        setIsScrubbing(false);
        setScrubPositionMillis(null);
      },
    })
  ).current;

  const formatTime = (millis: number) => {
    if (!millis || millis < 0) return "0:00";
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  if (!currentSong) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <Text variant="headlineSmall" style={{ color: theme.colors.onSurface }}>No song selected</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <TouchableOpacity
        activeOpacity={adConfig?.enabled && adConfig?.targetUrl ? 0.85 : 1}
        onPress={handleWheelPress}
      >
        <Animated.View style={[styles.albumArtContainer, { transform: [{ rotate: rotation }] }]}>
          <Surface style={[styles.surface, {
            backgroundColor: theme.dark ? '#0F3460' : '#FFF0F3',
            borderColor: adConfig?.enabled ? theme.colors.secondary : theme.colors.primary,
            borderWidth: 3,
            shadowColor: adConfig?.enabled ? theme.colors.secondary : theme.colors.primary,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: theme.dark ? 0.8 : 0.3,
            shadowRadius: 20,
          }]} elevation={5}>
            {adConfig?.enabled && adConfig?.imageUrl ? (
              <Image
                source={{ uri: adConfig.imageUrl }}
                style={{ width: 220, height: 220, borderRadius: 110 }}
              />
            ) : (
              <Image
                source={require("../../assets/icon.png")}
                style={{ width: 220, height: 220, borderRadius: 110 }}
              />
            )}
          </Surface>
        </Animated.View>
      </TouchableOpacity>

      {adConfig?.enabled && (
        <TouchableOpacity
          onPress={handleWheelPress}
          style={{
            marginTop: -38,
            marginBottom: 20,
            paddingHorizontal: 12,
            paddingVertical: 3,
            borderRadius: 12,
            backgroundColor: theme.colors.secondaryContainer,
            borderWidth: 1,
            borderColor: theme.colors.secondary,
          }}
        >
          <Text variant="labelSmall" style={{ color: theme.colors.secondary, fontWeight: 'bold', letterSpacing: 1 }}>
            {adConfig.sponsorName ? `SPONSORED • ${adConfig.sponsorName.toUpperCase()}` : 'SPONSORED'}
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.infoContainer}>
        <View style={{ flex: 1 }}>
          <Text variant="headlineMedium" numberOfLines={1} ellipsizeMode="tail" style={[styles.songName, { color: theme.colors.onSurface }]}>{currentSong.name}</Text>
          <Text variant="labelLarge" style={{ color: theme.colors.secondary, textAlign: 'center', marginTop: 5, fontWeight: 'bold' }}>
            {theme.dark ? 'NIGHT DRIVE' : 'DAWN MELODY'}
          </Text>
        </View>
        <IconButton
          icon={currentSong.isFavorite ? 'heart' : 'heart-outline'}
          iconColor={currentSong.isFavorite ? theme.colors.primary : theme.colors.onSurface}
          onPress={() => toggleFavorite(currentSong.id)}
        />
      </View>

      <View style={styles.progressContainer}>
        <View
          ref={sliderViewRef}
          style={styles.sliderTouchArea}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            sliderWidthRef.current = w;
            if (sliderViewRef.current) {
              sliderViewRef.current.measure((x, y, width, height, pageX) => {
                if (pageX) sliderPageXRef.current = pageX;
                if (width) sliderWidthRef.current = width;
              });
            }
          }}
          {...panResponder.panHandlers}
        >
          {/* Background Track */}
          <View style={[styles.sliderTrack, { backgroundColor: theme.dark ? '#333A4D' : '#E0E0E0' }]}>
            {/* Active Progress Fill */}
            <View
              style={[
                styles.sliderFill,
                {
                  width: `${progressRatio * 100}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>

          {/* Draggable Thumb */}
          <View
            style={[
              styles.sliderThumb,
              {
                left: `${progressRatio * 100}%`,
                backgroundColor: theme.colors.primary,
                borderColor: '#FFFFFF',
                transform: [
                  { translateX: -10 },
                  { scale: isScrubbing ? 1.25 : 1 }
                ],
              },
            ]}
          />
        </View>

        <View style={styles.timeContainer}>
          <Text
            variant="labelSmall"
            style={{
              color: isScrubbing ? theme.colors.primary : theme.colors.onSurfaceVariant,
              fontWeight: isScrubbing ? 'bold' : 'normal',
            }}
          >
            {formatTime(currentPositionMillis)}
          </Text>
          <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {formatTime(durationMillis)}
          </Text>
        </View>
      </View>

      <View style={styles.utilityControls}>
        <IconButton
          icon={isShuffle ? 'shuffle-variant' : 'shuffle-disabled'}
          iconColor={isShuffle ? theme.colors.secondary : theme.colors.onSurfaceVariant}
          onPress={toggleShuffle}
        />
        <IconButton
          icon={repeatMode === 'one' ? 'repeat-once' : repeatMode === 'all' ? 'repeat' : 'repeat-off'}
          iconColor={repeatMode !== 'none' ? theme.colors.secondary : theme.colors.onSurfaceVariant}
          onPress={toggleRepeat}
        />
      </View>

      <View style={styles.controls}>
        <IconButton
          icon="skip-backward-outline"
          size={36}
          iconColor={theme.colors.onSurface}
          onPress={previousSong}
        />
        <Surface style={[styles.playButtonSurface, { backgroundColor: theme.colors.primary }]} elevation={5}>   
          <IconButton
            icon={isPlaying ? 'pause' : 'play'}
            size={56}
            iconColor="#FFFFFF"
            onPress={isPlaying ? pauseSong : resumeSong}
          />
        </Surface>
        <IconButton
          icon="skip-forward-outline"
          size={36}
          iconColor={theme.colors.onSurface}
          onPress={nextSong}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
  },
  albumArtContainer: {
    marginBottom: 50,
  },
  surface: {
    width: 280,
    height: 280,
    borderRadius: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumArtPlaceholder: {
    margin: 0,
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 40,
    width: '100%',
  },
  songName: {
    textAlign: 'center',
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  progressContainer: {
    width: '100%',
    marginBottom: 40,
  },
  sliderTouchArea: {
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    borderRadius: 3,
  },
  sliderThumb: {
    position: 'absolute',
    top: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  timeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  utilityControls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    width: '100%',
    marginBottom: 30,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  playButtonSurface: {
    borderRadius: 40,
    marginHorizontal: 40,
  }
});

export default PlayerScreen;




