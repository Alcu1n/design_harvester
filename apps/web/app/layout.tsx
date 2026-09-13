import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "../components/shell";
export const metadata: Metadata = {
  title: "Design Harvester · 私人设计档案",
  description: "采集真实设计，沉淀可复用的设计语言。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
