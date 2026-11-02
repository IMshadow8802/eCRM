import { act, renderHook } from "@testing-library/react-native";
import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";

import { fetchMyAccess } from "../../api/authQueries";
import { setApiBaseUrl, setAuthToken } from "../../api/client";
import type { Attachment } from "../../types/api";
import { access, envelope } from "../../test/fixtures";
import { useDownloadAttachment } from "./useDownloadAttachment";

jest.mock("../../api/authQueries");

// Native modules with no jest build: a minimal stand-in that records where
// the bytes were asked to go.
jest.mock("expo-file-system", () => {
  class Directory {
    uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}/${name}`;
    }
    create = jest.fn();
  }
  class File {
    uri: string;
    constructor(parent: { uri: string }, name: string) {
      this.uri = `${parent.uri}/${name}`;
    }
    static downloadFileAsync = jest.fn();
  }
  return { Directory, File, Paths: { cache: { uri: "file:///cache" } } };
});
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const file = { Id: 5, FileName: "build.apk", MimeType: "application/vnd.android.package-archive" } as Attachment;
const download = jest.mocked(File.downloadFileAsync);

beforeEach(() => {
  setAuthToken("tok");
  setApiBaseUrl("https://api.test");
  download.mockImplementation(async (_url, dest) => dest as File);
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
});

afterAll(() => setAuthToken(null));

it("streams the file to its own cache folder with the token, then opens the share sheet", async () => {
  const onError = jest.fn();
  const { result } = await renderHook(() => useDownloadAttachment(onError));
  await act(() => result.current.download(file));

  expect(download).toHaveBeenCalledWith(
    "https://api.test/api/attachments/download/5",
    expect.objectContaining({ uri: "file:///cache/attachments/5/build.apk" }),
    { headers: { Authorization: "Bearer tok" }, idempotent: true },
  );
  expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/attachments/5/build.apk", {
    mimeType: file.MimeType,
    dialogTitle: "build.apk",
  });
  expect(onError).not.toHaveBeenCalled();
  expect(result.current.busyId).toBeNull();
});

it("is busy on that file while it downloads", async () => {
  let finish!: () => void;
  download.mockImplementation((_url, dest) => new Promise((resolve) => { finish = () => resolve(dest as File); }));
  const { result } = await renderHook(() => useDownloadAttachment(jest.fn()));
  let pending!: Promise<void>;
  await act(async () => { pending = result.current.download(file); });
  expect(result.current.busyId).toBe(5);
  await act(async () => { finish(); await pending; });
  expect(result.current.busyId).toBeNull();
});

it("refuses without a session instead of firing a request that will 401", async () => {
  setAuthToken(null);
  const onError = jest.fn();
  const { result } = await renderHook(() => useDownloadAttachment(onError));
  await act(() => result.current.download(file));
  expect(onError).toHaveBeenCalledWith("You are signed out. Sign in and try again.");
  expect(download).not.toHaveBeenCalled();
});

it("says so when the device cannot share", async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  const onError = jest.fn();
  const { result } = await renderHook(() => useDownloadAttachment(onError));
  await act(() => result.current.download(file));
  expect(onError).toHaveBeenCalledWith("This device has no way to open or save the file.");
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

// parity: ATT-04 — the download runs outside axios, so its 401 never reached the
// session handling. A 401 now makes one authenticated call, whose 401 runs the
// normal path (re-sign-in dialog or sign-out), then retries once.
describe("a 401 from the download", () => {
  // iOS and Android word it differently (expo-file-system FileSystemDownload.*).
  const ACCESS_REPLY = envelope({ access: access(), permissions: { menuItems: [], rawPermissions: [], totalMenuItems: 0 } });
  const unauthorized = [new Error("response has status 401"), new Error("response has status: 401")];

  it.each(unauthorized)("runs the session path, then retries (%s)", async (err) => {
    download.mockRejectedValueOnce(err);
    jest.mocked(fetchMyAccess).mockResolvedValue(ACCESS_REPLY);
    const onError = jest.fn();
    const { result } = await renderHook(() => useDownloadAttachment(onError));
    await act(() => result.current.download(file));
    expect(fetchMyAccess).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(2);
    expect(Sharing.shareAsync).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.busyId).toBeNull();
  });

  it("stays quiet when the session is gone: the sign-out is the message", async () => {
    download.mockRejectedValue(unauthorized[0]);
    jest.mocked(fetchMyAccess).mockRejectedValue(new Error("Request failed with status code 401"));
    const onError = jest.fn();
    const { result } = await renderHook(() => useDownloadAttachment(onError));
    await act(() => result.current.download(file));
    expect(download).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("retries only once", async () => {
    download.mockRejectedValue(unauthorized[0]);
    jest.mocked(fetchMyAccess).mockResolvedValue(ACCESS_REPLY);
    const onError = jest.fn();
    const { result } = await renderHook(() => useDownloadAttachment(onError));
    await act(() => result.current.download(file));
    expect(download).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith("Download failed: response has status 401");
  });
});

it.each([
  [new Error("HTTP 500"), "Download failed: HTTP 500"],
  ["weird", "Download failed. Check your connection and try again."],
])("reports a failed download (%s) and clears busy", async (thrown, message) => {
  download.mockRejectedValue(thrown);
  const onError = jest.fn();
  const { result } = await renderHook(() => useDownloadAttachment(onError));
  await act(() => result.current.download(file));
  expect(onError).toHaveBeenCalledWith(message);
  expect(result.current.busyId).toBeNull();
});
