import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
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
  Paperclip,
  Trash2,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import {
  deleteAttachment,
  fetchAttachments,
  uploadAttachment,
} from "../../api/attachmentQueries";
import { apiErrorMessage } from "../../api/errors";
import type { Attachment, AttachmentEntity } from "../../types/api";
import { colors, spacing } from "../../theme";
import {
  Button,
  Dialog,
  ListGroup,
  ListRow,
  Sheet,
  SkeletonRows,
  Text,
  useLayout,
  useToast,
  type SheetRef,
} from "../../ui";
import FileViewer from "./FileViewer";
import { fileMeta, humanSize, PICKER_TYPES, screenPicked, type PickedAsset } from "./attachmentHelpers";
import { useDownloadAttachment } from "./useDownloadAttachment";

interface AttachmentListProps {
  entity: AttachmentEntity;
  entityId: number;
  /** manageArtifacts — assignees, creator, owner/manager. Viewers are read-only. */
  canManage: boolean;
  /** Inside a screen's own scroll (the complaint record): no scroll of its own. */
  embedded?: boolean;
}

export default function AttachmentList({
  entity,
  entityId,
  canManage,
  embedded = false,
}: AttachmentListProps) {
  const queryClient = useQueryClient();
  const { gutter } = useLayout();
  const toast = useToast();
  const sheetRef = useRef<SheetRef>(null);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Attachment | null>(null);
  const { download, busyId } = useDownloadAttachment(toast.error);

  const queryKey = ["attachments", entity, entityId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchAttachments({ Entity: entity, EntityId: entityId }),
  });

  const [uploading, setUploading] = useState(false);

  const remove = useMutation({
    mutationFn: deleteAttachment,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not delete that file.")),
    onSuccess: () => {
      setPendingDelete(null);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const attachments = data ?? [];

  /**
   * Screens every picked file (type, then size), names the refused ones, then
   * uploads the rest ONE AT A TIME — so the spinner means "still uploading"
   * and a failure can say which file it was.
   */
  const send = async (assets: PickedAsset[]) => {
    const { files, refused } = screenPicked(assets);
    setError(refused.length ? refused.join("\n") : null);
    if (!files.length) return;
    setUploading(true);
    const failed: { name: string; reason: string }[] = [];
    for (const file of files) {
      try {
        await uploadAttachment({ Entity: entity, EntityId: entityId, file });
      } catch (err) {
        failed.push({ name: file.name, reason: apiErrorMessage(err, "Upload failed.") });
      }
    }
    setUploading(false);
    void queryClient.invalidateQueries({ queryKey });
    if (failed.length === 1) toast.error(`Could not upload "${failed[0]!.name}": ${failed[0]!.reason}`);
    else if (failed.length) toast.error(`${failed.length} files failed to upload: ${failed.map((f) => f.name).join(", ")}`);
  };

  const image = (asset: ImagePicker.ImagePickerAsset, fallbackName: string): PickedAsset => ({
    uri: asset.uri,
    name: asset.fileName ?? fallbackName,
    mimeType: asset.mimeType ?? "image/jpeg",
    size: asset.fileSize,
  });

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
    send([image(asset, `photo-${asset.assetId ?? "capture"}.jpg`)]);
  };

  const pickImage = async () => {
    sheetRef.current?.dismiss();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo access is off. Enable it in Settings to attach an image.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsMultipleSelection: true });
    if (picked.canceled || !picked.assets?.length) return;
    send(picked.assets.map((asset) => image(asset, "image.jpg")));
  };

  const pickDocument = async () => {
    sheetRef.current?.dismiss();
    const picked = await DocumentPicker.getDocumentAsync({
      // Copy into the app's cache: the original may live behind a provider URI
      // that the upload cannot read.
      copyToCacheDirectory: true,
      multiple: true,
      type: PICKER_TYPES,
    });
    if (picked.canceled || !picked.assets?.length) return;
    send(picked.assets);
  };

  const rows = isLoading ? (
    <SkeletonRows rows={2} />
  ) : attachments.length ? (
    <ListGroup>
      {attachments.map((a, i) => {
        const { Icon, tone, kind } = fileMeta(a.FileName, a.MimeType);
        return (
          <ListRow
            key={a.Id}
            noSeparator={i === 0}
            badge={{ tone, icon: Icon }}
            title={a.FileName}
            meta={[kind, humanSize(a.FileSize), a.UploaderName].filter(Boolean).join(" · ")}
            onPress={() => setViewing(a)}
            trailing={
              <View style={styles.actions}>
                {/* Save is always available, even to a viewer — reading a file
                    you can already open is not a privileged act. */}
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
              </View>
            }
          />
        );
      })}
    </ListGroup>
  ) : (
    <Text variant="meta">No files yet.</Text>
  );

  const body = (
    <>
      {rows}

      {/* Only the messages you have to ACT on stay here: the file was too big,
          or camera/photo access is off and has to be turned on in Settings.
          Outcomes — upload failed, download failed — are toasts. */}
      {error ? (
        <Pressable
          style={styles.error}
          onPress={() => setError(null)}
          accessibilityLabel="Dismiss the error"
          accessibilityRole="button"
        >
          <CircleAlert size={16} color={colors.danger} />
          <Text variant="label" color="dangerText" style={styles.errorText}>
            {error}
          </Text>
        </Pressable>
      ) : null}

      {canManage ? (
        <Button
          title="Add a file"
          accessibilityLabel="Add a file"
          variant="secondary"
          size="sm"
          icon={Paperclip}
          loading={uploading}
          onPress={() => sheetRef.current?.present()}
          style={styles.add}
        />
      ) : null}

      <Sheet ref={sheetRef} title="Add a file" padded>
        <ListGroup>
          <ListRow noSeparator badge={{ tone: "sky", icon: Camera }} title="Take a photo" onPress={takePhoto} />
          <ListRow badge={{ tone: "teal", icon: Images }} title="Choose from library" onPress={pickImage} />
          <ListRow badge={{ tone: "indigo", icon: FolderOpen }} title="Choose a file" onPress={pickDocument} />
        </ListGroup>
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
    </>
  );

  if (embedded) return <View>{body}</View>;
  return (
    <ScrollView testID="attachments-scroll" contentContainerStyle={[styles.page, { paddingHorizontal: gutter }]} showsVerticalScrollIndicator={false}>
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingTop: spacing[4], paddingBottom: spacing[8] },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  // A fixed box so the spinner that replaces the icon mid-download does not
  // shift the row width.
  rowAction: { width: 28, alignItems: "center", justifyContent: "center" },
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingTop: spacing[2],
  },
  errorText: { flex: 1 },
  add: { alignSelf: "flex-start", marginTop: spacing[3] },
});
