// ============================================================
// Client-side SceneSpec & Field Validation
// Matching constraints from API_DOCUMENTATION.md
// ============================================================

export function validateScene(scene) {
  const issues = [];
  if (!scene) {
    return { ok: false, issues: ['Scene is empty or null'] };
  }
  if (!scene.id || typeof scene.id !== 'string') {
    issues.push('scene.id: Required string identifier');
  }
  if (scene.durationMs == null || typeof scene.durationMs !== 'number') {
    issues.push('scene.durationMs: Required number');
  } else if (scene.durationMs < 300 || scene.durationMs > 600000) {
    issues.push('scene.durationMs: Must be between 300ms and 600,000ms (10 minutes)');
  }

  if (!scene.canvas || typeof scene.canvas !== 'object') {
    issues.push('scene.canvas: Required canvas specification');
  }

  const seenIds = new Set();
  const layers = scene.layers || [];

  layers.forEach((layer, idx) => {
    const p = `layers.${idx}`;
    if (!layer.id) {
      issues.push(`${p}.id: Layer ID is required`);
    } else {
      if (!/^[a-zA-Z0-9_-]+$/.test(layer.id)) {
        issues.push(`${p}.id: Must be alphanumeric and may include '-' or '_'`);
      }
      if (seenIds.has(layer.id)) {
        issues.push(`${p}.id: Duplicate layer ID "${layer.id}"`);
      }
      seenIds.add(layer.id);
    }

    if (!layer.type) {
      issues.push(`${p}.type: Layer type is required`);
    }

    if (layer.at != null && typeof layer.at === 'number') {
      if (layer.at < 0) {
        issues.push(`${p}.at: Start time cannot be negative`);
      }
      if (scene.durationMs && layer.at >= scene.durationMs) {
        issues.push(`${p}.at: Layer starts at or after scene duration (${scene.durationMs}ms)`);
      }
    }

    if (layer.duration != null && typeof layer.duration === 'number') {
      if (layer.duration <= 0) {
        issues.push(`${p}.duration: Layer duration must be greater than 0`);
      }
    }

    if (layer.sizePx != null && typeof layer.sizePx === 'number') {
      if (layer.sizePx < 8 || layer.sizePx > 600) {
        issues.push(`${p}.sizePx: Font/icon size must be between 8 and 600 px`);
      }
    }
  });

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateField(field, value, context = {}) {
  switch (field) {
    case 'sizePx': {
      const n = Number(value);
      if (isNaN(n) || n < 8 || n > 600) return 'Must be between 8 and 600 px';
      return null;
    }
    case 'duration':
    case 'durationMs': {
      const n = Number(value);
      if (isNaN(n) || n <= 0) return 'Duration must be greater than 0 ms';
      if (n > 600000) return 'Max duration is 600,000 ms (10 min)';
      return null;
    }
    case 'at': {
      const n = Number(value);
      if (isNaN(n) || n < 0) return 'Start time cannot be negative';
      if (context.sceneDuration && n >= context.sceneDuration) return `Cannot exceed scene duration (${context.sceneDuration} ms)`;
      return null;
    }
    case 'id': {
      if (!value || typeof value !== 'string') return 'ID is required';
      if (!/^[a-zA-Z0-9_-]+$/.test(value)) return 'Alphanumeric, hyphen, or underscore only';
      return null;
    }
    case 'fill':
    case 'color': {
      if (!value) return null;
      if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value.trim()) && !value.startsWith('rgba') && !value.startsWith('rgb')) {
        return 'Must be a valid hex or rgb(a) color';
      }
      return null;
    }
    default:
      return null;
  }
}
