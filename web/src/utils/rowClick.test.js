import { describe, it, expect, vi } from "vitest";
import { rowClick } from "./rowClick";

const at = (html, selector) => {
  const root = document.createElement("div");
  root.innerHTML = html;
  return { target: root.querySelector(selector) };
};

describe("rowClick", () => {
  it("opens on a plain part of the row", () => {
    const go = vi.fn();
    rowClick(go)(at("<div><span>text</span></div>", "span"));
    expect(go).toHaveBeenCalledTimes(1);
  });

  it.each(["a", "button", "input", "[role='button']"])("leaves a click on %s to that control", (sel) => {
    const go = vi.fn();
    rowClick(go)(at("<div><a href='#'>t</a><button>b</button><input /><span role='button'>r</span></div>", sel));
    expect(go).not.toHaveBeenCalled();
  });
});
