import React from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, Switch, Divider, useTheme } from 'react-native-paper';

const SettingsScreen = ({ route }: any) => {
  const theme = useTheme();
  const { toggleTheme } = route.params;
  const isDarkMode = theme.dark;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={{ flex: 1 }}>
        <View style={styles.section}>
          <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary, letterSpacing: 1.2, textTransform: 'uppercase', fontSize: 14 }]}>General</Text>
          <View style={styles.row}>
            <Text style={{ color: theme.colors.onSurface }}>Dark Mode</Text>
            <Switch value={isDarkMode} onValueChange={toggleTheme} color={theme.colors.primary} />
          </View>
        </View>
        <Divider />
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: theme.colors.outline }]}>
        <Text style={{ color: theme.colors.onSurfaceVariant, letterSpacing: 2, fontWeight: 'bold', fontSize: 11 }}>
          ALL RIGHTS RESERVED TO SHAHID®
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
  footer: {
    padding: 20,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
  }
});

export default SettingsScreen;
