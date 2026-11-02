import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { Platform } from "react-native";
import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as Sharing from "expo-sharing";

import { apiClient } from "../../api/client";
import type { Attachment } from "../../types/api";
import { fail, lastRequest, respond } from "../../test/transport";
import { renderWithProviders } from "../../test/renderWithProviders";
import { Text } from "../../ui";
import FileViewer from "./FileViewer";

// Native module with no jest build: records what was written where.
const mockFiles: { uri: string; exists: boolean; delete: jest.Mock; create: jest.Mock; write: jest.Mock }[] = [];
jest.mock("expo-file-system", () => ({
  Paths: { cache: { uri: "file:///cache" } },
  File: jest.fn().mockImplementation((parent: { uri: string }, name: string) => {
    const f = { uri: `${parent.uri}/${name}`, exists: name === "stale.png", delete: jest.fn(), create: jest.fn(), write: jest.fn() };
    mockFiles.push(f);
    return f;
  }),
}));
// jest.setup's WebView is a bare View; this one carries a testID to find it by.
jest.mock("react-native-webview", () => {
  const { createElement } = require("react");
  const { View } = require("react-native");
  const WebView = (props: object) => createElement(View, { testID: "webview", ...props });
  return { __esModule: true, WebView, default: WebView };
});
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));

const att = (FileName: string, MimeType: string | null, Id = 4) => ({ Id, FileName, MimeType }) as Attachment;
const BYTES = new Uint8Array([1, 2, 3]).buffer;

const open = (attachment: Attachment | null, onClose = jest.fn()) =>
  renderWithProviders(<FileViewer attachment={attachment} onClose={onClose} />);

beforeEach(() => {
  mockFiles.length = 0;
  respond(BYTES);
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValue(undefined);
});

it("downloads an image through the API into cache and shows it", async () => {
  await open(att("site.jpg", "image/jpeg"));
  await waitFor(() => expect(screen.getByLabelText(/^Preview of/)).toHaveProp("source", { uri: "file:///cache/site.jpg" }));
  expect(lastRequest()).toMatchObject({ url: "/api/attachments/download", body: { Id: 4 } });
  expect(lastRequest().config.responseType).toBe("arraybuffer");
  expect(mockFiles[0]!.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  expect(screen.getByText("site.jpg")).toBeOnTheScreen();
});

it("replaces a stale copy already in cache", async () => {
  await open(att("stale.png", "image/png"));
  await waitFor(() => expect(mockFiles[0]!.write).toHaveBeenCalled());
  expect(mockFiles[0]!.delete).toHaveBeenCalled();
  expect(mockFiles[0]!.create).toHaveBeenCalled();
});

it("renders a PDF in a WebView on iOS", async () => {
  await open(att("quote.pdf", null));
  expect(await screen.findByTestId("webview")).toHaveProp("source", { uri: "file:///cache/quote.pdf" });
  expect(screen.queryByText("No preview for this type")).toBeNull();
});

describe("on Android", () => {
  const os = Platform.OS;
  beforeAll(() => { Platform.OS = "android"; });
  afterAll(() => { Platform.OS = os; });

  it("a PDF has no in-app renderer, so it offers another app", async () => {
    await open(att("quote.pdf", "application/pdf"));
    expect(await screen.findByText("No preview for this type")).toBeOnTheScreen();
  });
});

it("a file with no preview offers the share sheet", async () => {
  await open(att("build.apk", "application/vnd.android.package-archive"));
  await fireEvent.press(await screen.findByText("Open in…"));
  expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/build.apk", {
    mimeType: "application/vnd.android.package-archive",
    dialogTitle: "build.apk",
  });
});

it("share does nothing on a device with no share targets", async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  await open(att("notes.zip", null));
  await screen.findByText("Open in…");
  await fireEvent.press(screen.getByLabelText("Share"));
  expect(Sharing.isAvailableAsync).toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it("share before the bytes arrive is ignored", async () => {
  fail(500);
  await open(att("notes.zip", null));
  await screen.findByText("Couldn't open this file");
  await fireEvent.press(screen.getByLabelText("Share"));
  expect(Sharing.isAvailableAsync).not.toHaveBeenCalled();
});

it("says so when the download fails", async () => {
  fail(500);
  await open(att("site.jpg", "image/jpeg"));
  expect(await screen.findByText("Couldn't open this file")).toBeOnTheScreen();
  expect(screen.queryByLabelText(/^Preview of/)).toBeNull();
});

it("closes on the close button", async () => {
  const onClose = jest.fn();
  await open(att("site.jpg", "image/jpeg"), onClose);
  await waitFor(() => expect(screen.getByLabelText(/^Preview of/)).toBeOnTheScreen());
  await fireEvent.press(screen.getByLabelText("Close"));
  expect(onClose).toHaveBeenCalled();
});

it("fetches nothing while closed", async () => {
  const adapter = apiClient.defaults.adapter as jest.Mock;
  await open(null);
  expect(adapter).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Close")).toBeNull();
});

it("a download that lands after the viewer moved on is dropped", async () => {
  const adapter = apiClient.defaults.adapter as jest.Mock<Promise<AxiosResponse>, [InternalAxiosRequestConfig]>;
  let finish!: () => void;
  adapter.mockImplementationOnce(
    (config) => new Promise((resolve) => {
      finish = () => resolve({ data: BYTES, status: 200, statusText: "OK", headers: {}, config });
    }),
  );
  // The parent closes the viewer (attachment -> null) while the bytes are in flight.
  function Host() {
    const [current, setCurrent] = useState<Attachment | null>(att("first.jpg", "image/jpeg"));
    return (
      <>
        <Text onPress={() => setCurrent(null)}>drop</Text>
        <FileViewer attachment={current} onClose={jest.fn()} />
      </>
    );
  }
  await renderWithProviders(<Host />);
  await waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
  await fireEvent.press(screen.getByText("drop"));
  await act(async () => finish());
  // Nothing was written for the abandoned file.
  expect(mockFiles).toHaveLength(0);
});
