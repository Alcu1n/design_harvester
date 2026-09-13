// Legacy records retain their original presentation until explicitly regenerated.
export function presentation(version: any) {
  return (
    version?.display_zh ||
    (version?.metadata?.language !== "en" && !version?.validation?.language
      ? version?.analysis
      : undefined)
  );
}
