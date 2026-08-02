// app.config.ts — the single source of truth for native configuration.
//
// This project does NOT use EAS and does NOT use app.json. Native projects are
// generated on demand:
//
//   pnpm exec expo prebuild --clean       # regenerate android/ + ios/
//   pnpm ios --device                     # run on a connected iPhone
//   cd android && ./gradlew assembleRelease
//
// android/ and ios/ are gitignored — they are build output, not source. Every
// native setting (permissions, plugins, icons, bundle ids) must be expressed
// here, because prebuild overwrites anything hand-edited inside them.
//
// TypeScript is genuinely useful here: ExpoConfig catches a mistyped key like
// `bundleIdentifer`, which as plain JSON would silently do nothing and only
// surface as a broken build.
import type { ConfigContext, ExpoConfig } from "expo/config";

const IS_DEV = process.env.APP_VARIANT === "development";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: IS_DEV ? "Nexus CRM (Dev)" : "Nexus CRM",
  slug: "eCRM",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  scheme: "nexuscrm",

  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV ? "com.shadowider.eCRM.dev" : "com.shadowider.eCRM",
    infoPlist: {
      // Shown verbatim in the iOS permission dialog. iOS crashes the picker at
      // runtime — and rejects the build at review — if the matching key is
      // missing, so every picker we use has its string here.
      NSCameraUsageDescription:
        "Nexus CRM uses the camera so you can attach a photo to a task.",
      NSPhotoLibraryUsageDescription:
        "Nexus CRM needs access to your photos so you can attach images to a task.",
      NSPhotoLibraryAddUsageDescription:
        "Nexus CRM saves attachments you download to your photo library.",
      NSMicrophoneUsageDescription:
        "Nexus CRM uses the microphone when you attach a video to a task.",
    },
  },

  android: {
    package: IS_DEV ? "com.shadowider.eCRM.dev" : "com.shadowider.eCRM",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#3F4FAF",
    },
    // READ_MEDIA_IMAGES/VIDEO are the Android 13+ replacements for
    // READ_EXTERNAL_STORAGE; expo-image-picker needs them to read the gallery.
    permissions: [
      "android.permission.CAMERA",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
    ],
  },

  web: { favicon: "./assets/favicon.png" },

  plugins: [
    "expo-dev-client",
    "@react-native-community/datetimepicker",
    "expo-sharing",
    [
      "expo-font",
      {
        fonts: [
          "./assets/fonts/Inter_400Regular.ttf",
          "./assets/fonts/Inter_500Medium.ttf",
          "./assets/fonts/Inter_600SemiBold.ttf",
          "./assets/fonts/Inter_700Bold.ttf",
          "./assets/fonts/Inter_900Black.ttf",
        ],
      },
    ],
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "Nexus CRM needs access to your photos so you can attach images to a task.",
        cameraPermission:
          "Nexus CRM uses the camera so you can attach a photo to a task.",
      },
    ],
  ],
});
