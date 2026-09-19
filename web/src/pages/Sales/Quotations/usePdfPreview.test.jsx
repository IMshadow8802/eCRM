import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@react-pdf/renderer", () => import("../../../test/reactPdfMock"));

import { usePDF } from "@react-pdf/renderer";
import { usePdfPreview } from "./usePdfPreview";

const A = () => null;
const B = () => null;

beforeEach(() => { vi.useFakeTimers(); usePDF.mockClear(); usePDF.update.mockClear(); });
afterEach(() => vi.useRealTimers());

describe("usePdfPreview", () => {
  it("renders the first document straight away and hands back the blob URL", () => {
    const doc = { quoteNo: "DRAFT" };
    const { result } = renderHook(() => usePdfPreview(A, doc));
    expect(usePDF.mock.calls[0][0].document.type).toBe(A);
    expect(usePDF.mock.calls[0][0].document.props.doc).toBe(doc);
    expect(result.current.url).toBe("blob:preview");
    vi.advanceTimersByTime(2000);
    expect(usePDF.update).not.toHaveBeenCalled(); // the initial render is not a "change"
  });

  it("debounces changes: three quick edits, one render, with the last document", () => {
    const { rerender } = renderHook(({ doc }) => usePdfPreview(A, doc), { initialProps: { doc: { n: 0 } } });
    rerender({ doc: { n: 1 } }); vi.advanceTimersByTime(200);
    rerender({ doc: { n: 2 } }); vi.advanceTimersByTime(200);
    const last = { n: 3 };
    rerender({ doc: last });
    expect(usePDF.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(usePDF.update).toHaveBeenCalledTimes(1);
    expect(usePDF.update.mock.calls[0][0].props.doc).toBe(last);
  });

  // The contract in the hook's comment: a memoised doc. Same identity → no work.
  it("does nothing when re-rendered with the same document", () => {
    const doc = { n: 1 };
    const { rerender } = renderHook(() => usePdfPreview(A, doc));
    rerender(); rerender();
    vi.advanceTimersByTime(2000);
    expect(usePDF.update).not.toHaveBeenCalled();
  });

  it("re-renders when the template changes", () => {
    const doc = { n: 1 };
    const { rerender } = renderHook(({ C }) => usePdfPreview(C, doc), { initialProps: { C: A } });
    rerender({ C: B });
    vi.advanceTimersByTime(500);
    expect(usePDF.update.mock.calls[0][0].type).toBe(B);
  });

  it("drops a pending render when unmounted", () => {
    const { rerender, unmount } = renderHook(({ doc }) => usePdfPreview(A, doc), { initialProps: { doc: { n: 0 } } });
    rerender({ doc: { n: 1 } });
    unmount();
    vi.advanceTimersByTime(2000);
    expect(usePDF.update).not.toHaveBeenCalled();
  });
});
