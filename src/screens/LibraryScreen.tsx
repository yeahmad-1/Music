import React, { useState, useLayoutEffect } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { List, IconButton, Text, Divider, Searchbar, useTheme, SegmentedButtons, Menu, Appbar, Dialog, Portal, TextInput, Button, ActivityIndicator } from 'react-native-paper';
import * as DocumentPicker from 'expo-document-picker';
import { useAudio } from '../context/AudioContext';
import DragList, { DragListRenderItemInfo } from 'react-native-draglist';

const LibraryScreen = ({ navigation }: any) => {
  const { playlist, customPlaylists, importSongs, downloadFromYoutube, playSong, deleteSongsBulk, currentSong, isPlaying, setFavoritesBulk, createCustomPlaylist, deleteCustomPlaylist, updatePlaylistOrder } = useAudio();
  const theme = useTheme();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);

  const [isPlaylistModalVisible, setIsPlaylistModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [viewingPlaylistId, setViewingPlaylistId] = useState<string | null>(null);

  // YouTube Downloader State
  const [isYoutubeModalVisible, setIsYoutubeModalVisible] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeCustomTitle, setYoutubeCustomTitle] = useState('');
  const [isDownloadingYt, setIsDownloadingYt] = useState(false);
  const [ytDownloadError, setYtDownloadError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (selectedIds.length > 0) {
      navigation.setOptions({
        headerTitle: `${selectedIds.length} Selected`,
        headerLeft: () => (
          <Appbar.Action icon="close" onPress={() => setSelectedIds([])} />
        ),
        headerRight: () => (
          <View style={{ flexDirection: 'row' }}>
            <Appbar.Action icon="playlist-plus" onPress={() => setIsPlaylistModalVisible(true)} />
            <Appbar.Action icon="heart" onPress={handleBulkFavorite} />
            <Appbar.Action icon="delete" onPress={handleBulkDelete} />
          </View>
        ),
        headerStyle: { backgroundColor: theme.colors.primaryContainer, elevation: 0 },
        headerTintColor: theme.colors.onPrimaryContainer,
      });
    } else {
      navigation.setOptions({
        headerTitle: viewingPlaylistId ? (customPlaylists.find(p => p.id === viewingPlaylistId)?.name || 'Playlist') : 'My Library',
        headerLeft: viewingPlaylistId ? () => (
          <Appbar.BackAction onPress={() => setViewingPlaylistId(null)} />
        ) : undefined,
        headerStyle: { backgroundColor: theme.colors.surface, elevation: 0 },
        headerTintColor: theme.colors.onSurface,
        headerTitleStyle: { fontWeight: '900', letterSpacing: 1 },
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {activeTab === 'all' && !viewingPlaylistId && !searchQuery && (
              <IconButton
                icon={isReorderMode ? 'check' : 'sort'}
                onPress={() => setIsReorderMode(!isReorderMode)}
              />
            )}
            <IconButton
              icon="youtube"
              iconColor="#FF0000"
              onPress={() => {
                setYtDownloadError(null);
                setIsYoutubeModalVisible(true);
              }}
            />
            <Menu
              visible={menuVisible}
              onDismiss={() => setMenuVisible(false)}
              anchor={<Appbar.Action icon="dots-vertical" onPress={() => setMenuVisible(true)} />}>
              <Menu.Item onPress={() => { setMenuVisible(false); setIsYoutubeModalVisible(true); }} title="Download from YouTube" leadingIcon="youtube" />
              <Menu.Item onPress={() => { setMenuVisible(false); handlePickDocument(); }} title="Import Music" leadingIcon="file-import" />
              <Menu.Item onPress={() => { setMenuVisible(false); navigation.navigate('Settings'); }} title="Settings" leadingIcon="cog" />
            </Menu>
          </View>
        ),
      });
    }
  }, [navigation, selectedIds, menuVisible, theme, isReorderMode, viewingPlaylistId, activeTab, customPlaylists, searchQuery]);

  const handlePickDocument = async () => {
    try {
      const audioTypes = Platform.OS === 'ios'
        ? ['audio/*', 'public.audio']
        : [
            'audio/*',
            'audio/mpeg',
            'audio/mp3',
            'audio/wav',
            'audio/x-m4a',
            'audio/aac',
            'audio/flac',
            'audio/ogg',
            '.mp3',
            '.wav',
            '.m4a',
            '.aac',
            '.flac',
            '.ogg',
          ];

      const result = await DocumentPicker.getDocumentAsync({
        type: audioTypes,
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (!result.canceled && result.assets) {
        await importSongs(result.assets);
      }
    } catch (err) {
      console.error('Error picking document', err);
    }
  };

  const handleDownloadYoutube = async () => {
    if (!youtubeUrl.trim() || isDownloadingYt) return;
    setIsDownloadingYt(true);
    setYtDownloadError(null);
    try {
      const result = await downloadFromYoutube(youtubeUrl.trim(), youtubeCustomTitle.trim() || undefined);
      if (result.success) {
        setIsYoutubeModalVisible(false);
        setYoutubeUrl('');
        setYoutubeCustomTitle('');
        setActiveTab('recent');
      } else {
        setYtDownloadError(result.message || 'Download failed. Please check the URL.');
      }
    } catch (err: any) {
      setYtDownloadError(err?.message || 'Download failed.');
    } finally {
      setIsDownloadingYt(false);
    }
  };

  const handleBulkDelete = async () => {
    await deleteSongsBulk(selectedIds);
    setSelectedIds([]);
  };

  const handleBulkFavorite = async () => {
    await setFavoritesBulk(selectedIds, true);
    setSelectedIds([]);
  };

  const handleCreatePlaylist = async () => {
    if (newPlaylistName.trim() && selectedIds.length > 0) {
      await createCustomPlaylist(newPlaylistName.trim(), selectedIds);
      setNewPlaylistName('');
      setIsPlaylistModalVisible(false);
      setSelectedIds([]);
      setActiveTab('playlists');
    }
  };

  const toggleSelection = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(i => i !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  let currentDisplayList: any[] = [];
  if (viewingPlaylistId) {
    const cp = customPlaylists.find(p => p.id === viewingPlaylistId);
    if (cp) {
      currentDisplayList = playlist.filter(s => cp.songIds.includes(s.id));
    }
  } else {
    currentDisplayList = playlist.filter(song => {
      const matchesSearch = song.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesTab =
        activeTab === 'all' ||
        activeTab === 'recent' ||
        (activeTab === 'favorites' && song.isFavorite);
      return matchesSearch && matchesTab;
    });

    if (activeTab === 'recent') {
      currentDisplayList = [...currentDisplayList].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }
  }

  const renderPlaylistItem = ({ item }: { item: any }) => (
    <List.Item
      title={item.name}
      description={`${item.songIds.length} songs`}
      left={props => <List.Icon {...props} icon={() => <Image source={require("../../assets/icon.png")} style={{ width: 40, height: 40, borderRadius: 20 }} />} />}
      right={props => <IconButton {...props} icon="delete-outline" onPress={() => deleteCustomPlaylist(item.id)} />}
      onPress={() => setViewingPlaylistId(item.id)}
      style={styles.listItem}
    />
  );

  const renderItem = (info: DragListRenderItemInfo<any>) => {
    const { item, isActive } = info;
    const dragStart = info.onStartDrag || info.onDragStart || (() => {});
    const dragEnd = info.onEndDrag || info.onDragEnd || (() => {});

    const isCurrentlyPlaying = currentSong?.id === item.id;
    const isSelected = selectedIds.includes(item.id);
    const selectionMode = selectedIds.length > 0;

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onLongPress={() => {
          if (!selectionMode && !isReorderMode) toggleSelection(item.id);
        }}
        onPress={() => {
          if (isReorderMode) return;
          if (selectionMode) {
            toggleSelection(item.id);
          } else {
            if (currentSong?.id !== item.id) {
              playSong(item, viewingPlaylistId ? currentDisplayList : undefined);
            }
            navigation.navigate('Player');
          }
        }}
        style={{ elevation: isActive ? 10 : 0 }}
      >
        <List.Item
          title={item.name}
          left={props => {
            if (selectionMode) {
              return <List.Icon {...props} icon={isSelected ? 'check-circle' : 'circle-outline'} color={isSelected ? theme.colors.primary : theme.colors.outline} />;
            }
            return <List.Icon {...props} icon={() => <Image source={require("../../assets/icon.png")} style={{ width: 40, height: 40, borderRadius: 20 }} />} />;
          }}
          right={props => {
            if (isReorderMode) {
              return (
                <TouchableOpacity onPressIn={dragStart} onPressOut={dragEnd} style={{ padding: 10 }}>
                  <List.Icon {...props} icon="drag-horizontal" color={theme.colors.onSurfaceVariant} />
                </TouchableOpacity>
              );
            }
            if (!selectionMode && item.isFavorite) {
              return <List.Icon {...props} icon="heart" color={theme.colors.primary} />;
            }
            return null;
          }}
          titleStyle={{ color: isCurrentlyPlaying && !selectionMode ? theme.colors.primary : theme.colors.onSurface, fontWeight: isCurrentlyPlaying ? 'bold' : 'normal' }}
          style={[
            styles.listItem,
            isSelected ? { backgroundColor: theme.colors.secondaryContainer } : (isCurrentlyPlaying ? { backgroundColor: theme.colors.primaryContainer, borderRadius: 12, marginHorizontal: 8, marginVertical: 4 } : undefined)
          ]}
        />
      </TouchableOpacity>
    );
  };

  const onReorder = async (fromIndex: number, toIndex: number) => {
    const copy = [...currentDisplayList];
    const removed = copy.splice(fromIndex, 1);
    copy.splice(toIndex, 0, removed[0]);
    updatePlaylistOrder(copy);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {!viewingPlaylistId && (
        <View style={styles.headerPadding}>
          <Searchbar
            placeholder="Search your vibes..."
            onChangeText={setSearchQuery}
            value={searchQuery}
            style={[styles.searchBar, { backgroundColor: theme.colors.surface }]}
            iconColor={theme.colors.primary}
          />
          <SegmentedButtons
            value={activeTab}
            onValueChange={(val) => {
              setActiveTab(val);
              setIsReorderMode(false);
            }}
            buttons={[
              { value: 'all', label: 'All' },
              { value: 'recent', label: 'Recent' },
              { value: 'favorites', label: 'Liked' },
              { value: 'playlists', label: 'Lists' },
            ]}
            style={styles.segmentedControl}
          />
        </View>
      )}

      {activeTab === 'playlists' && !viewingPlaylistId ? (
        <FlatList
          data={customPlaylists}
          keyExtractor={(item) => item.id}
          renderItem={renderPlaylistItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          initialNumToRender={50}
          maxToRenderPerBatch={50}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <Divider style={{ backgroundColor: 'transparent', height: 8 }} />}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>No playlists yet.</Text>    
            </View>
          }
        />
      ) : (
        isReorderMode ? (
          <DragList
            data={currentDisplayList}
            keyExtractor={(item: any) => item.id}
            onReordered={onReorder}
            renderItem={renderItem}
            containerStyle={styles.list}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <FlatList
            data={currentDisplayList}
            keyExtractor={(item) => item.id}
            renderItem={(params) => renderItem({ ...params, onDragStart: () => {}, onDragEnd: () => {}, onStartDrag: () => {}, onEndDrag: () => {}, isActive: false })}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            initialNumToRender={50}
            maxToRenderPerBatch={50}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
            ItemSeparatorComponent={() => <Divider style={{ backgroundColor: 'transparent', height: 4 }} />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
                  {activeTab === 'recent' ? 'No recently added songs.' : activeTab === 'favorites' ? 'No favorites yet.' : 'Empty library.'}
                </Text>
              </View>
            }
          />
        )
      )}

      <Portal>
        {/* YouTube Downloader Dialog */}
        <Dialog
          visible={isYoutubeModalVisible}
          onDismiss={() => {
            if (!isDownloadingYt) {
              setIsYoutubeModalVisible(false);
              setYtDownloadError(null);
            }
          }}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title style={{ fontWeight: 'bold' }}>Download from YouTube</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 14 }}>
              Paste any YouTube video or shorts link to download its audio directly as an MP3 for offline listening.
            </Text>
            <TextInput
              label="YouTube Video / Shorts Link"
              placeholder="https://youtube.com/watch?v=..."
              value={youtubeUrl}
              onChangeText={(text) => {
                setYoutubeUrl(text);
                setYtDownloadError(null);
              }}
              mode="outlined"
              activeOutlineColor="#FF0000"
              style={{ marginBottom: 12 }}
              autoCapitalize="none"
              autoCorrect={false}
              disabled={isDownloadingYt}
            />
            <TextInput
              label="Custom Track Title (Optional)"
              placeholder="Leave blank to use video title"
              value={youtubeCustomTitle}
              onChangeText={setYoutubeCustomTitle}
              mode="outlined"
              activeOutlineColor={theme.colors.primary}
              style={{ marginBottom: 12 }}
              disabled={isDownloadingYt}
            />
            {isDownloadingYt && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
                <ActivityIndicator animating={true} color={theme.colors.primary} size="small" style={{ marginRight: 10 }} />
                <Text variant="bodySmall" style={{ color: theme.colors.primary, fontWeight: 'bold' }}>
                  Extracting audio stream & downloading MP3...
                </Text>
              </View>
            )}
            {ytDownloadError && (
              <Text variant="bodySmall" style={{ color: '#D32F2F', marginTop: 4 }}>
                {ytDownloadError}
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button
              onPress={() => {
                setIsYoutubeModalVisible(false);
                setYtDownloadError(null);
              }}
              disabled={isDownloadingYt}
            >
              Cancel
            </Button>
            <Button
              onPress={handleDownloadYoutube}
              loading={isDownloadingYt}
              disabled={!youtubeUrl.trim() || isDownloadingYt}
              textColor="#FF0000"
              icon="download"
            >
              Download
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Create Playlist Modal */}
        <Dialog visible={isPlaylistModalVisible} onDismiss={() => setIsPlaylistModalVisible(false)} style={{ backgroundColor: theme.colors.surface }}>
          <Dialog.Title>Create Playlist</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Name"
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              mode="outlined"
              activeOutlineColor={theme.colors.primary}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setIsPlaylistModalVisible(false)}>Cancel</Button>
            <Button onPress={handleCreatePlaylist} disabled={!newPlaylistName.trim()} textColor={theme.colors.primary}>Create</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerPadding: { paddingBottom: 10 },
  searchBar: { margin: 16, borderRadius: 12, elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  segmentedControl: { marginHorizontal: 16, marginBottom: 16 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  listItem: { paddingVertical: 4 },
  list: { flex: 1 },
  listContent: { paddingBottom: 120, flexGrow: 1 },
});

export default LibraryScreen;







