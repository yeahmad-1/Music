import React, { useState, useLayoutEffect } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { List, IconButton, Text, Divider, Searchbar, useTheme, SegmentedButtons, Menu, Appbar, Dialog, Portal, TextInput, Button, ActivityIndicator } from 'react-native-paper';
import * as DocumentPicker from 'expo-document-picker';
import { useAudio, Song } from '../context/AudioContext';

const LibraryScreen = ({ navigation }: any) => {
  const {
    playlist,
    customPlaylists,
    importSongs,
    downloadFromYoutube,
    playSong,
    deleteSong,
    deleteSongsBulk,
    currentSong,
    isPlaying,
    toggleFavorite,
    setFavoritesBulk,
    createCustomPlaylist,
    deleteCustomPlaylist,
    updatePlaylistOrder,
    updateCustomPlaylistOrder,
    removeSongsFromCustomPlaylist,
  } = useAudio();
  const theme = useTheme();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [menuVisible, setMenuVisible] = useState(false);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isSortDialogVisible, setIsSortDialogVisible] = useState(false);

  const [isPlaylistModalVisible, setIsPlaylistModalVisible] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [viewingPlaylistId, setViewingPlaylistId] = useState<string | null>(null);

  // Single Song Action Menu & Delete confirmation
  const [selectedSongForAction, setSelectedSongForAction] = useState<Song | null>(null);
  const [songToDelete, setSongToDelete] = useState<Song | null>(null);
  const [isBulkDeleteConfirmVisible, setIsBulkDeleteConfirmVisible] = useState(false);

  // YouTube Downloader State
  const [isYoutubeModalVisible, setIsYoutubeModalVisible] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubeCustomTitle, setYoutubeCustomTitle] = useState('');
  const [isDownloadingYt, setIsDownloadingYt] = useState(false);
  const [ytDownloadError, setYtDownloadError] = useState<string | null>(null);

  let currentDisplayList: Song[] = [];
  if (viewingPlaylistId) {
    const cp = customPlaylists.find(p => p.id === viewingPlaylistId);
    if (cp) {
      currentDisplayList = playlist.filter(s => cp.songIds.includes(s.id));
      currentDisplayList.sort((a, b) => cp.songIds.indexOf(a.id) - cp.songIds.indexOf(b.id));
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

  const toggleSelectAll = () => {
    if (selectedIds.length === currentDisplayList.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(currentDisplayList.map(s => s.id));
    }
  };

  useLayoutEffect(() => {
    if (selectedIds.length > 0) {
      navigation.setOptions({
        headerTitle: `${selectedIds.length} Selected`,
        headerLeft: () => (
          <Appbar.Action icon="close" onPress={() => setSelectedIds([])} />
        ),
        headerRight: () => (
          <View style={{ flexDirection: 'row' }}>
            <Appbar.Action
              icon={selectedIds.length === currentDisplayList.length ? 'checkbox-marked-circle' : 'checkbox-marked-circle-outline'}
              onPress={toggleSelectAll}
            />
            <Appbar.Action icon="playlist-plus" onPress={() => setIsPlaylistModalVisible(true)} />
            <Appbar.Action icon="heart" onPress={handleBulkFavorite} />
            <Appbar.Action icon="delete" onPress={() => setIsBulkDeleteConfirmVisible(true)} />
          </View>
        ),
        headerStyle: { backgroundColor: theme.colors.primaryContainer, elevation: 0 },
        headerTintColor: theme.colors.onPrimaryContainer,
      });
    } else {
      const currentPlaylistName = viewingPlaylistId
        ? (customPlaylists.find(p => p.id === viewingPlaylistId)?.name || 'Playlist')
        : 'My Library';

      navigation.setOptions({
        headerTitle: currentPlaylistName,
        headerLeft: viewingPlaylistId ? () => (
          <Appbar.BackAction onPress={() => setViewingPlaylistId(null)} />
        ) : undefined,
        headerStyle: { backgroundColor: theme.colors.surface, elevation: 0 },
        headerTintColor: theme.colors.onSurface,
        headerTitleStyle: { fontWeight: '900', letterSpacing: 1 },
        headerRight: () => (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {isReorderMode ? (
              <IconButton
                icon="check-bold"
                iconColor={theme.colors.primary}
                onPress={() => setIsReorderMode(false)}
              />
            ) : (
              (activeTab === 'all' || viewingPlaylistId) && !searchQuery && (
                <IconButton
                  icon="sort-variant"
                  onPress={() => setIsSortDialogVisible(true)}
                />
              )
            )}
            {!isReorderMode && (
              <IconButton
                icon="checkbox-multiple-marked-outline"
                onPress={() => {
                  if (currentDisplayList.length > 0) {
                    setSelectedIds([currentDisplayList[0].id]);
                  }
                }}
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
              <Menu.Item
                onPress={() => { setMenuVisible(false); setIsSortDialogVisible(true); }}
                title="Arrange / Sort Songs"
                leadingIcon="sort-variant"
              />
              <Menu.Item
                onPress={() => {
                  setMenuVisible(false);
                  if (currentDisplayList.length > 0) {
                    setSelectedIds([currentDisplayList[0].id]);
                  }
                }}
                title="Select Songs"
                leadingIcon="checkbox-multiple-marked-outline"
              />
              <Divider />
              <Menu.Item onPress={() => { setMenuVisible(false); setIsYoutubeModalVisible(true); }} title="Download from YouTube" leadingIcon="youtube" />
              <Menu.Item onPress={() => { setMenuVisible(false); handlePickDocument(); }} title="Import Music" leadingIcon="file-import" />
              <Menu.Item onPress={() => { setMenuVisible(false); navigation.navigate('Settings'); }} title="Settings" leadingIcon="cog" />
            </Menu>
          </View>
        ),
      });
    }
  }, [navigation, selectedIds, menuVisible, theme, isReorderMode, viewingPlaylistId, activeTab, customPlaylists, searchQuery, currentDisplayList.length]);

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
    if (viewingPlaylistId) {
      await removeSongsFromCustomPlaylist(viewingPlaylistId, selectedIds);
    } else {
      await deleteSongsBulk(selectedIds);
    }
    setSelectedIds([]);
    setIsBulkDeleteConfirmVisible(false);
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

  const handleMoveSong = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= currentDisplayList.length) return;
    const copy = [...currentDisplayList];
    const [moved] = copy.splice(fromIndex, 1);
    copy.splice(toIndex, 0, moved);

    if (viewingPlaylistId) {
      await updateCustomPlaylistOrder(viewingPlaylistId, copy.map(s => s.id));
    } else {
      await updatePlaylistOrder(copy);
    }
  };

  const handleMoveToTop = async (songId: string) => {
    const index = currentDisplayList.findIndex(s => s.id === songId);
    if (index > 0) {
      await handleMoveSong(index, 0);
    }
  };

  const handleMoveToBottom = async (songId: string) => {
    const index = currentDisplayList.findIndex(s => s.id === songId);
    if (index >= 0 && index < currentDisplayList.length - 1) {
      await handleMoveSong(index, currentDisplayList.length - 1);
    }
  };

  const handleQuickSort = async (type: 'name-asc' | 'name-desc' | 'date-desc' | 'date-asc') => {
    const sorted = [...currentDisplayList].sort((a, b) => {
      if (type === 'name-asc') return a.name.localeCompare(b.name);
      if (type === 'name-desc') return b.name.localeCompare(a.name);
      if (type === 'date-desc') return (b.addedAt || 0) - (a.addedAt || 0);
      if (type === 'date-asc') return (a.addedAt || 0) - (b.addedAt || 0);
      return 0;
    });

    if (viewingPlaylistId) {
      await updateCustomPlaylistOrder(viewingPlaylistId, sorted.map(s => s.id));
    } else {
      await updatePlaylistOrder(sorted);
    }
    setIsSortDialogVisible(false);
  };

  const renderPlaylistItem = ({ item }: { item: any }) => (
    <List.Item
      title={item.name}
      description={`${item.songIds.length} songs`}
      left={props => (
        <List.Icon
          {...props}
          icon={() => (
            <Image
              source={require('../../assets/icon.png')}
              style={{ width: 40, height: 40, borderRadius: 20 }}
            />
          )}
        />
      )}
      right={props => (
        <IconButton
          {...props}
          icon="delete-outline"
          onPress={() => deleteCustomPlaylist(item.id)}
        />
      )}
      onPress={() => setViewingPlaylistId(item.id)}
      style={styles.listItem}
    />
  );

  const renderItem = ({ item, index }: { item: Song; index: number }) => {
    const isCurrentlyPlaying = currentSong?.id === item.id;
    const isSelected = selectedIds.includes(item.id);
    const selectionMode = selectedIds.length > 0;

    if (isReorderMode) {
      return (
        <View
          style={[
            styles.reorderItem,
            {
              backgroundColor: isCurrentlyPlaying
                ? theme.dark
                  ? '#1E293B'
                  : '#E0E7FF'
                : theme.colors.surface,
              borderColor: theme.colors.outlineVariant,
            },
          ]}
        >
          {/* Position index badge */}
          <View
            style={[
              styles.indexBadge,
              { backgroundColor: theme.colors.primaryContainer },
            ]}
          >
            <Text
              variant="labelSmall"
              style={{
                color: theme.colors.onPrimaryContainer,
                fontWeight: 'bold',
              }}
            >
              #{index + 1}
            </Text>
          </View>

          {/* Title */}
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text
              variant="bodyMedium"
              numberOfLines={1}
              style={{
                color: isCurrentlyPlaying ? theme.colors.primary : theme.colors.onSurface,
                fontWeight: isCurrentlyPlaying ? 'bold' : '500',
              }}
            >
              {item.name}
            </Text>
          </View>

          {/* Up & Down Reorder Buttons */}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton
              icon="chevron-up"
              size={24}
              disabled={index === 0}
              iconColor={index === 0 ? theme.colors.outline : theme.colors.primary}
              onPress={() => handleMoveSong(index, index - 1)}
            />
            <IconButton
              icon="chevron-down"
              size={24}
              disabled={index === currentDisplayList.length - 1}
              iconColor={
                index === currentDisplayList.length - 1
                  ? theme.colors.outline
                  : theme.colors.primary
              }
              onPress={() => handleMoveSong(index, index + 1)}
            />
          </View>
        </View>
      );
    }

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onLongPress={() => {
          if (!selectionMode && !isReorderMode) toggleSelection(item.id);
        }}
        onPress={() => {
          if (selectionMode) {
            toggleSelection(item.id);
          } else {
            if (currentSong?.id !== item.id) {
              playSong(item, viewingPlaylistId ? currentDisplayList : undefined);
            }
            navigation.navigate('Player');
          }
        }}
      >
        <List.Item
          title={item.name}
          left={props => {
            if (selectionMode) {
              return (
                <List.Icon
                  {...props}
                  icon={isSelected ? 'check-circle' : 'circle-outline'}
                  color={isSelected ? theme.colors.primary : theme.colors.outline}
                />
              );
            }
            return (
              <List.Icon
                {...props}
                icon={() => (
                  <Image
                    source={require('../../assets/icon.png')}
                    style={{ width: 40, height: 40, borderRadius: 20 }}
                  />
                )}
              />
            );
          }}
          right={props => {
            if (selectionMode) return null;
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <IconButton
                  icon={item.isFavorite ? 'heart' : 'heart-outline'}
                  size={20}
                  iconColor={item.isFavorite ? theme.colors.primary : theme.colors.onSurfaceVariant}
                  onPress={() => toggleFavorite(item.id)}
                />
                <IconButton
                  icon="dots-vertical"
                  size={20}
                  iconColor={theme.colors.onSurfaceVariant}
                  onPress={() => setSelectedSongForAction(item)}
                />
              </View>
            );
          }}
          titleStyle={{
            color:
              isCurrentlyPlaying && !selectionMode
                ? theme.colors.primary
                : theme.colors.onSurface,
            fontWeight: isCurrentlyPlaying ? 'bold' : 'normal',
          }}
          style={[
            styles.listItem,
            isSelected
              ? { backgroundColor: theme.colors.secondaryContainer }
              : isCurrentlyPlaying
              ? {
                  backgroundColor: theme.colors.primaryContainer,
                  borderRadius: 12,
                  marginHorizontal: 8,
                  marginVertical: 4,
                }
              : undefined,
          ]}
        />
      </TouchableOpacity>
    );
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
            onValueChange={val => {
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

      {/* Arrange Mode Banner */}
      {isReorderMode && (
        <View
          style={[
            styles.reorderBanner,
            { backgroundColor: theme.colors.secondaryContainer },
          ]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <IconButton icon="swap-vertical" iconColor={theme.colors.secondary} size={20} />
            <Text
              variant="labelMedium"
              style={{
                color: theme.colors.onSecondaryContainer,
                fontWeight: 'bold',
                flex: 1,
              }}
            >
              Arrange Mode • Tap ▲ or ▼ to move songs
            </Text>
          </View>
          <Button
            mode="contained-tonal"
            compact
            onPress={() => setIsReorderMode(false)}
          >
            Done
          </Button>
        </View>
      )}

      {activeTab === 'playlists' && !viewingPlaylistId ? (
        <FlatList
          data={customPlaylists}
          keyExtractor={item => item.id}
          renderItem={renderPlaylistItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          initialNumToRender={50}
          maxToRenderPerBatch={50}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => (
            <Divider style={{ backgroundColor: 'transparent', height: 8 }} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
                No playlists yet.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={currentDisplayList}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          initialNumToRender={50}
          maxToRenderPerBatch={50}
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => (
            <Divider style={{ backgroundColor: 'transparent', height: 4 }} />
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text variant="titleMedium" style={{ color: theme.colors.onSurface }}>
                {activeTab === 'recent'
                  ? 'No recently added songs.'
                  : activeTab === 'favorites'
                  ? 'No favorites yet.'
                  : 'Empty library.'}
              </Text>
            </View>
          }
        />
      )}

      <Portal>
        {/* Sort & Arrange Options Dialog */}
        <Dialog
          visible={isSortDialogVisible}
          onDismiss={() => setIsSortDialogVisible(false)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title style={{ fontWeight: 'bold' }}>Arrange & Sort</Dialog.Title>
          <Dialog.Content>
            <List.Item
              title="Manual Arrange (Move Up / Down)"
              description="Move songs up and down using controls"
              left={props => <List.Icon {...props} icon="swap-vertical" color={theme.colors.primary} />}
              onPress={() => {
                setIsSortDialogVisible(false);
                setIsReorderMode(true);
              }}
            />
            <Divider style={{ marginVertical: 4 }} />
            <List.Item
              title="Sort by Name (A → Z)"
              left={props => <List.Icon {...props} icon="sort-alphabetical-ascending" />}
              onPress={() => handleQuickSort('name-asc')}
            />
            <List.Item
              title="Sort by Name (Z → A)"
              left={props => <List.Icon {...props} icon="sort-alphabetical-descending" />}
              onPress={() => handleQuickSort('name-desc')}
            />
            <List.Item
              title="Sort by Date Added (Newest first)"
              left={props => <List.Icon {...props} icon="sort-clock-ascending-outline" />}
              onPress={() => handleQuickSort('date-desc')}
            />
            <List.Item
              title="Sort by Date Added (Oldest first)"
              left={props => <List.Icon {...props} icon="sort-clock-descending-outline" />}
              onPress={() => handleQuickSort('date-asc')}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setIsSortDialogVisible(false)}>Cancel</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Single Song Action Modal */}
        <Dialog
          visible={!!selectedSongForAction}
          onDismiss={() => setSelectedSongForAction(null)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title numberOfLines={1} ellipsizeMode="tail">
            {selectedSongForAction?.name}
          </Dialog.Title>
          <Dialog.Content>
            <List.Item
              title="Play Song"
              left={props => <List.Icon {...props} icon="play-circle-outline" />}
              onPress={() => {
                if (selectedSongForAction) {
                  playSong(
                    selectedSongForAction,
                    viewingPlaylistId ? currentDisplayList : undefined
                  );
                  navigation.navigate('Player');
                }
                setSelectedSongForAction(null);
              }}
            />
            <List.Item
              title={
                selectedSongForAction?.isFavorite
                  ? 'Remove from Favorites'
                  : 'Add to Favorites'
              }
              left={props => (
                <List.Icon
                  {...props}
                  icon={selectedSongForAction?.isFavorite ? 'heart-broken' : 'heart'}
                  color={theme.colors.primary}
                />
              )}
              onPress={() => {
                if (selectedSongForAction) {
                  toggleFavorite(selectedSongForAction.id);
                }
                setSelectedSongForAction(null);
              }}
            />
            <List.Item
              title="Add to Playlist"
              left={props => <List.Icon {...props} icon="playlist-plus" />}
              onPress={() => {
                if (selectedSongForAction) {
                  setSelectedIds([selectedSongForAction.id]);
                  setIsPlaylistModalVisible(true);
                }
                setSelectedSongForAction(null);
              }}
            />
            {viewingPlaylistId && (
              <List.Item
                title="Remove from this Playlist"
                left={props => (
                  <List.Icon {...props} icon="playlist-remove" color={theme.colors.error} />
                )}
                titleStyle={{ color: theme.colors.error }}
                onPress={async () => {
                  if (selectedSongForAction && viewingPlaylistId) {
                    await removeSongsFromCustomPlaylist(viewingPlaylistId, [
                      selectedSongForAction.id,
                    ]);
                  }
                  setSelectedSongForAction(null);
                }}
              />
            )}
            <List.Item
              title="Move to Top"
              left={props => (
                <List.Icon {...props} icon="arrow-up-bold-box-outline" />
              )}
              onPress={() => {
                if (selectedSongForAction) {
                  handleMoveToTop(selectedSongForAction.id);
                }
                setSelectedSongForAction(null);
              }}
            />
            <List.Item
              title="Move to Bottom"
              left={props => (
                <List.Icon {...props} icon="arrow-down-bold-box-outline" />
              )}
              onPress={() => {
                if (selectedSongForAction) {
                  handleMoveToBottom(selectedSongForAction.id);
                }
                setSelectedSongForAction(null);
              }}
            />
            <Divider style={{ marginVertical: 8 }} />
            <List.Item
              title="Delete Song"
              left={props => (
                <List.Icon {...props} icon="delete-outline" color={theme.colors.error} />
              )}
              titleStyle={{ color: theme.colors.error }}
              onPress={() => {
                setSongToDelete(selectedSongForAction);
                setSelectedSongForAction(null);
              }}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSelectedSongForAction(null)}>Close</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Single Song Delete Confirmation Dialog */}
        <Dialog
          visible={!!songToDelete}
          onDismiss={() => setSongToDelete(null)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title>Delete Song?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              Are you sure you want to permanently delete "{songToDelete?.name}"?
              This audio file will be removed from your storage.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSongToDelete(null)}>Cancel</Button>
            <Button
              textColor={theme.colors.error}
              onPress={async () => {
                if (songToDelete) {
                  await deleteSong(songToDelete.id);
                  setSongToDelete(null);
                }
              }}
            >
              Delete
            </Button>
          </Dialog.Actions>
        </Dialog>

        {/* Bulk Delete Confirmation Dialog */}
        <Dialog
          visible={isBulkDeleteConfirmVisible}
          onDismiss={() => setIsBulkDeleteConfirmVisible(false)}
          style={{ backgroundColor: theme.colors.surface }}
        >
          <Dialog.Title>
            {viewingPlaylistId ? 'Remove Songs?' : 'Delete Songs?'}
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">
              {viewingPlaylistId
                ? `Remove ${selectedIds.length} songs from this playlist?`
                : `Permanently delete ${selectedIds.length} songs from your library? This cannot be undone.`}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setIsBulkDeleteConfirmVisible(false)}>
              Cancel
            </Button>
            <Button
              textColor={theme.colors.error}
              onPress={handleBulkDelete}
            >
              {viewingPlaylistId ? 'Remove' : 'Delete'}
            </Button>
          </Dialog.Actions>
        </Dialog>

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
  container: {
    flex: 1,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  headerPadding: {
    paddingBottom: 10,
    flexShrink: 0,
  },
  searchBar: { margin: 16, borderRadius: 12, elevation: 0, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)' },
  segmentedControl: { marginHorizontal: 16, marginBottom: 16 },
  reorderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
  },
  reorderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginHorizontal: 12,
    marginVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  indexBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  listItem: { paddingVertical: 4 },
  list: {
    flex: 1,
    height: '100%',
    minHeight: 0,
  },
  listContent: {
    paddingBottom: 160,
    flexGrow: 1,
  },
});

export default LibraryScreen;







