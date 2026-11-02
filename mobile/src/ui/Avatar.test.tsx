import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { Ghost } from "lucide-react-native";

import { badgeTones, colors } from "../theme";
import { Avatar, AvatarStack, avatarTone } from "./Avatar";
import { AVATAR_COLORS, parseAvatar } from "./avatarPresets";

describe("parseAvatar", () => {
  it.each([
    ["icon:ghost|blue", { kind: "icon", Icon: Ghost, color: AVATAR_COLORS.blue, key: "blue" }],
    ["icon:ghost", { kind: "icon", Icon: Ghost, color: AVATAR_COLORS.violet, key: "violet" }],
    ["icon:ghost|nope", { kind: "icon", Icon: Ghost, color: AVATAR_COLORS.violet, key: "violet" }],
    ["emoji:🚀", { kind: "emoji", emoji: "🚀" }],
    ["color:green", { kind: "color", color: AVATAR_COLORS.green, key: "green" }],
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

describe("Avatar (E §3.17)", () => {
  const box = (text: string) => StyleSheet.flatten(screen.getByText(text).parent!.props.style);
  const ink = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style).color;

  it("initials sit on a sorbet tone picked by the user id, stable everywhere", async () => {
    await render(<><Avatar name="asha  verma kumar" userId={4} /><Avatar name="Neha Kapoor" userId={10} /></>);
    // a1–a6 = indigo · butter · mint · lilac · peach · teal; 4 → peach, 10 → peach.
    expect(box("AV").backgroundColor).toBe(badgeTones.peach.fill);
    expect(ink("AV")).toBe(badgeTones.peach.ink);
    expect(box("NK").backgroundColor).toBe(badgeTones.peach.fill);
  });

  it("without an id the name picks the tone", () => {
    expect(avatarTone(null, "AB")).toBe(avatarTone(undefined, "AB"));
    expect(avatarTone(0)).toBe("indigo");
    expect(avatarTone(7)).toBe("butter");
    expect(avatarTone(null, null)).toBe("indigo");
  });

  it.each([[22, 9], [28, 11], [40, 14], [44, 15], [88, 30], [60, 23]])("size %i draws %ipx initials", async (size, font) => {
    await render(<Avatar name="Ravi" size={size} />);
    expect(StyleSheet.flatten(screen.getByText("R").props.style).fontSize).toBe(font);
    expect(box("R")).toMatchObject({ width: size, height: size });
  });

  it("a ring takes the surface colour: 2 px, or 4 px at 88", async () => {
    await render(<><Avatar name="A B" ring="band" /><Avatar name="C D" size={88} ring="bandField" /></>);
    expect(box("AB")).toMatchObject({ borderWidth: 2, borderColor: colors.band });
    expect(box("CD")).toMatchObject({ borderWidth: 4, borderColor: colors.bandField });
  });

  it("no name shows a question mark", async () => {
    await render(<Avatar name={null} uri="unknown:thing" />);
    expect(screen.getByText("?")).toBeOnTheScreen();
  });

  it.each([["red", "red"], ["violet", "lilac"], ["blue", "indigo"], ["pink", "peach"]] as const)(
    "a %s colour preset maps to the %s sorbet tone", async (preset, tone) => {
      await render(<Avatar name="Ravi" uri={`color:${preset}`} />);
      expect(box("R").backgroundColor).toBe(badgeTones[tone].fill);
    });

  it("an emoji preset shows the emoji", async () => {
    await render(<Avatar name="Ravi" uri="emoji:🐱" size={40} />);
    expect(screen.getByText("🐱")).toBeOnTheScreen();
  });

  it("an icon preset draws its icon on the tone, no initials", async () => {
    await render(<Avatar name="Ravi" uri="icon:cat|cyan" />);
    expect(screen.queryByText("R")).toBeNull();
    expect(StyleSheet.flatten(screen.root!.props.style).backgroundColor).toBe(badgeTones.teal.fill);
  });

  it("a real URL loads as an image", async () => {
    await render(<Avatar name="Ravi" uri="https://cdn.example/r.png" />);
    expect(screen.root!.props.source).toEqual({ uri: "https://cdn.example/r.png" });
    expect(screen.queryByText("R")).toBeNull();
  });
});

describe("AvatarStack", () => {
  const people = ["Ann Lee", "Bob Ray", "Cy Tan", "Di Om", "Ed Fox"].map((name, i) => ({ name, userId: i }));

  it("shows the first three overlapped, then a teal +N", async () => {
    await render(<AvatarStack people={people} />);
    expect(screen.getByLabelText("5 people")).toBeOnTheScreen();
    for (const t of ["AL", "BR", "CT"]) expect(screen.getByText(t)).toBeOnTheScreen();
    expect(screen.queryByText("DO")).toBeNull();
    const more = screen.getByText("+2");
    expect(StyleSheet.flatten(more.parent!.props.style)).toMatchObject({ backgroundColor: badgeTones.teal.fill, marginLeft: -8 });
    expect(StyleSheet.flatten(more.props.style).fontSize).toBe(10);
  });

  it("no +N when everyone fits", async () => {
    await render(<AvatarStack people={people.slice(0, 2)} />);
    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});
