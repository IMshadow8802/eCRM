import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MaterialIcons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";

import {
  deleteAttachment,
  fetchAttachments,
  uploadAttachment,
  type PickedFile,
} from "../../api/attachmentQueries";
import { apiClient } from "../../api/client";
import type { Attachment, AttachmentEntity } from "../../types/api";
import { colors, radius, spacing } from "../../theme";
import { Dialog, Sheet, Text, type SheetRef } from "../../ui";
import { fileMeta, humanSize, MAX_UPLOAD_BYTES } from "./attachmentHelpers";

interface AttachmentSectionProps {
  entity: AttachmentEntity;
  entityId: number;
  /** manageArtifacts — assignees, creator, owner/manager. Viewers are read-only. */
  canManage: boolean;
}

export default function AttachmentSection({
  entity,
  entityId,
  canManage,
}: AttachmentSectionProps) {
  const queryClient = useQueryClient();
  const sheetRef = useRef<SheetRef>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);

  const queryKey = ["attachments", entity, entityId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchAttachments({ Entity: entity, EntityId: entityId }),
  });

  const upload = useMutation({
    mutationFn: uploadAttachment,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err: any) =>
      setError(err?.response?.data?.message ?? "Upload failed."),
  });

  const remove = useMutation({
    mutationFn: deleteAttachment,
    onSuccess: () => {
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const attachments = data ?? [];

  const send = (file: PickedFile, size?: number) => {
    setError(null);
    if (size != null && size > MAX_UPLOAD_BYTES) {
      setError(`"${file.name}" is larger than the 200MB limit.`);
      return;
    }
    upload.mutate({ Entity: entity, EntityId: entityId, file });
  };

  const takePhoto = async () => {
    sheetRef.current?.dismiss();
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera access is off. Enable it in Settings to attach a photo.");
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    const asset = shot.assets?.[0];
    if (shot.canceled || !asset) return;
    send(
      {
        uri: asset.uri,
        name: asset.fileName ?? `photo-${asset.assetId ?? "capture"}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      },
      asset.fileSize,
    );
  };

  const pickImage = async () => {
    sheetRef.current?.dismiss();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo access is off. Enable it in Settings to attach an image.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;
    send(
      {
        uri: asset.uri,
        name: asset.fileName ?? "image.jpg",
        type: asset.mimeType ?? "image/jpeg",
      },
      asset.fileSize,
    );
  };

  const pickDocument = async () => {
    sheetRef.current?.dismiss();
    const picked = await DocumentPicker.getDocumentAsync({
      // Copy into the app's cache: the original may live behind a provider URI
      // that the upload cannot read.
      copyToCacheDirectory: true,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset) return;
    send(
      {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType ?? "application/octet-stream",
      },
      asset.size ?? undefined,
    );
  };

  /**
   * Download, then hand to the OS share sheet — that is how a file gets opened,
   * saved to Files, or installed on Android.
   *
   * The download endpoint is POST, so expo-file-system's GET-only download task
   * cannot be used; the bytes come through axios and are written to cache.
   * That holds the whole file in memory, which is fine for photos and PDFs but
   * would strain on a 200MB build — a GET download route is the fix if that
   * ever becomes a real workflow.
   */
  const open = async (attachment: Attachment) => {
    setError(null);
    setBusy(String(attachment.Id));
    try {
      const res = await apiClient.post(
        "/api/attachments/download",
        { Id: attachment.Id },
        { responseType: "arraybuffer", timeout: 0 },
      );
      const file = new File(Paths.cache, attachment.FileName);
      if (file.exists) file.delete();
      file.create();
      file.write(new Uint8Array(res.data as ArrayBuffer));

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: attachment.MimeType ?? undefined,
          dialogTitle: attachment.FileName,
        });
      }
    } catch {
      setError(`Could not open "${attachment.FileName}".`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.container}>
      {isLoading ? <ActivityIndicator color={colors.primary} /> : null}

      {attachments.map((a) => {
        const meta = fileMeta(a.FileName, a.MimeType);
        const isBusy = busy === String(a.Id);
        return (
          <Pressable
            key={a.Id}
            style={styles.row}
            onPress={() => open(a)}
            disabled={isBusy}
          >
            <View style={[styles.glyph, { backgroundColor: colors[meta.tint] }]}>
              {isBusy ? (
                <ActivityIndicator size="small" color={colors.textOnBrand} />
              ) : (
                <MaterialIcons
                  name={meta.icon}
                  size={18}
                  color={colors.textOnBrand}
                />
              )}
            </View>

            <View style={styles.rowText}>
              <Text variant="body" numberOfLines={1}>
                {a.FileName}
              </Text>
              <Text variant="caption" color="textMuted">
                {[humanSize(a.FileSize), a.UploaderName].filter(Boolean).join(" · ")}
              </Text>
            </View>

            {canManage ? (
              <Pressable hitSlop={spacing[2]} onPress={() => setPendingDelete(a)}>
                <MaterialIcons name="close" size={18} color={colors.textMuted} />
              </Pressable>
            ) : (
              <MaterialIcons
                name="file-download"
                size={18}
                color={colors.textMuted}
              />
            )}
          </Pressable>
        );
      })}

      {!attachments.length && !isLoading ? (
        <Text variant="secondary">No files yet.</Text>
      ) : null}

      {error ? (
        <View style={styles.error}>
          <MaterialIcons name="error-outline" size={16} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.errorText}>
            {error}
          </Text>
        </View>
      ) : null}

      {canManage ? (
        <Pressable
          style={styles.addRow}
          onPress={() => sheetRef.current?.present()}
          disabled={upload.isPending}
        >
          {upload.isPending ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <MaterialIcons name="add" size={20} color={colors.primary} />
          )}
          <Text variant="label" color="primary">
            {upload.isPending ? "Uploading…" : "Add a file"}
          </Text>
        </Pressable>
      ) : null}

      <Sheet ref={sheetRef} title="Add a file">
        <PickOption icon="photo-camera" label="Take a photo" onPress={takePhoto} />
        <PickOption icon="photo-library" label="Choose from library" onPress={pickImage} />
        <PickOption icon="folder-open" label="Choose a file" onPress={pickDocument} />
      </Sheet>

      <Dialog
        visible={!!pendingDelete}
        title="Remove file?"
        message={pendingDelete ? `"${pendingDelete.FileName}" will be deleted for everyone.` : ""}
        confirmLabel="Remove"
        destructive
        loading={remove.isPending}
        onConfirm={() =>
          pendingDelete && remove.mutate({ Id: pendingDelete.Id })
        }
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}

function PickOption({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.pickOption} onPress={onPress}>
      <View style={styles.pickGlyph}>
        <MaterialIcons name={icon} size={20} color={colors.textOnBrand} />
      </View>
      <Text variant="body">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing[3] },
  row: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: spacing[1] },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing[3],
  },
  error: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  errorText: { flex: 1 },
  pickOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  pickGlyph: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
