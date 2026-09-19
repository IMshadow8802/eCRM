import { createElement, useEffect, useRef } from "react";
import { usePDF } from "@react-pdf/renderer";

/**
 * The live preview: the template rendered to a real PDF blob, shown in an
 * <iframe>. There is no second, HTML "preview renderer" to drift away from the
 * file — what they see IS the file they download.
 *
 * Rendering is debounced: laying out a PDF on every keystroke is wasteful and
 * makes typing feel heavy.
 *
 * `doc` MUST be memoised by the caller (useMemo). The effect depends on its
 * identity; a fresh object every render would re-arm the timer forever, and —
 * because a finished render updates `instance`, which re-renders the caller —
 * would loop.
 *
 * @returns {{ url: string|null, blob: Blob|null, loading: boolean, error: any }}
 */
export function usePdfPreview(Component, doc, delay = 500) {
  const [instance, update] = usePDF({ document: createElement(Component, { doc }) });
  const first = useRef(true);

  useEffect(() => {
    // usePDF already rendered the initial document; only CHANGES are debounced.
    if (first.current) { first.current = false; return undefined; }
    const t = setTimeout(() => update(createElement(Component, { doc })), delay);
    return () => clearTimeout(t);
  }, [Component, doc, delay, update]);

  return instance;
}
