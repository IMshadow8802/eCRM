import { useEffect, useState } from "react";

import { fetchCardPhoto } from "../../../api/cardQueries";

/** A card photo as an object URL: { url, failed }. Revokes it on unmount / path change. */
export default function useCardPhoto(path) {
  const [state, setState] = useState({ url: null, failed: false });
  useEffect(() => {
    if (!path) { setState({ url: null, failed: true }); return undefined; }
    setState({ url: null, failed: false });
    let dead = false;
    let made = null;
    fetchCardPhoto(path).then(
      ({ url }) => { made = url; if (dead) URL.revokeObjectURL(url); else setState({ url, failed: false }); },
      () => { if (!dead) setState({ url: null, failed: true }); },
    );
    return () => { dead = true; if (made) URL.revokeObjectURL(made); };
  }, [path]);
  return state;
}
