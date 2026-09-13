"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function InspectorScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const element = ref.current!;
    const update = () => setMore(element.scrollHeight - element.clientHeight - element.scrollTop > 2);
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(element.firstElementChild!);
    element.addEventListener("scroll", update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
    };
  }, []);
  return (
    <aside className="inspector-frame">
      <div ref={ref} className="inspector-scroll" data-more={more} tabIndex={0} role="region" aria-label="Design DNA，设计分析">
        <div className="inspector">{children}</div>
      </div>
    </aside>
  );
}
