"use client";
import { useEffect } from "react";

export function ZoomLock() {
  useEffect(() => {
    const prevent = (event: Event) => event.preventDefault();
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ["+", "-", "=", "0"].includes(event.key))
        event.preventDefault();
    };
    const touch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    document.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("keydown", key);
    document.addEventListener("touchmove", touch, { passive: false });
    document.addEventListener("gesturestart", prevent, { passive: false });
    document.addEventListener("gesturechange", prevent, { passive: false });
    return () => {
      document.removeEventListener("wheel", wheel);
      document.removeEventListener("keydown", key);
      document.removeEventListener("touchmove", touch);
      document.removeEventListener("gesturestart", prevent);
      document.removeEventListener("gesturechange", prevent);
    };
  }, []);
  return null;
}
