import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiClient } from "../../api/client";
import type { Attachment } from "../../types/api";
import { colors, spacing } from "../../theme";
import { Button, Text } from "../../ui";

interface FileViewerProps {
  attachment: Attachment | null;
  onClose: () => void;
}

type Kind = "image" | "pdf" | "other";

function kindOf(a: Attachment): Kind {
  const mime = a.MimeType ?? "";
  const ext = a.FileName.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  return "other";
}

/**
 * Views an attachment INSIDE the app. Previously every tap bounced out to the
 * OS share sheet, which is the wrong interaction for "let me look at this".
 *
 * Images render directly. PDFs go through a WebView pointed at the downloaded
 * file — WKWebView renders PDF natively on iOS. Android's WebView does NOT, so
 * there it falls back to opening in whatever PDF app the user has; that is a
 * platform limit, not a missing feature here.
 *
 * Everything else (APK, zip, office docs) has no in-app renderer and offers the
 * share sheet, which is also how an APK gets installed.
 */
export default function FileViewer({ attachment, onClose }: FileViewerProps) {
  const insets = useSafeAreaInsets();
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const kind = attachment ? kindOf(attachment) : "other";
  const canRenderInApp =
    kind === "image" || (kind === "pdf" && Platform.OS === "ios");

  useEffect(() => {
    if (!attachment) return;
    let cancelled = false;

    // State is only touched inside the async body — setting it synchronously in
    // the effect would trigger a cascading render on every open.
    (async () => {
      setUri(null);
      setFailed(false);
      setLoading(true);
      try {
        // The download endpoint is POST, so expo-file-system's GET-only task
        // cannot be used — bytes come through axios and land in cache.
        const res = await apiClient.post(
          "/api/attachments/download",
          { Id: attachment.Id },
          { responseType: "arraybuffer", timeout: 0 },
        );
        if (cancelled) return;
        const file = new File(Paths.cache, attachment.FileName);
        if (file.exists) file.delete();
        file.create();
        file.write(new Uint8Array(res.data as ArrayBuffer));
        setUri(file.uri);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachment]);

  const share = async () => {
    if (!uri) return;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: attachment?.MimeType ?? undefined,
        dialogTitle: attachment?.FileName,
      });
    }
  };

  return (
    <Modal
      visible={!!attachment}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
    >
      <View style={styles.root}>
        <View style={[styles.bar, { paddingTop: insets.top + spacing[2] }]}>
          <Pressable onPress={onClose} hitSlop={spacing[2]} style={styles.iconButton}>
            <MaterialIcons name="close" size={24} color={colors.text} />
          </Pressable>
          <Text variant="h3" numberOfLines={1} style={styles.title}>
            {attachment?.FileName ?? ""}
          </Text>
          <Pressable onPress={share} hitSlop={spacing[2]} style={styles.iconButton}>
            <MaterialIcons name="ios-share" size={22} color={colors.text} />
          </Pressable>
        </View>

        <View style={[styles.body, { paddingBottom: insets.bottom }]}>
          {loading ? <ActivityIndicator color={colors.primary} /> : null}

          {!loading && failed ? (
            <View style={styles.fallback}>
              <MaterialIcons name="cloud-off" size={30} color={colors.textMuted} />
              <Text variant="h3">Couldn&apos;t open this file</Text>
              <Text variant="secondary" align="center">
                Check your connection and try again.
              </Text>
            </View>
          ) : null}

          {!loading && !failed && uri && kind === "image" ? (
            <Image source={{ uri }} style={styles.image} resizeMode="contain" />
          ) : null}

          {!loading && !failed && uri && kind === "pdf" && canRenderInApp ? (
            <WebView
              source={{ uri }}
              style={styles.web}
              originWhitelist={["*"]}
              allowFileAccess
              allowFileAccessFromFileURLs
            />
          ) : null}

          {!loading && !failed && uri && !canRenderInApp ? (
            <View style={styles.fallback}>
              <MaterialIcons
                name="insert-drive-file"
                size={30}
                color={colors.textMuted}
              />
              <Text variant="h3">No preview for this type</Text>
              <Text variant="secondary" align="center">
                Open it in another app to view or install it.
              </Text>
              <Button title="Open in…" icon="ios-share" onPress={share} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" },
  web: { flex: 1, width: "100%", backgroundColor: colors.background },
  fallback: { alignItems: "center", gap: spacing[3], padding: spacing[8] },
});
