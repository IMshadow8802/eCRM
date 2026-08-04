import { useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  CircleAlert,
  Download,
  FolderOpen,
  Images,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import {
  deleteAttachment,
  fetchAttachments,
  uploadAttachment,
  type PickedFile,
} from "../../api/attachmentQueries";
import type { Attachment, AttachmentEntity } from "../../types/api";
import { colors, radius, shadows, spacing, SCREEN_PADDING } from "../../theme";
import { Dialog, Fab, Sheet, Text, type SheetRef } from "../../ui";
import FileViewer from "./FileViewer";
import { fileMeta, humanSize, MAX_UPLOAD_BYTES } from "./attachmentHelpers";
import { useDownloadAttachment } from "./useDownloadAttachment";

interface AttachmentListProps {
  entity: AttachmentEntity;
  entityId: number;
  /** manageArtifacts — assignees, creator, owner/manager. Viewers are read-only. */
  canManage: boolean;
}

export default function AttachmentList({
  entity,
  entityId,
  canManage,
}: AttachmentListProps) {
  const queryClient = useQueryClient();
  const sheetRef = useRef<SheetRef>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);
  const { download, busyId, error: downloadError, clearError } = useDownloadAttachment();

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

  return (
    <View style={styles.container}>
      <FlatList
        data={attachments}
        keyExtractor={(a) => String(a.Id)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text variant="secondary">No files yet.</Text>
          )
        }
        renderItem={({ item: a }) => {
          const { Icon, tint } = fileMeta(a.FileName, a.MimeType);
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => setViewing(a)}
            >
              <View style={[styles.glyph, { backgroundColor: colors[tint] }]}>
                <Icon size={18} color={colors.textOnBrand} />
              </View>

              <View style={styles.rowText}>
                <Text variant="body" numberOfLines={1}>
                  {a.FileName}
                </Text>
                <Text variant="caption" color="textMuted">
                  {[humanSize(a.FileSize), a.UploaderName]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>

              {/* Save is always available, even to a viewer — reading a file
                  you can already open is not a privileged act, and a build you
                  cannot get off the phone is no use to anyone. */}
              <Pressable
                hitSlop={spacing[2]}
                disabled={busyId === a.Id}
                onPress={() => download(a)}
                accessibilityLabel={`Download ${a.FileName}`}
                accessibilityRole="button"
                style={styles.rowAction}
              >
                {busyId === a.Id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Download size={19} color={colors.primary} />
                )}
              </Pressable>

              {canManage ? (
                <Pressable
                  hitSlop={spacing[2]}
                  onPress={() => setPendingDelete(a)}
                  accessibilityLabel={`Delete ${a.FileName}`}
                  accessibilityRole="button"
                  style={styles.rowAction}
                >
                  {/* A cross means dismiss; this destroys the file. */}
                  <Trash2 size={19} color={colors.danger} />
                </Pressable>
              ) : null}
            </Pressable>
          );
        }}
      />

      {error || downloadError ? (
        <Pressable
          style={styles.error}
          onPress={() => {
            setError(null);
            clearError();
          }}
          accessibilityLabel="Dismiss the error"
          accessibilityRole="button"
        >
          <CircleAlert size={16} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.errorText}>
            {error ?? downloadError}
          </Text>
        </Pressable>
      ) : null}

      {canManage ? (
        <Fab
          icon={Plus}
          accessibilityLabel="Add a file"
          loading={upload.isPending}
          onPress={() => sheetRef.current?.present()}
        />
      ) : null}

      <Sheet ref={sheetRef} title="Add a file">
        <PickOption Icon={Camera} label="Take a photo" onPress={takePhoto} />
        <PickOption Icon={Images} label="Choose from library" onPress={pickImage} />
        <PickOption Icon={FolderOpen} label="Choose a file" onPress={pickDocument} />
      </Sheet>

      <FileViewer attachment={viewing} onClose={() => setViewing(null)} />

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
  Icon,
  label,
  onPress,
}: {
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.pickOption} onPress={onPress}>
      <View style={styles.pickGlyph}>
        <Icon size={20} color={colors.textOnBrand} />
      </View>
      <Text variant="body">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: SCREEN_PADDING },
  // Clears the FAB so the last row is never hidden behind it.
  list: { gap: spacing[3], paddingBottom: spacing[20] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[3],
    ...shadows.sm,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: { flex: 1, gap: spacing[1] },
  // A fixed box so the spinner that replaces the icon mid-download does not
  // shift the row width.
  rowAction: { width: 28, alignItems: "center", justifyContent: "center" },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingBottom: spacing[2],
  },
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
