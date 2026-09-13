"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, Loader2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "./button";

// Mobile WebViews can treat an attachment navigation as a failed page load.
// Fetch in place, then share the file from a fresh user gesture (large ZIPs may
// take longer than the browser's transient activation window).
export function DownloadButton({ url, filename, children, variant = "secondary", disabled = false }: {
  url: string; filename: string; children: ReactNode;
  variant?: "default" | "secondary" | "ghost"; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File>();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [url]);
  async function download() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, { signal: request.signal, credentials: "same-origin" });
      if (!response.ok) throw new Error("下载失败，请稍后重试。");
      if (response.headers.get("content-type")?.includes("text/html"))
        throw new Error("登录已过期，请重新打开应用后下载。");
      const blob = await response.blob();
      const value = new File([blob], filename, { type: blob.type.split(";")[0] });
      const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (mobile && navigator.canShare?.({ files: [value] })) {
        setFile(value);
      } else {
        const objectUrl = URL.createObjectURL(value);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();
        // WebKit consumes blob URLs asynchronously.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : "下载失败，请稍后重试。");
    } finally {
      if (controller.current === request) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <span className="download-control">
      <Button variant={variant} disabled={disabled || busy} onClick={download}>
        {busy ? <Loader2 size={15} className="spin" /> : <Download size={15} />}
        {busy ? "正在准备…" : children}
      </Button>
      {error && <span className="download-error" role="alert">{error}</span>}
      <Dialog.Root open={!!file} onOpenChange={(open) => { if (!open) setFile(undefined); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog download-dialog">
            <Dialog.Title>文件已准备好</Dialog.Title>
            <Dialog.Description>点击保存，在系统面板中选择“存储到文件”或目标应用。</Dialog.Description>
            <p className="download-filename">{file?.name}</p>
            <Button onClick={async () => {
              if (!file) return;
              try {
                await navigator.share({ files: [file] });
                setFile(undefined);
              } catch (cause) {
                if (!(cause instanceof Error && cause.name === "AbortError")) {
                  setError("无法打开保存面板，请重试或在系统浏览器中下载。");
                  setFile(undefined);
                }
              }
            }}>保存文件</Button>
            <Dialog.Close className="image-close" aria-label="关闭下载"><X /></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </span>
  );
}
