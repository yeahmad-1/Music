# 🎵 Offline Music App (iOS & Android)

A sleek, offline music player built with React Native and Expo (SDK 54). Features full background audio playback, document importing, playlist management, shuffle & repeat modes, and a Synthwave Night / Sakura Minimalist dual theme.

---

## ✨ Features

- **📂 Offline Document Importing**: Import audio tracks (`.mp3`, `.m4a`, `.wav`, etc.) directly from your device storage or iCloud Drive via native document picker.
- **🎧 Seamless Background Playback**: Configured with iOS `UIBackgroundModes` audio and Expo AV for persistent background audio even when the screen is locked.
- **🔀 Playback Modes**: Loop one track, loop entire playlist, or shuffle music seamlessly.
- **❤️ Favorites & Custom Playlists**: Organize your library into personalized playlists and like your favorite tracks.
- **↕️ Drag & Drop Reordering**: Reorder songs in your library queue dynamically.
- **🎨 Dual Aesthetic Themes**:
  - **Synthwave Night (Dark)**: Deep navy, neon cyan, and hot pink accents.
  - **Sakura Minimalist (Light)**: Soft tint surface with vibrant cherry accents.
- **🛡️ iOS Sandbox Resilient**: Local document paths are automatically reconciled across app restarts and iOS container updates.

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v18 or later recommended)
- npm or yarn
- Expo Go on your iOS/Android device (or Xcode / Android Studio for native development builds)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/<your-username>/OfflineMusicApp.git
   cd OfflineMusicApp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm start
   # or
   npx expo start
   ```

---

## 📱 Running on iOS

### Option 1: Expo Go (Quickest)
1. Install **Expo Go** from the App Store on your iPhone or iPad.
2. Run `npm start` in your terminal.
3. Open the iOS Camera app and scan the QR code displayed in the terminal.

### Option 2: iOS Simulator (macOS)
```bash
npm run ios
```

### Option 3: EAS Build (Production / Ad-Hoc / TestFlight)
```bash
npx eas build --platform ios
```

---

## 🛠️ Tech Stack

- **Framework**: [React Native](https://reactnative.dev/) 0.81 / [Expo](https://expo.dev/) SDK 54
- **UI Components**: [React Native Paper](https://callstack.github.io/react-native-paper/) (Material Design 3)
- **Navigation**: [React Navigation](https://reactnavigation.org/) v7 (Stack Navigator)
- **Audio Engine**: `expo-av`
- **File & Storage**: `expo-file-system`, `expo-document-picker`, `@react-native-async-storage/async-storage`
- **Gestures & Lists**: `react-native-gesture-handler`, `react-native-draglist`

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
