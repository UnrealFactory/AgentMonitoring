/**
 * Which section of a record the reader is currently looking at, for the contents rail.
 *
 * A plain IntersectionObserver picking "the first section on screen" cannot answer this
 * once sections nest: while the reader is inside *Verified*, the *Resolution* that contains
 * it is on screen too, so the rail highlights the container forever and the sub-entries
 * never light up. This walks the ids in document order instead and takes the last one whose
 * top has passed a line near the top of the viewport — the section you most recently
 * entered, which is the one you are reading, nested or not.
 */
import { useEffect, useState } from "react";

/** Where "you are here" is measured, in px from the top of the viewport. */
const LINE = 140;

export function useActiveSection(ids: string[]): string {
  const [active, setActive] = useState(ids[0] ?? "");
  const key = ids.join(",");

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      let current = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= LINE) current = id;
      }
      setActive(current);
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    // Capture: the app scrolls inside `.main`, and scroll events do not bubble. Capturing
    // on the document catches that scroller and the window one (full-page screenshots)
    // without either page having to know which is in charge.
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return active;
}
