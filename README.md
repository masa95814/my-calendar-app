# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with
[`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app
  development with Expo

You can start developing by editing the files inside the **src/screens**
directory. The app entry point is `src/screens/app.tsx` (see `main` in
`package.json`).

## Configuration

Copy `.env.example` to `.env` and fill in the values (`EXPO_PUBLIC_*` variables
are public and get embedded in the build; never put secrets there). The app
signs in through the backend in `server/`, so start the backend first (see
[server/README.md](server/README.md)).

Local development targets:

- iOS Simulator and Web: `localhost` works for both the backend and the
  Firebase emulators
- Android Emulator: run `adb reverse tcp:8080 tcp:8080` (and `tcp:9099` for the
  Auth emulator) so `localhost` reaches your machine
- Physical device: the Google OAuth redirect goes to `localhost:8080` on the
  device itself, so use a deployed backend (Cloud Run) instead

## Project layout

- Root: Expo app (iOS / Android / Web)
- [server/](server/): backend for Cloud Run (Node.js 22 + TypeScript). See
  [server/README.md](server/README.md)
- [docs/](docs/): requirements and design
  ([docs/requirements-and-design.md](docs/requirements-and-design.md))

## Learn more

To learn more about developing your project with Expo, look at the following
resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into
  advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a
  step-by-step tutorial where you'll create a project that runs on Android, iOS,
  and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform
  and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask
  questions.
