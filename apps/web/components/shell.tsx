"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, Settings, ArrowUpRight } from "lucide-react";
export function Shell({ children }: { children: React.ReactNode }) {
  const route = usePathname();
  return (
    <>
      <header className="shell-header">
        <Link href="/" className="brand">
          <Layers size={22} strokeWidth={1.5} />
          <span>Design Harvester</span>
        </Link>
        <nav aria-label="主导航">
          <Link href="/" aria-current={route === "/" ? "page" : undefined}>
            资料库
          </Link>
          <Link
            href="/settings"
            aria-current={route === "/settings" ? "page" : undefined}
          >
            <Settings size={16} />
            设置
          </Link>
        </nav>
        <span className="private-label">
          私人设计档案 <ArrowUpRight size={13} />
        </span>
      </header>
      <main>{children}</main>
      <footer>
        Design Harvester <span>让好的设计，成为下一次创作的起点。</span>
      </footer>
    </>
  );
}
