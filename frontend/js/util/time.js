// ============================================================
// Time Formatting & Parsing Utilities
// ============================================================

export const fmtTime = (ms) => {
  const safeMs = Math.max(0, Math.round(ms || 0));
  const h = Math.floor(safeMs / 3600000);
  const m = Math.floor((safeMs % 3600000) / 60000);
  const s = Math.floor((safeMs % 60000) / 1000);
  const r = safeMs % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
};

export const fmtDuration = (ms) => {
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
};

export const parseTimecode = (str) => {
  if (!str) return 0;
  if (/^\d+$/.test(str.trim())) return parseInt(str.trim(), 10);
  const parts = str.split(/[:.]/);
  if (parts.length === 4) {
    const [h, m, s, ms] = parts.map(Number);
    return (h * 3600 + m * 60 + s) * 1000 + ms;
  }
  return 0;
};
