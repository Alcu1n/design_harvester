"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  RefreshCw,
  ExternalLink,
  Check,
  ZoomIn,
  X,
  Loader2,
  Trash2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as Dialog from "@radix-ui/react-dialog";
import { api, labels } from "./library";
import { Button } from "./button";
import { DownloadButton } from "./download-button";
import { InspectorScroll } from "./inspector-scroll";
const stages: Record<string, string> = {
  QUEUED: "等待开始",
  CAPTURING_DESKTOP: "采集桌面视图",
  CAPTURING_TABLET: "采集平板视图",
  CAPTURING_MOBILE: "采集手机视图",
  ANALYZING_DESIGN: "理解设计语言",
  GENERATING_DESIGN_MD: "生成 DESIGN.md",
  ADAPTING_IOS: "适配 iOS",
  QUALITY_REVIEW: "质量检查",
  SAVING_ARTIFACTS: "保存资产",
  PUBLISHING: "发布版本",
  COMPLETE: "处理完成",
};
function Document({ url, name }: { url: string; name: string }) {
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    setText("");
    setError("");
    fetch(url)
      .then(async (r) => {
        if (!r.ok) throw new Error("这份文档尚未生成。");
        return r.text();
      })
      .then((t) => {
        if (alive) setText(t);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <section className="document">
      <div className="section-title">
        <h2>{name}</h2>
        <div className="actions">
          <Button
            variant="ghost"
            disabled={!text}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                setError("无法访问剪贴板，请使用下载。");
              }
            }}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
            {copied ? "已复制" : "复制"}
          </Button>
          <DownloadButton key={url} url={url + "?download"} filename={name} disabled={!text}>
            下载
          </DownloadButton>
        </div>
      </div>
      {error ? (
        <p className="muted">{error}</p>
      ) : text ? (
        <div className="markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {text.replace(/^---\n[\s\S]*?\n---\n/, "")}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="muted">正在读取…</p>
      )}
    </section>
  );
}
export function Detail({ id }: { id: string }) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [versionId, setVersionId] = useState(""),
    [viewport, setViewport] = useState("desktop"),
    [doc, setDoc] = useState("DESIGN.md"),
    [edit, setEdit] = useState(false),
    [title, setTitle] = useState(""),
    [notes, setNotes] = useState(""),
    [tags, setTags] = useState(""),
    [busy, setBusy] = useState(false),
    [compare, setCompare] = useState(""),
    [diff, setDiff] = useState<any[]>([]),
    [evidence, setEvidence] = useState<any>();
  const load = () =>
    api("designs/" + id)
      .then((d) => {
        setData(d);
        setError("");
        return d;
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [id]);
  const version =
    data?.versions.find(
      (v: any) => v.id === (versionId || data.default_version_id),
    ) || data?.versions[0];
  useEffect(() => {
    setCompare("");
    setDiff([]);
  }, [version?.id]);
  useEffect(() => {
    setDiff([]);
    if (!compare || !version) return;
    let alive = true;
    api(`designs/${id}/compare?a=${version.id}&b=${compare}`)
      .then((value) => {
        if (alive) setDiff(value);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      });
    return () => {
      alive = false;
    };
  }, [compare, version?.id, id]);
  const task = data?.tasks[0];
  const selectedTask = data?.tasks.find(
    (t: any) => t.version_id === version?.id,
  );
  const base = `/api/assets/${id}/versions/${version?.id}/`,
    snap = `/api/assets/${id}/snapshots/${version?.snapshot_id}/`;
  const analysis = version?.analysis;
  useEffect(() => {
    if (!version) return;
    let alive = true;
    fetch(snap + "evidence.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((e) => {
        if (alive) setEvidence(e);
      });
    return () => {
      alive = false;
    };
  }, [snap]);
  async function action(path: string) {
    setBusy(true);
    try {
      await api(path, "POST");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    try {
      await api("designs/" + id, "PATCH", {
        title: title || new URL(data.canonical_url).hostname,
        notes,
        tags: tags
          .split(/[,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setEdit(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <div className="empty">{error || "正在打开设计…"}</div>;
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={16} />
        返回资料库
      </Link>
      <div className="detail-title">
        <div>
          <p className="eyebrow">{new URL(data.canonical_url).hostname}</p>
          <h1>
            {data.title ||
              analysis?.name ||
              new URL(data.canonical_url).hostname}
          </h1>
          <a
            className="source-link"
            href={data.canonical_url}
            target="_blank"
            rel="noreferrer"
          >
            访问原网站 <ExternalLink size={13} />
          </a>
        </div>
        <div className="actions">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => action("designs/" + id + "/harvest")}
          >
            <RefreshCw size={15} />
            重新采集
          </Button>
          {version && (
            <DownloadButton
              key={version.id}
              variant="default"
              url={`/api/designs/${id}/export?version=${version.id}`}
              filename={`design-${id}.zip`}
            >
              {data.assets.some(
                (a: string) =>
                  a === `${id}/versions/${version.id}/IOS_design.md`,
              )
                ? "下载完整方案"
                : "下载已有资产"}
            </DownloadButton>
          )}
        </div>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {task && task.status !== "READY" && (
        <div className="progress-panel" role="status">
          <div>
            <strong>
              {labels[task.status]} · {stages[task.stage] || task.stage}
            </strong>
            <p>
              {task.error?.message ||
                (task.status === "PARTIAL"
                  ? "结果已保留，但未达到完整合格标准。"
                  : "截图和证据会分阶段保存，你可以离开此页面。")}
            </p>
          </div>
          <div className="actions">
            {[
              "FAILED",
              "PARTIAL",
              "CANCELED",
              "WAITING_AUTH",
              "WAITING_QUOTA",
              "WAITING_CONFIG",
            ].includes(task.status) ? (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  task.status === "PARTIAL" && task.stage === "COMPLETE"
                    ? action("harvest-runs/" + task.id + "/regenerate")
                    : action("harvest-runs/" + task.id + "/resume")
                }
              >
                {task.status === "PARTIAL" && task.stage === "COMPLETE"
                  ? "重新生成"
                  : "恢复任务"}
              </Button>
            ) : (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => action("harvest-runs/" + task.id + "/cancel")}
              >
                取消任务
              </Button>
            )}
          </div>
        </div>
      )}
      {version && (
        <>
          <div className="detail-layout">
              <div className="tabs screenshot-tabs" role="tablist" aria-label="截图尺寸">
                {[
                  ["desktop", "桌面"],
                  ["tablet", "平板"],
                  ["mobile", "手机"],
                ].map(([v, l]) => (
                  <button
                    role="tab"
                    aria-selected={viewport === v}
                    key={v}
                    onClick={() => setViewport(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
            <section className="visual-section">
              <Dialog.Root>
                <Dialog.Trigger asChild>
                  <button
                    className={"screenshot " + viewport}
                    aria-label="放大完整截图"
                  >
                    <img
                      src={snap + `screenshots/${viewport}.png`}
                      alt={`${data.title || "网站"}的${viewport}完整截图`}
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                      onLoad={(e) => {
                        e.currentTarget.style.visibility = "visible";
                      }}
                    />
                    <span className="zoom">
                      <ZoomIn size={16} />
                      查看完整截图
                    </span>
                  </button>
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Overlay className="dialog-overlay" />
                  <Dialog.Content className="image-dialog">
                    <Dialog.Title className="sr-only">
                      完整网页截图
                    </Dialog.Title>
                    <Dialog.Description className="sr-only">
                      滚动查看完整网页，按 Escape 关闭。
                    </Dialog.Description>
                    <Dialog.Close className="image-close" aria-label="关闭截图">
                      <X />
                    </Dialog.Close>
                    <img
                      src={snap + `screenshots/${viewport}.png`}
                      alt="完整网页"
                    />
                  </Dialog.Content>
                </Dialog.Portal>
              </Dialog.Root>
            </section>
            <InspectorScroll>
              <p className="eyebrow">DESIGN DNA</p>
              <h2>
                {analysis?.name ||
                  (task?.status === "RUNNING"
                    ? "设计语言分析中"
                    : "设计语言尚未生成")}
              </h2>
              <p>
                {analysis?.summary || "完成分析后，这里会呈现设计的核心特征。"}
              </p>
              <div className="tags">
                {[
                  ...new Set([...(data.tags || []), ...(analysis?.tags || [])]),
                ].map((t: any) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <div className="inspector-block">
                <h3>设计特征</h3>
                {analysis?.signatureTraits?.map((t: any, i: number) => (
                  <p key={i} className="trait">
                    {t.description}
                  </p>
                ))}
              </div>
              <div className="inspector-block">
                <h3>实测色彩</h3>
                <div className="swatches">
                  {[
                    ...new Set<string>(
                      evidence?.viewports?.[0]?.elements?.flatMap((e: any) => [
                        e.styles.color,
                        e.styles["background-color"],
                      ]) || [],
                    ),
                  ]
                    .filter((c) => c && c !== "rgba(0, 0, 0, 0)")
                    .slice(0, 8)
                    .map((c) => (
                      <span
                        key={c}
                        style={{ background: c }}
                        title={c}
                        aria-label={c}
                      />
                    ))}
                </div>
              </div>
              <div className="inspector-block">
                <h3>字体声明</h3>
                {[
                  ...new Set<string>(
                    evidence?.viewports?.[0]?.elements?.map(
                      (e: any) => e.styles["font-family"],
                    ) || [],
                  ),
                ]
                  .slice(0, 5)
                  .map((f) => (
                    <p key={f}>{f}</p>
                  ))}
              </div>
              <div className="quality">
                <span>版本质量</span>
                <strong>
                  {version.score ?? "—"}
                  <small> / 100</small>
                </strong>
                <span>
                  {version.quality === "QUALIFIED"
                    ? "已通过检查"
                    : version.quality === "LOW_CONFIDENCE"
                      ? "低置信度"
                      : "尚未完成检查"}
                </span>
              </div>
            </InspectorScroll>
          </div>
          <div className="document-tabs tabs">
            {["DESIGN.md", "IOS_design.md"].map((n) => (
              <button
                key={n}
                onClick={() => setDoc(n)}
                aria-pressed={doc === n}
              >
                {n}
              </button>
            ))}
          </div>
          <Document
            key={base + doc + (task?.stage || "")}
            url={base + doc}
            name={doc}
          />
        </>
      )}
      <section className="detail-section">
        <div className="section-title">
          <h2>我的整理</h2>
          <Button
            variant="ghost"
            onClick={() => {
              setEdit(!edit);
              setTitle(data.title || analysis?.name || "");
              setNotes(data.notes);
              setTags(data.tags.join(", "));
            }}
          >
            {edit ? "取消" : "编辑"}
          </Button>
        </div>
        {edit ? (
          <div className="edit-form">
            <label>
              名称
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
              />
            </label>
            <label>
              个人标签，以逗号分隔
              <input value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label>
              备注
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
              />
            </label>
            <Button disabled={busy} onClick={save}>
              保存整理
            </Button>
          </div>
        ) : (
          <p className="notes">
            {data.notes || "记下你喜欢的细节，以及下一次想用在哪里。"}
          </p>
        )}
      </section>
      <section className="detail-section">
        <h2>版本历史</h2>
        <p className="muted">
          默认使用最新合格版本。重新生成沿用已有证据，重新采集才访问网站。
        </p>
        <div className="version-list">
          {data.versions.map((v: any, i: number) => (
            <button
              key={v.id}
              className={version?.id === v.id ? "selected" : ""}
              onClick={() => setVersionId(v.id)}
            >
              <span>版本 {data.versions.length - i}</span>
              <time>{new Date(v.created_at).toLocaleString("zh-CN")}</time>
              <span>
                {data.tasks.find((t: any) => t.version_id === v.id)?.kind ===
                "REGENERATE"
                  ? "重新生成"
                  : "网站采集"}
              </span>
              <span>
                {v.id === data.default_version_id
                  ? "默认版本"
                  : v.quality === "QUALIFIED"
                    ? "合格"
                    : v.quality === "LOW_CONFIDENCE"
                      ? "低置信度"
                      : "未完成"}
              </span>
            </button>
          ))}
        </div>
        {selectedTask && (
          <Button
            variant="secondary"
            disabled={busy || !evidence}
            onClick={() =>
              action("harvest-runs/" + selectedTask.id + "/regenerate")
            }
          >
            <RefreshCw size={15} />
            用此快照重新生成
          </Button>
        )}
        {data.versions.length > 1 && (
          <div className="compare">
            <label>
              与当前所选版本比较
              <select
                value={compare}
                onChange={(e) => setCompare(e.target.value)}
              >
                <option value="">选择另一个版本</option>
                {data.versions
                  .filter((v: any) => v.id !== version?.id)
                  .map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {new Date(v.created_at).toLocaleString("zh-CN")}
                    </option>
                  ))}
              </select>
            </label>
            {compare && (
              <>
                <div className="compare-images">
                  <img
                    src={snap + "screenshots/desktop.webp"}
                    alt="当前版本截图"
                  />
                  <img
                    src={`/api/assets/${id}/snapshots/${data.versions.find((v: any) => v.id === compare)?.snapshot_id}/screenshots/desktop.webp`}
                    alt="对比版本截图"
                  />
                </div>
                <p>
                  {diff.length
                    ? `${diff.length} 个实测 token 变化`
                    : "实测 token 没有变化；同一快照的生成版本可能只有设计解释变化。"}
                </p>
                {diff.length > 0 && <pre>{JSON.stringify(diff, null, 2)}</pre>}
              </>
            )}
          </div>
        )}
      </section>
      <details className="detail-section">
        <summary>浏览器证据与质量记录</summary>
        {evidence ? (
          <>
            <p className="muted">
              数值来自浏览器计算样式；设计语义和 iOS 建议属于推断。
            </p>
            <div className="evidence-table">
              <table>
                <thead>
                  <tr>
                    <th>元素</th>
                    <th>字体</th>
                    <th>字号</th>
                    <th>颜色</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.viewports
                    .find((v: any) => v.name === viewport)
                    ?.elements.map((e: any) => (
                      <tr key={e.id}>
                        <td title={e.selector}>
                          {e.id}
                          <small>{e.text.slice(0, 40)}</small>
                        </td>
                        <td>{e.styles["font-family"]}</td>
                        <td>{e.styles["font-size"]}</td>
                        <td>{e.styles.color}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <DownloadButton key={snap + "evidence.json"} variant="ghost" url={snap + "evidence.json?download"} filename="evidence.json">下载 evidence.json</DownloadButton>
              <DownloadButton key={base + "critic.json"} variant="ghost" url={base + "critic.json?download"} filename="critic.json">下载质检记录</DownloadButton>
              <DownloadButton key={base + "manifest.json"} variant="ghost" url={base + "manifest.json?download"} filename="manifest.json">下载版本清单</DownloadButton>
            </div>
          </>
        ) : (
          <p>证据尚未采集完成。</p>
        )}
      </details>
      <details className="detail-section">
        <summary>任务记录</summary>
        {data.tasks.map((t: any) => (
          <div className="task-log" key={t.id}>
            <strong>
              {labels[t.status]} ·{" "}
              {new Date(t.created_at).toLocaleString("zh-CN")}
            </strong>
            {t.events.map((e: any, i: number) => (
              <p key={i}>
                <time>{new Date(e.time).toLocaleTimeString("zh-CN")}</time>{" "}
                {stages[e.stage] || e.stage}
              </p>
            ))}
          </div>
        ))}
      </details>
      <div className="delete-row">
        <Button
          variant="danger"
          onClick={async () => {
            if (
              window.confirm(
                "删除这套设计及所有历史截图、证据和文档？此操作无法撤销。",
              )
            )
              try {
                await api("designs/" + id, "DELETE");
                window.location.href = "/";
              } catch (e: any) {
                setError(e.message);
              }
          }}
        >
          <Trash2 size={15} />
          删除设计
        </Button>
      </div>
    </>
  );
}
