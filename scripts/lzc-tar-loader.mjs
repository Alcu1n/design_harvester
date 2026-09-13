// Compatibility fix for lzc-cli 2.0.9: tar.t auto-resumes an entry immediately
// after onReadEntry returns, racing the async gzip consumer and dropping bytes.
// Apply only to this pinned module, without modifying global/npm-cache files.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith('/@lazycatcloud/lzc-cli/lib/app/lpk_build_images_pack_local.js')) return result;
  const source = String(result.source);
  const before = 'await tar.t({\n\t\tfile: archivePath,';
  if (source.split(before).length !== 2) throw new Error('Unexpected lzc-cli tar implementation; review compatibility patch');
  return { ...result, source: source.replace(before, 'await tar.t({\n\t\tnoResume: true,\n\t\tfile: archivePath,') };
}
