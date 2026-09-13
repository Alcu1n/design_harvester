import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ZoomLock } from "../components/zoom-lock";
import { Shell } from "../components/shell";
export const metadata: Metadata = {
  title: "Design Harvester · 私人设计档案",
  description: "采集真实设计，沉淀可复用的设计语言。",
};
export const viewport: Viewport = {
  width: "device-width", initialScale: 1, minimumScale: 1, maximumScale: 1, userScalable: false,
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ZoomLock />
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
