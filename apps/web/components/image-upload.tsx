"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "./button";
import { Loader2, Upload, ArrowUp, ArrowDown, X } from "lucide-react";
export function ImageUpload() {
  const [files, setFiles] = useState<File[]>([]),
    [title, setTitle] = useState(""),
    [context, setContext] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach(URL.revokeObjectURL), [urls]);
  const router = useRouter();
  function add(next: File[]) {
    const group = [...files, ...next];
    if (group.length > 10) {
      setError("每组最多 10 张图片。");
      return;
    }
    if (
      group.some(
        (f) => !["image/png", "image/jpeg", "image/webp"].includes(f.type),
      )
    ) {
      setError("请选择 PNG、JPEG 或 WebP 图片。");
      return;
    }
    if (
      group.some((f) => f.size > 10 * 1024 * 1024) ||
      group.reduce((n, f) => n + f.size, 0) > 50 * 1024 * 1024
    ) {
      setError("每张最多 10 MiB，每组最多 50 MiB。");
      return;
    }
    setError("");
    setFiles(group);
  }
  function move(i: number, delta: number) {
    const copy = [...files];
    [copy[i], copy[i + delta]] = [copy[i + delta], copy[i]];
    setFiles(copy);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      files.forEach((f) => form.append("images", f));
      form.append("title", title);
      form.append("context", context);
      const response = await fetch("/api/designs/images", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "上传失败，请重试。");
      router.push("/designs/" + data.designId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="image-upload"
      onSubmit={submit}
      onPaste={(e) => {
        const next = Array.from(e.clipboardData.files);
        if (next.length && !busy) {
          e.preventDefault();
          add(next);
        }
      }}
    >
      <div
        className="image-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) add(Array.from(e.dataTransfer.files));
        }}
      >
        <Upload size={23} />
        <label htmlFor="design-images">选择图片或拖到这里</label>
        <input
          id="design-images"
          aria-label="设计图片"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={busy}
          onChange={(e) => {
            add(Array.from(e.target.files || []));
            e.target.value = "";
          }}
        />
        <p>同一 App 的 1–10 张界面，共同生成一套设计指南。也可以粘贴图片。</p>
        <small>PNG / JPEG / WebP · 每张 ≤ 10 MiB · 总计 ≤ 50 MiB</small>
      </div>
      {files.length > 0 && (
        <ol className="upload-previews">
          {files.map((file, i) => (
            <li key={urls[i]}>
              <img src={urls[i]} alt={`待上传图片 ${i + 1}`} />
              <span>
                {i === 0 ? "封面 · " : ""}
                {file.name}
              </span>
              <div className="actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || i === 0}
                  aria-label={`上移图片 ${i + 1}`}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy || i === files.length - 1}
                  aria-label={`下移图片 ${i + 1}`}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`删除图片 ${i + 1}`}
                  onClick={() =>
                    setFiles(files.filter((_, index) => i !== index))
                  }
                >
                  <X size={14} />
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <label>
        设计名称（可选）
        <input
          value={title}
          maxLength={120}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：阅读 App"
        />
      </label>
      <label>
        背景说明（可选）
        <textarea
          value={context}
          maxLength={2000}
          disabled={busy}
          onChange={(e) => setContext(e.target.value)}
          placeholder="这些图片属于哪些页面或主题？"
        />
      </label>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      <Button disabled={busy || !files.length}>
        {busy ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}{" "}
        {busy ? "正在上传…" : "分析并生成"}
      </Button>
    </form>
  );
}
