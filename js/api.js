async function api(path, opts = {}) {
  console.info(
    "[Lexicon API] request",
    opts.method || "GET",
    path,
    opts.body || "",
  );
  const started = performance.now();
  let r;
  try {
    r = await fetch("/lexicon" + path, {
      headers: {
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
      ...opts,
    });
  } catch (err) {
    console.error("[Lexicon API] fetch failed", path, err);
    throw err;
  }
  const txt = await r.text();
  console.info(
    "[Lexicon API] response",
    r.status,
    path,
    Math.round(performance.now() - started) + "ms",
    txt.slice(0, 1000),
  );
  let d = null;
  try {
    d = txt ? JSON.parse(txt) : null;
  } catch {
    d = txt;
  }
  if (!r.ok) {
    const e = new Error(
      typeof d === "string" ? d : d?.error || d?.message || `HTTP ${r.status}`,
    );
    e.status = r.status;
    e.data = d;
    console.error("[Lexicon API] error", e);
    throw e;
  }
  return d;
}
async function localMetadata(path) {
  const response = await fetch("/metadata/" + path, {
    signal: AbortSignal.timeout(35000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Local metadata service failed");
  return data;
}
export { api, localMetadata };
