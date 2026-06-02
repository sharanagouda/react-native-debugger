# Privacy Policy — ReactoRadar

**Last updated:** June 2, 2026

## Overview

ReactoRadar is a local development tool for debugging React Native applications. It runs entirely on your machine and does not collect, transmit, or store any personal data.

## Data Collection

**ReactoRadar does not collect any data.** Specifically:

- No analytics or telemetry
- No crash reporting to external servers
- No user tracking or identification
- No cookies or browser fingerprinting
- No data sent to any third-party service
- No internet connection required (except to connect to your local Metro bundler)

## How It Works

All communication happens **locally on your machine** between:

- The ReactoRadar app (Electron) — runs on `localhost`
- Your React Native app (via RNDebugSDK) — connects via WebSocket to `localhost`
- Metro bundler — accessed at `localhost:8081`

No data leaves your local network.

## Data Handled

The following data is processed **locally only** and never transmitted externally:

- Console logs from your React Native app
- Network requests and responses (API calls your app makes)
- Redux state and dispatched actions
- AsyncStorage key/value pairs
- Performance metrics (FPS, memory usage)

All of this data exists only in the app's memory while it's running. Nothing is persisted to disk except your theme preference (stored in the Electron app's `localStorage`).

## Third-Party Services

ReactoRadar does not integrate with any third-party services. The only external network requests are:

- **Google Fonts** — loaded in the UI for the JetBrains Mono and Syne typefaces
- **npm registry** — only when you run `npx reactoradar` to install/update

## App Store

This app is not distributed through the Apple App Store. It is available as:

- An npm package: `npx reactoradar`
- A `.dmg` download from [GitHub Releases](https://github.com/sharanagouda/react-native-debugger/releases)
- Source code on [GitHub](https://github.com/sharanagouda/react-native-debugger)

Since the app is not notarized with Apple, macOS will show a Gatekeeper warning on first launch. This does not indicate any security risk — it simply means the app was not submitted to Apple for review.

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/sharanagouda/react-native-debugger/issues

## Changes

This privacy policy may be updated. Changes will be posted to this file in the repository.
