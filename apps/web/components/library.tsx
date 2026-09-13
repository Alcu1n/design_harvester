"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Search,
  Plus,
  Layers,
  Loader2,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "./button";
export const labels: Record<string, string> = {
  QUEUED: "排队中",
  RUNNING: "处理中",
  READY: "已完成",
  PARTIAL: "需检查",
  FAILED: "失败",
  CANCELED: "已取消",
  WAITING_CONFIG: "等待配置",
  WAITING_AUTH: "等待登录",
  WAITING_QUOTA: "等待额度",
};
export async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "请求失败");
  return data;
}
export function Library() {
  const [data, setData] = useState<any>({ items: [], total: 0 }),
    [query, setQuery] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("newest"),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    const load = () =>
      api(
        "designs?" +
          new URLSearchParams({ query, tag, sort, status, page: String(page) }),
      )
        .then((d) => {
          if (alive) {
            setData(d);
            setLoading(false);
            setError("");
          }
        })
        .catch((e) => {
          if (alive) {
            setError(e.message);
            setLoading(false);
          }
        });
    const timer = setTimeout(load, 200),
      poll = setInterval(load, 3000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(poll);
    };
  }, [query, tag, sort, status, page]);
  async function harvest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api("designs", "POST", { url });
      router.push("/designs/" + d.designId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <section className="library-intro">
        <div>
          <p className="eyebrow">你的私人设计档案</p>
          <h1>
            收集灵感，
            <br />
            <span>留住设计的语言。</span>
          </h1>
          <p className="intro-copy">
            从一个网站开始。把排版、色彩与细节，
            <br className="desktop-break" />
            沉淀为随时可用的设计方案。
          </p>
        </div>
        <form className="harvest-form" onSubmit={harvest}>
          <label htmlFor="url">收藏一个新设计</label>
          <div className="url-field">
            <input
              id="url"
              type="url"
              placeholder="https://你喜欢的网站"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              aria-label="网站地址"
            />
            <Button disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={17} />
              ) : (
                <Plus size={17} />
              )}
              采集
            </Button>
          </div>
          <p>公开网页 · 三种屏幕尺寸 · 两份设计文档</p>
        </form>
      </section>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="library-section">
        <div className="section-title">
          <h2>
            全部设计 <span>{data.total}</span>
          </h2>
          <div className="search">
            <Search size={17} />
            <input
              aria-label="搜索设计"
              placeholder="搜索名称、网站或风格"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <div className="filters">
          <input
            aria-label="标签筛选"
            placeholder="按标签筛选"
            value={tag}
            onChange={(e) => {
              setTag(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label="状态筛选"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">所有状态</option>
            {Object.entries(labels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            aria-label="排序方式"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">最近收藏</option>
            <option value="oldest">最早收藏</option>
            <option value="score">质量优先</option>
          </select>
        </div>
        {loading ? (
          <div className="empty">
            <Loader2 className="spin" />
            <p>正在打开资料库…</p>
          </div>
        ) : data.items.length ? (
          <div className="gallery">
            {data.items.map((d: any) => (
              <Link
                className="design-card"
                href={"/designs/" + d.id}
                key={d.id}
              >
                <div className="card-image">
                  {d.snapshot_id ? (
                    <img
                      src={`/api/assets/${d.id}/snapshots/${d.snapshot_id}/screenshots/desktop.webp`}
                      alt={d.title || d.analysis?.name || "网站预览"}
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Layers size={32} />
                  )}
                  <span className="card-status">
                    {labels[d.status] || "待采集"}
                  </span>
                  <span className="card-open">
                    <ArrowUpRight size={18} />
                  </span>
                </div>
                <div className="card-meta">
                  <h3>
                    {d.title ||
                      d.analysis?.name ||
                      new URL(d.canonical_url).hostname}
                  </h3>
                  <span>{new URL(d.canonical_url).hostname}</span>
                  <p>
                    {d.analysis?.summary ||
                      ([
                        "WAITING_AUTH",
                        "WAITING_QUOTA",
                        "WAITING_CONFIG",
                      ].includes(d.status)
                        ? "采集已保存，等待恢复生成。"
                        : "设计语言正在沉淀中。")}
                  </p>
                  <div className="tags">
                    {[
                      ...new Set([
                        ...(d.tags || []),
                        ...(d.analysis?.tags || []),
                      ]),
                    ]
                      .slice(0, 4)
                      .map((t: any) => (
                        <span key={t}>{t}</span>
                      ))}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty">
            <div className="empty-symbol">
              <Layers size={28} strokeWidth={1} />
            </div>
            <h3>
              {query || tag || status
                ? "没有找到匹配的设计"
                : "第一份设计，从这里开始"}
            </h3>
            <p>
              {query || tag || status
                ? "试试其他关键词，或清除筛选条件。"
                : "粘贴一个喜欢的网站，让灵感留下可复用的细节。"}
            </p>
            <Button
              variant="ghost"
              onClick={() => document.getElementById("url")?.focus()}
            >
              收藏一个网站 <ArrowRight size={16} />
            </Button>
          </div>
        )}
        {data.total > 24 && (
          <div className="pagination">
            <Button
              variant="secondary"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <span>
              {page} / {Math.ceil(data.total / 24)}
            </span>
            <Button
              variant="secondary"
              disabled={page * 24 >= data.total}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
