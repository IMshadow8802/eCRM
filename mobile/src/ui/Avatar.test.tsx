import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Ghost } from "lucide-react-native";

import { colors } from "../theme";
import { Avatar } from "./Avatar";
import { AVATAR_COLORS, parseAvatar } from "./avatarPresets";

describe("parseAvatar", () => {
  it.each([
    ["icon:ghost|blue", { kind: "icon", Icon: Ghost, color: AVATAR_COLORS.blue }],
    ["icon:ghost", { kind: "icon", Icon: Ghost, color: AVATAR_COLORS.violet }],
    ["icon:ghost|nope", { kind: "icon", Icon: Ghost, color: AVATAR_COLORS.violet }],
    ["emoji:🚀", { kind: "emoji", emoji: "🚀" }],
    ["color:green", { kind: "color", color: AVATAR_COLORS.green }],
    ["https://cdn.example/a.png", { kind: "image", uri: "https://cdn.example/a.png" }],
    ["file:///tmp/a.jpg", { kind: "image", uri: "file:///tmp/a.jpg" }],
  ])("%s", (preset, parsed) => {
    expect(parseAvatar(preset)).toEqual(parsed);
  });

  it.each([null, undefined, "", "plain", "emoji:", "icon:unicorn|red", "icon:", "badge:x"])(
    "%p falls back to initials (null)",
    (preset) => expect(parseAvatar(preset)).toBeNull(),
  );
});

describe("Avatar", () => {
  const fill = (text: string) => StyleSheet.flatten(screen.getByText(text).parent!.props.style).backgroundColor;

  it("no preset: two initials on the brand colour", async () => {
    await render(<Avatar name="asha  verma kumar" />);
    expect(fill("AV")).toBe(colors.primary);
  });

  it("no name shows a question mark", async () => {
    await render(<Avatar name={null} uri="unknown:thing" />);
    expect(screen.getByText("?")).toBeOnTheScreen();
  });

  it("a colour preset tints the initials", async () => {
    await render(<Avatar name="Ravi" uri="color:red" />);
    expect(fill("R")).toBe(AVATAR_COLORS.red);
  });

  it("an emoji preset shows the emoji", async () => {
    await render(<Avatar name="Ravi" uri="emoji:🐱" size={40} />);
    expect(screen.getByText("🐱")).toBeOnTheScreen();
  });

  it("an icon preset draws no initials", async () => {
    await render(<Avatar name="Ravi" uri="icon:cat|pink" />);
    expect(screen.queryByText("R")).toBeNull();
  });

  it("a real URL loads as an image", async () => {
    await render(<Avatar name="Ravi" uri="https://cdn.example/r.png" />);
    expect(screen.root!.props.source).toEqual({ uri: "https://cdn.example/r.png" });
    expect(screen.queryByText("R")).toBeNull();
  });
});
