"use client";
import { useEffect, useState } from "react";
import { api } from "../../components/library";
import { Button } from "../../components/button";
export default function Settings() {
  const [data, setData] = useState<any>(),
    [error, setError] = useState(""),
    [provider, setProvider] = useState("antigravity-cli"),
    [model, setModel] = useState("gemini-3.8-flash-medium"),
    [apiKey, setApiKey] = useState(""),
    [saving, setSaving] = useState(false),
    [saved, setSaved] = useState("");
  const load = () =>
    api("settings")
      .then((value) => { setData(value); setProvider(value.provider); setModel(value.model); });
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  return (
    <div className="settings">
      <p className="eyebrow">工作环境</p>
      <h1>设置</h1>
      {error && <p className="notice">{error}</p>}
      <section>
        <h2>AI 连接</h2>
        <form onSubmit={async (event) => {
          event.preventDefault(); setSaving(true); setError(""); setSaved("");
          try {
            await api("settings", "PATCH", { provider, model, ...(provider === "deepseek" && apiKey.trim() ? { deepseekApiKey: apiKey.trim() } : {}) });
            setApiKey("");
            await load(); setSaved("模型设置已保存，对新任务和重新生成生效。");
          } catch (e) { setError(e instanceof Error ? e.message : "保存失败，请重试。"); }
          finally { setSaving(false); }
        }} className="model-settings-form">
          <label htmlFor="model-provider">AI 服务</label>
          <select id="model-provider" value={provider} disabled={!data || saving} onChange={(e) => {
            const value = e.target.value; setProvider(value); setSaved(""); setApiKey("");
            setModel(value === "deepseek" ? "deepseek-flash" : value === "gemini-cli" ? "CLI-default" : "gemini-3.8-flash-medium");
          }}>
            <option value="antigravity-cli">Gemini · Google AI Pro</option>
            <option value="deepseek">DeepSeek · API</option>
            {data?.provider === "gemini-cli" && <option value="gemini-cli">Gemini CLI</option>}
          </select>
          <label htmlFor="model-name">模型</label>
          <input id="model-name" value={model} disabled={!data || saving} required maxLength={100} onChange={(e) => { setModel(e.target.value); setSaved(""); }} autoComplete="off" spellCheck={false} />
          {provider === "deepseek" && <>
            <label htmlFor="deepseek-api-key">DeepSeek API 密钥</label>
            <input id="deepseek-api-key" type="password" value={apiKey} disabled={!data || saving} maxLength={512} autoComplete="new-password" spellCheck={false} aria-describedby="deepseek-key-help" placeholder="输入密钥以保存或替换" onChange={(e) => { setApiKey(e.target.value); setSaved(""); }} />
            <p id="deepseek-key-help">留空保留已有密钥。保存后不会显示密钥明文。</p>
          </>}
          <div><Button disabled={!data || saving || (provider === data.provider && model === data.model && !apiKey.trim())} type="submit">{saving ? "保存中…" : "保存模型设置"}</Button></div>
        </form>
        <p role="status" aria-live="polite">{saved}</p>
        <p>{provider === "deepseek"
          ? "使用 DeepSeek API，按官方价格计费。截图与设计证据将发送至 DeepSeek。"
          : "使用 Google AI Pro 关联账号登录。额度不足时保留任务，恢复后继续。"}</p>
        <dl>
          <dt>{provider === "deepseek" ? "API 密钥" : "授权缓存"}</dt>
          <dd>{(provider === data?.provider ? data?.authCached : data?.connections?.[provider === "deepseek" ? "deepseek" : "gemini"])
            ? "已配置，实际有效性在调用时验证" : provider === "deepseek" ? "尚未配置" : "尚未登录"}</dd>
        </dl>
        <p>已有任务保留创建时的模型；不会自动切换服务。</p>
        <details>
          <summary>{provider === "deepseek" ? "配置密钥" : "登录与恢复"}</summary>
          {provider === "deepseek" ? <>
            <p>在上方填写密钥并保存。这里保存的密钥优先于后台环境变量和本地密钥文件。</p>
            <p>密钥保存在服务端，刷新页面不会回填。保存后可恢复等待认证的任务。</p>
          </> : <>
            <p>在专用后台环境完成 Google 授权后返回这里恢复任务。首次授权需要浏览器交互。</p>
            <pre>docker compose run --rm -it worker pnpm --filter @harvester/core exec tsx src/agy-login.ts</pre>
            <p>凭证只保存在专用授权卷。</p>
          </>}
        </details>
        <Button variant="secondary" onClick={() => { setError(""); void load().catch((e) => setError(e.message)); }}>刷新连接状态</Button>
      </section>
      <section>
        <h2>采集参数</h2>
        <dl>
          <dt>桌面</dt>
          <dd>1440 × 1000</dd>
          <dt>平板</dt>
          <dd>834 × 1112</dd>
          <dt>手机</dt>
          <dd>393 × 852</dd>
          <dt>截图</dt>
          <dd>完整页面 PNG · 单次最多 30000px 高</dd>
          <dt>并发</dt>
          <dd>1 个网站</dd>
        </dl>
      </section>
      <section>
        <h2>资产与备份</h2>
        <dl>
          <dt>资产目录</dt>
          <dd>{data?.storage || "读取中"}</dd>
          <dt>已用空间</dt>
          <dd>{data ? `${(data.bytes / 1024 / 1024).toFixed(1)} MB` : "—"}</dd>
        </dl>
        <p>
          备份需同时包含 PostgreSQL 和资产目录。下载方案可获得独立可读的
          PNG、JSON 与 Markdown。
        </p>
        <pre>./scripts/backup.sh /你的备份目录</pre>
        <p>恢复命令与验证步骤见项目 README。</p>
      </section>
    </div>
  );
}
