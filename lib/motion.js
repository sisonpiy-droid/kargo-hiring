"use client";
// GSAP helpers for the dashboard. Everything is skipped when the user's OS asks
// for reduced motion.
import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Browsers pause animation frames in background tabs; force any animation to its end
// state after a moment so content can never stay hidden or half-faded.
const SAFETY_MS = 2000;
function finishSoon(anim) {
  const t = setTimeout(() => anim.progress(1), SAFETY_MS);
  return () => clearTimeout(t);
}
export const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Staggers in every [data-anim] element inside the returned ref whenever `deps` change.
export function useReveal(deps) {
  const ref = useRef(null);
  useIso(() => {
    if (!ref.current || reduced()) return;
    let stop;
    const ctx = gsap.context(() => {
      const anim = gsap.from("[data-anim]", { y: 18, opacity: 0, duration: 0.5, ease: "power3.out", stagger: 0.06, clearProps: "transform,opacity" });
      stop = finishSoon(anim);
    }, ref);
    return () => { stop?.(); ctx.revert(); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

// Animates an element in once, on mount: fade + rise, then its .meter bars fill up.
export function useEnter() {
  const ref = useRef(null);
  useIso(() => {
    if (!ref.current || reduced()) return;
    let stop;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      stop = finishSoon(tl);
      tl.from(ref.current, { y: 24, opacity: 0, duration: 0.55, ease: "power3.out", clearProps: "transform,opacity" });
      const bars = ref.current.querySelectorAll(".meter > div");
      if (bars.length) tl.from(bars, { width: 0, duration: 0.8, ease: "power2.out", stagger: 0.08 }, "-=0.25");
      const pops = ref.current.querySelectorAll(".pill, .big b");
      if (pops.length) tl.from(pops, { scale: 0.6, opacity: 0, duration: 0.35, ease: "back.out(2)", stagger: 0.05, clearProps: "transform,opacity" }, 0.15);
    }, ref);
    return () => { stop?.(); ctx.revert(); };
  }, []);
  return ref;
}

// Counts a number up (or down) to `value` whenever it changes.
export function useCountUp(value) {
  const ref = useRef(null);
  const last = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = last.current;
    last.current = value;
    if (reduced() || from === value) return;
    const obj = { v: from };
    const tween = gsap.to(obj, {
      v: value, duration: 0.9, ease: "power2.out",
      onUpdate: () => { el.textContent = Math.round(obj.v); },
      onComplete: () => { el.textContent = value; },
    });
    const stop = finishSoon(tween);
    return () => { stop(); tween.kill(); el.textContent = value; };
  }, [value]);
  return ref;
}

// A quick attention pulse on an element whenever `value` changes (after the first render).
export function usePulse(value) {
  const ref = useRef(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!ref.current || reduced()) return;
    gsap.fromTo(ref.current, { scale: 1.45 }, { scale: 1, duration: 0.5, ease: "elastic.out(1, 0.4)" });
  }, [value]);
  return ref;
}
