import { describe, it, expect } from "vitest";
import {
  parseAvatar,
  makeAvatar,
  colorOf,
  AVATAR_COLORS,
} from "./avatarPresets";

describe("avatarPresets", () => {
  it("returns null for empty / malformed presets", () => {
    expect(parseAvatar("")).toBeNull();
    expect(parseAvatar(null)).toBeNull();
    expect(parseAvatar("garbage")).toBeNull();
    expect(parseAvatar("icon:notARealIcon|violet")).toBeNull();
  });

  it("parses an emoji preset", () => {
    expect(parseAvatar("emoji:🚀")).toEqual({ kind: "emoji", emoji: "🚀" });
  });

  it("parses an icon preset with its color", () => {
    const p = parseAvatar("icon:rocket|blue");
    expect(p.kind).toBe("icon");
    expect(p.iconKey).toBe("rocket");
    expect(p.colorKey).toBe("blue");
    expect(p.color).toBe(AVATAR_COLORS.blue);
    expect(typeof p.Icon).toBe("object"); // a lucide component (forwardRef)
  });

  it("parses a color preset and falls back to violet for unknown colors", () => {
    expect(parseAvatar("color:green").color).toBe(AVATAR_COLORS.green);
    expect(colorOf("nope")).toBe(AVATAR_COLORS.violet);
  });

  it("round-trips through makeAvatar", () => {
    expect(makeAvatar("emoji", "🐱")).toBe("emoji:🐱");
    expect(makeAvatar("icon", "star", "amber")).toBe("icon:star|amber");
    expect(makeAvatar("color", "pink")).toBe("color:pink");
    expect(parseAvatar(makeAvatar("icon", "cat", "red")).iconKey).toBe("cat");
  });
});
