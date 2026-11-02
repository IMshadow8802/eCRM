// The two tests run in order: the first overrides the jest.setup defaults,
// the second proves the override did not leak.
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";

const asset = { uri: "file:///a.jpg", name: "a.jpg", lastModified: 0, mimeType: "image/jpeg" };
const photo: ImagePicker.ImagePickerResult = { canceled: false, assets: [{ uri: asset.uri, width: 1, height: 1 }] };
const document: DocumentPicker.DocumentPickerResult = { canceled: false, assets: [asset] };
const denied = { granted: false, status: ImagePicker.PermissionStatus.DENIED, canAskAgain: false, expires: "never" } as const;

it("a test may override a picker default", async () => {
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue(photo);
  jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValueOnce(denied);
  jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce(document);
  await expect(ImagePicker.launchCameraAsync()).resolves.toBe(photo);
});

it("the next test gets the defaults back, queued once-values included", async () => {
  await expect(ImagePicker.launchCameraAsync()).resolves.toEqual({ canceled: true, assets: null });
  await expect(ImagePicker.requestCameraPermissionsAsync()).resolves.toMatchObject({ granted: true });
  await expect(DocumentPicker.getDocumentAsync()).resolves.toEqual({ canceled: true, assets: null });
});
