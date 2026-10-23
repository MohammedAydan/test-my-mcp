import type { DeviceMockupLayer } from "@motionforge/scene-spec";
import { CRISP_TEXT_CSS } from "../determinism.js";
import { clamp, num, safeColor } from "./guards.js";
import type { LayerContext } from "./context.js";

const MONO_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';
const SANS_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const DARK_PALETTE = {
  frameBg: "#0f172a",
  chromeBg: "#1e293b",
  viewportBg: "#0b0f19",
  border: "#334155",
  pillBg: "#0f172a",
  macbookBezel: "#0f172a",
  iphoneBorder: "#1e293b",
  textPrimary: "#f8fafc",
  textMuted: "#94a3b8",
  cardBg: "#1e293b",
};

const LIGHT_PALETTE = {
  frameBg: "#f8fafc",
  chromeBg: "#f1f5f9",
  viewportBg: "#ffffff",
  border: "#e2e8f0",
  pillBg: "#ffffff",
  macbookBezel: "#334155",
  iphoneBorder: "#cbd5e1",
  textPrimary: "#0f172a",
  textMuted: "#64748b",
  cardBg: "#f8fafc",
};

const TRAFFIC_LIGHT_COLORS = ["#ff5f56", "#ffbd2e", "#27c93f"] as const;

function createTrafficLights(): HTMLElement {
  const container = document.createElement("div");
  container.className = "mf-traffic-lights";
  container.style.cssText = "display:flex;align-items:center;gap:8px;flex:none;";

  for (const color of TRAFFIC_LIGHT_COLORS) {
    const dot = document.createElement("span");
    dot.className = "mf-traffic-light";
    dot.style.cssText = [
      "display:block",
      "width:11px",
      "height:11px",
      "border-radius:50%",
      `background:${color}`,
      "opacity:0.92",
    ].join(";");
    container.appendChild(dot);
  }

  return container;
}

function buildContentUi(
  variant: string,
  palette: typeof DARK_PALETTE,
  accent: string,
  titleOrUrl: string
): HTMLElement {
  const content = document.createElement("div");
  content.className = `mf-mockup-content mf-variant-${variant}`;
  content.style.cssText = "width:100%;height:100%;box-sizing:border-box;display:flex;flex-direction:column;";

  if (variant === "dashboard") {
    // 3 KPI metric cards with SVG sparklines
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:16px;";

    const cardsData = [
      { label: "Total Revenue", val: "$94.2K", change: "+14.2%", path: "M0 32 Q 25 18, 50 24 T 100 8 T 150 14 T 200 4" },
      { label: "Active Users", val: "18,429", change: "+8.4%", path: "M0 28 Q 30 32, 60 16 T 120 20 T 160 8 T 200 6" },
      { label: "Avg Latency", val: "14.2ms", change: "-2.1ms", path: "M0 12 Q 35 14, 70 28 T 130 18 T 170 30 T 200 24" },
    ];

    for (const card of cardsData) {
      const cardEl = document.createElement("div");
      cardEl.className = "mf-kpi-card";
      cardEl.style.cssText = [
        `background:${palette.cardBg}`,
        `border:1px solid ${palette.border}`,
        "border-radius:10px",
        "padding:14px 16px",
        "display:flex",
        "flex-direction:column",
        "gap:6px",
      ].join(";");

      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;justify-content:space-between;align-items:center;";

      const labelSpan = document.createElement("span");
      labelSpan.style.cssText = `font-size:12px;color:${palette.textMuted};font-family:${SANS_STACK};font-weight:500;`;
      labelSpan.textContent = card.label;
      topRow.appendChild(labelSpan);

      const changeSpan = document.createElement("span");
      changeSpan.style.cssText = `font-size:11px;color:${accent};font-family:${MONO_STACK};font-weight:600;`;
      changeSpan.textContent = card.change;
      topRow.appendChild(changeSpan);
      cardEl.appendChild(topRow);

      const valSpan = document.createElement("div");
      valSpan.style.cssText = `font-size:22px;color:${palette.textPrimary};font-family:${SANS_STACK};font-weight:700;`;
      valSpan.textContent = card.val;
      cardEl.appendChild(valSpan);

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 200 36");
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "28");
      svg.style.cssText = "display:block;overflow:visible;margin-top:4px;";

      const sparkline = document.createElementNS("http://www.w3.org/2000/svg", "path");
      sparkline.setAttribute("d", card.path);
      sparkline.setAttribute("fill", "none");
      sparkline.setAttribute("stroke", accent);
      sparkline.setAttribute("stroke-width", "2.2");
      sparkline.setAttribute("stroke-linecap", "round");
      sparkline.setAttribute("stroke-linejoin", "round");
      svg.appendChild(sparkline);
      cardEl.appendChild(svg);

      grid.appendChild(cardEl);
    }
    content.appendChild(grid);

    // Chart preview area
    const mainArea = document.createElement("div");
    mainArea.style.cssText = [
      "flex:1",
      `background:${palette.cardBg}`,
      `border:1px solid ${palette.border}`,
      "border-radius:10px",
      "padding:16px",
      "display:flex",
      "flex-direction:column",
      "justify-content:center",
    ].join(";");

    const chartSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chartSvg.setAttribute("viewBox", "0 0 600 160");
    chartSvg.setAttribute("width", "100%");
    chartSvg.setAttribute("height", "100%");
    chartSvg.style.cssText = "overflow:visible;";

    for (let i = 0; i < 4; i++) {
      const y = 30 + i * 36;
      const gridLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      gridLine.setAttribute("x1", "0");
      gridLine.setAttribute("y1", String(y));
      gridLine.setAttribute("x2", "600");
      gridLine.setAttribute("y2", String(y));
      gridLine.setAttribute("stroke", palette.border);
      gridLine.setAttribute("stroke-dasharray", "4 4");
      gridLine.setAttribute("stroke-width", "1");
      chartSvg.appendChild(gridLine);
    }

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "0,120 75,95 150,110 225,60 300,75 375,40 450,55 525,25 600,35");
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", accent);
    polyline.setAttribute("stroke-width", "3");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    chartSvg.appendChild(polyline);

    mainArea.appendChild(chartSvg);
    content.appendChild(mainArea);
  } else if (variant === "code") {
    // Syntax-tinted code snippet
    const codeContainer = document.createElement("div");
    codeContainer.className = "mf-mockup-code";
    codeContainer.style.cssText = [
      "flex:1",
      `background:${palette.cardBg}`,
      `border:1px solid ${palette.border}`,
      "border-radius:10px",
      "padding:20px",
      `font-family:${MONO_STACK}`,
      "font-size:13px",
      "line-height:1.7",
      "box-sizing:border-box",
      "overflow:hidden",
    ].join(";");

    const lines = [
      [{ text: "import", color: "#ff7b72" }, { text: " { EngineCore } ", color: palette.textPrimary }, { text: "from", color: "#ff7b72" }, { text: ' "@motionforge/core-engine";', color: "#a5d6ff" }],
      [{ text: "// Initialize creative scene", color: "#6e7681" }],
      [{ text: "const", color: "#ff7b72" }, { text: " scene = ", color: palette.textPrimary }, { text: "await", color: "#ff7b72" }, { text: ' EngineCore.loadScene("', color: palette.textPrimary }, { text: titleOrUrl, color: accent }, { text: '");', color: palette.textPrimary }],
      [{ text: "const", color: "#ff7b72" }, { text: " renderResult = ", color: palette.textPrimary }, { text: "await", color: "#ff7b72" }, { text: " scene.render({ quality: ", color: palette.textPrimary }, { text: '"production"', color: "#a5d6ff" }, { text: " });", color: palette.textPrimary }],
      [{ text: "console", color: "#79c0ff" }, { text: ".log(", color: palette.textPrimary }, { text: '"Master render ready"', color: "#a5d6ff" }, { text: ", renderResult.meta);", color: palette.textPrimary }],
    ];

    for (const lineTokens of lines) {
      const lineDiv = document.createElement("div");
      for (const tok of lineTokens) {
        const span = document.createElement("span");
        span.style.color = tok.color;
        span.textContent = tok.text;
        lineDiv.appendChild(span);
      }
      codeContainer.appendChild(lineDiv);
    }

    content.appendChild(codeContainer);
  } else if (variant === "metrics") {
    // Big numbers + trend arrows
    const metricsGrid = document.createElement("div");
    metricsGrid.className = "mf-mockup-metrics";
    metricsGrid.style.cssText = [
      "flex:1",
      "display:grid",
      "grid-template-columns:repeat(2,1fr)",
      "gap:20px",
      "align-items:center",
    ].join(";");

    const metricsData = [
      { value: "99.98%", label: "SYSTEM UPTIME SLA", trend: "+0.12%", up: true },
      { value: "< 14ms", label: "P99 PIPELINE LATENCY", trend: "-4.8ms", up: true },
    ];

    for (const m of metricsData) {
      const mCard = document.createElement("div");
      mCard.style.cssText = [
        `background:${palette.cardBg}`,
        `border:1px solid ${palette.border}`,
        "border-radius:12px",
        "padding:28px 24px",
        "display:flex",
        "flex-direction:column",
        "gap:8px",
      ].join(";");

      const topRow = document.createElement("div");
      topRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;";

      const labelEl = document.createElement("div");
      labelEl.style.cssText = `font-size:12px;font-weight:600;letter-spacing:0.06em;color:${palette.textMuted};font-family:${SANS_STACK};`;
      labelEl.textContent = m.label;
      topRow.appendChild(labelEl);

      const trendEl = document.createElement("div");
      trendEl.style.cssText = `display:flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:${accent};font-family:${MONO_STACK};`;
      const arrowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      arrowSvg.setAttribute("viewBox", "0 0 16 16");
      arrowSvg.setAttribute("width", "14");
      arrowSvg.setAttribute("height", "14");
      const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      arrowPath.setAttribute("d", "M8 3l5 5h-3v5H6V8H3l5-5z");
      arrowPath.setAttribute("fill", accent);
      arrowSvg.appendChild(arrowPath);
      trendEl.appendChild(arrowSvg);
      const trendText = document.createElement("span");
      trendText.textContent = m.trend;
      trendEl.appendChild(trendText);
      topRow.appendChild(trendEl);
      mCard.appendChild(topRow);

      const valEl = document.createElement("div");
      valEl.style.cssText = `font-size:46px;font-weight:800;color:${palette.textPrimary};font-family:${SANS_STACK};letter-spacing:-0.03em;`;
      valEl.textContent = m.value;
      mCard.appendChild(valEl);

      metricsGrid.appendChild(mCard);
    }
    content.appendChild(metricsGrid);
  } else if (variant === "analytics") {
    // Mini bar/line chart
    const analyticsBox = document.createElement("div");
    analyticsBox.className = "mf-mockup-analytics";
    analyticsBox.style.cssText = [
      "flex:1",
      `background:${palette.cardBg}`,
      `border:1px solid ${palette.border}`,
      "border-radius:10px",
      "padding:20px",
      "display:flex",
      "flex-direction:column",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = `font-size:14px;font-weight:700;color:${palette.textPrimary};font-family:${SANS_STACK};margin-bottom:16px;`;
    header.textContent = "Weekly Render Throughput";
    analyticsBox.appendChild(header);

    const chartSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chartSvg.setAttribute("viewBox", "0 0 560 160");
    chartSvg.setAttribute("width", "100%");
    chartSvg.setAttribute("height", "100%");
    chartSvg.style.cssText = "overflow:visible;";

    const barData = [45, 62, 85, 78, 110, 135, 120];
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const barWidth = 42;
    const spacing = 75;

    for (let i = 0; i < barData.length; i++) {
      const val = barData[i]!;
      const x = 30 + i * spacing;
      const barH = val;
      const y = 140 - barH;

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(barWidth));
      rect.setAttribute("height", String(barH));
      rect.setAttribute("rx", "6");
      rect.setAttribute("fill", accent);
      rect.setAttribute("opacity", "0.85");
      chartSvg.appendChild(rect);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(x + barWidth / 2));
      text.setAttribute("y", "156");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "11");
      text.setAttribute("fill", palette.textMuted);
      text.setAttribute("font-family", SANS_STACK);
      text.textContent = days[i]!;
      chartSvg.appendChild(text);
    }

    analyticsBox.appendChild(chartSvg);
    content.appendChild(analyticsBox);
  } else {
    // blank
    const blankBox = document.createElement("div");
    blankBox.className = "mf-mockup-blank";
    blankBox.style.cssText = "flex:1;";
    content.appendChild(blankBox);
  }

  return content;
}

export function renderDeviceMockup(
  layer: DeviceMockupLayer,
  ctx: LayerContext
): { content: HTMLElement } {
  const deviceType = layer.deviceType ?? "browser";
  const theme = layer.theme ?? "dark";
  const contentVariant = layer.contentVariant ?? "dashboard";
  const titleOrUrl = typeof layer.titleOrUrl === "string" ? layer.titleOrUrl : "app.motionforge.ai";
  const accent = safeColor(layer.accentColor, "#38bdf8");
  const palette = theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;

  // The layer root (host): positioned by transform.ts
  const host = document.createElement("div");
  host.className = `mf-device-mockup mf-${deviceType}`;
  host.style.cssText = [
    "position:absolute",
    `left:${clamp(num(layer.position?.xPct, 50), -300, 300)}%`,
    `top:${clamp(num(layer.position?.yPct, 50), -300, 300)}%`,
    "display:flex",
    "flex-direction:column",
    "align-items:center",
    "justify-content:center",
    "box-sizing:border-box",
    "pointer-events:none",
    CRISP_TEXT_CSS,
  ].join(";");

  // Headline rendered above the device in the frame's own typography
  if (typeof layer.headline === "string" && layer.headline.trim().length > 0) {
    const headlineEl = document.createElement("div");
    headlineEl.className = "mf-mockup-headline";
    headlineEl.style.cssText = [
      "margin-bottom:20px",
      "font-size:28px",
      "font-weight:700",
      `color:${palette.textPrimary}`,
      `font-family:${SANS_STACK}`,
      "text-align:center",
      "letter-spacing:-0.02em",
    ].join(";");
    headlineEl.textContent = layer.headline;
    host.appendChild(headlineEl);
  }

  // INNER frame wrapper: tiltDeg is applied here, NEVER on host (repo rule 13)
  const innerFrame = document.createElement("div");
  innerFrame.className = `mf-mockup-inner mf-device-${deviceType} mf-theme-${theme}`;

  if (layer.tiltDeg) {
    const rx = clamp(num(layer.tiltDeg.rotateX, 0), -35, 35);
    const ry = clamp(num(layer.tiltDeg.rotateY, 0), -35, 35);
    innerFrame.style.transform = `perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    innerFrame.style.transformStyle = "preserve-3d";
  }

  if (deviceType === "browser") {
    // ---- BROWSER MOCKUP ----
    innerFrame.style.cssText += [
      "width:860px",
      "height:500px",
      "max-width:100%",
      "max-height:100%",
      `background:${palette.viewportBg}`,
      `border:1px solid ${palette.border}`,
      "border-radius:12px",
      "box-shadow:0 24px 60px rgba(0,0,0,0.45)",
      "overflow:hidden",
      "display:flex",
      "flex-direction:column",
      "box-sizing:border-box",
    ].join(";");

    // Chrome Header
    const chrome = document.createElement("div");
    chrome.className = "mf-mockup-chrome";
    chrome.style.cssText = [
      "display:flex",
      "align-items:center",
      "height:42px",
      "padding:0 14px",
      "gap:14px",
      `background:${palette.chromeBg}`,
      `border-bottom:1px solid ${palette.border}`,
      "box-sizing:border-box",
    ].join(";");

    chrome.appendChild(createTrafficLights());

    const urlPill = document.createElement("div");
    urlPill.className = "mf-url-pill";
    urlPill.style.cssText = [
      "flex:1",
      "max-width:440px",
      "height:26px",
      "border-radius:6px",
      `background:${palette.pillBg}`,
      `border:1px solid ${palette.border}`,
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:0 10px",
      "font-size:12px",
      `color:${palette.textMuted}`,
      `font-family:${MONO_STACK}`,
      "text-overflow:ellipsis",
      "overflow:hidden",
      "white-space:nowrap",
      "box-sizing:border-box",
    ].join(";");
    urlPill.textContent = titleOrUrl;
    chrome.appendChild(urlPill);

    innerFrame.appendChild(chrome);

    const body = document.createElement("div");
    body.style.cssText = "flex:1;padding:20px;box-sizing:border-box;overflow:hidden;";
    body.appendChild(buildContentUi(contentVariant, palette, accent, titleOrUrl));
    innerFrame.appendChild(body);
  } else if (deviceType === "macbook") {
    // ---- MACBOOK MOCKUP ----
    innerFrame.style.cssText += [
      "width:860px",
      "max-width:100%",
      "display:flex",
      "flex-direction:column",
      "align-items:center",
      "box-sizing:border-box",
    ].join(";");

    // Display Screen
    const screen = document.createElement("div");
    screen.className = "mf-macbook-screen";
    screen.style.cssText = [
      "width:100%",
      "height:480px",
      `background:${palette.viewportBg}`,
      `border:12px solid ${palette.macbookBezel}`,
      "border-radius:14px 14px 0 0",
      "position:relative",
      "display:flex",
      "flex-direction:column",
      "box-sizing:border-box",
      "overflow:hidden",
      "box-shadow:0 24px 60px rgba(0,0,0,0.5)",
    ].join(";");

    // Top Camera Dot
    const cameraDot = document.createElement("div");
    cameraDot.className = "mf-camera-dot";
    cameraDot.style.cssText = [
      "width:6px",
      "height:6px",
      "border-radius:50%",
      "background:#475569",
      "position:absolute",
      "top:3px",
      "left:50%",
      "transform:translateX(-50%)",
      "z-index:10",
    ].join(";");
    screen.appendChild(cameraDot);

    // Screen Header
    const screenHeader = document.createElement("div");
    screenHeader.style.cssText = [
      "display:flex",
      "align-items:center",
      "height:34px",
      "padding:0 12px",
      "gap:10px",
      `background:${palette.chromeBg}`,
      `border-bottom:1px solid ${palette.border}`,
      "box-sizing:border-box",
    ].join(";");
    screenHeader.appendChild(createTrafficLights());

    const titleEl = document.createElement("div");
    titleEl.style.cssText = `font-size:12px;color:${palette.textMuted};font-family:${MONO_STACK};margin-left:6px;`;
    titleEl.textContent = titleOrUrl;
    screenHeader.appendChild(titleEl);
    screen.appendChild(screenHeader);

    const screenBody = document.createElement("div");
    screenBody.style.cssText = "flex:1;padding:18px;box-sizing:border-box;overflow:hidden;";
    screenBody.appendChild(buildContentUi(contentVariant, palette, accent, titleOrUrl));
    screen.appendChild(screenBody);

    innerFrame.appendChild(screen);

    // MacBook Base / Hinge
    const hinge = document.createElement("div");
    hinge.className = "mf-macbook-hinge";
    hinge.style.cssText = [
      "width:104%",
      "height:16px",
      "background:linear-gradient(180deg,#64748b 0%,#475569 50%,#334155 100%)",
      "border-radius:0 0 16px 16px",
      "margin-top:-1px",
      "position:relative",
      "box-shadow:0 16px 32px rgba(0,0,0,0.45)",
    ].join(";");

    const notch = document.createElement("div");
    notch.style.cssText = [
      "width:88px",
      "height:5px",
      "background:#1e293b",
      "border-radius:0 0 4px 4px",
      "position:absolute",
      "top:0",
      "left:50%",
      "transform:translateX(-50%)",
    ].join(";");
    hinge.appendChild(notch);

    innerFrame.appendChild(hinge);
  } else if (deviceType === "iphone") {
    // ---- IPHONE MOCKUP ----
    innerFrame.style.cssText += [
      "width:340px",
      "height:680px",
      "max-width:100%",
      "max-height:100%",
      `background:${palette.viewportBg}`,
      `border:10px solid ${palette.iphoneBorder}`,
      "border-radius:44px",
      "position:relative",
      "display:flex",
      "flex-direction:column",
      "box-sizing:border-box",
      "overflow:hidden",
      "box-shadow:0 28px 65px rgba(0,0,0,0.5)",
    ].join(";");

    // Dynamic Island / Notch
    const notchEl = document.createElement("div");
    notchEl.className = "mf-notch mf-dynamic-island";
    notchEl.style.cssText = [
      "position:absolute",
      "top:12px",
      "left:50%",
      "transform:translateX(-50%)",
      "width:110px",
      "height:28px",
      "background:#000000",
      "border-radius:16px",
      "z-index:10",
      "display:flex",
      "align-items:center",
      "justify-content:flex-end",
      "padding-right:10px",
      "box-sizing:border-box",
    ].join(";");

    const lens = document.createElement("div");
    lens.style.cssText = "width:10px;height:10px;border-radius:50%;background:#1e293b;";
    notchEl.appendChild(lens);
    innerFrame.appendChild(notchEl);

    // Viewport
    const viewport = document.createElement("div");
    viewport.style.cssText = [
      "flex:1",
      "padding:52px 16px 24px 16px",
      "display:flex",
      "flex-direction:column",
      "box-sizing:border-box",
      "overflow:hidden",
    ].join(";");
    viewport.appendChild(buildContentUi(contentVariant, palette, accent, titleOrUrl));
    innerFrame.appendChild(viewport);
  } else {
    // ---- TERMINAL MOCKUP ----
    innerFrame.style.cssText += [
      "width:820px",
      "height:480px",
      "max-width:100%",
      "max-height:100%",
      `background:${theme === "light" ? "#f1f5f9" : "#0d1117"}`,
      `border:1px solid ${palette.border}`,
      "border-radius:12px",
      "box-shadow:0 24px 60px rgba(0,0,0,0.5)",
      "overflow:hidden",
      "display:flex",
      "flex-direction:column",
      "box-sizing:border-box",
    ].join(";");

    // Header bar
    const termHeader = document.createElement("div");
    termHeader.className = "mf-terminal-header";
    termHeader.style.cssText = [
      "display:flex",
      "align-items:center",
      "height:38px",
      "padding:0 14px",
      "gap:14px",
      `background:${palette.chromeBg}`,
      `border-bottom:1px solid ${palette.border}`,
      "box-sizing:border-box",
    ].join(";");

    termHeader.appendChild(createTrafficLights());

    const termTitle = document.createElement("div");
    termTitle.className = "mf-terminal-title";
    termTitle.style.cssText = [
      "flex:1",
      "text-align:center",
      `font-family:${MONO_STACK}`,
      "font-size:12px",
      `color:${palette.textMuted}`,
      "padding-right:48px",
      "text-overflow:ellipsis",
      "overflow:hidden",
      "white-space:nowrap",
    ].join(";");
    termTitle.textContent = titleOrUrl;
    termHeader.appendChild(termTitle);
    innerFrame.appendChild(termHeader);

    // Terminal Body
    const termBody = document.createElement("div");
    termBody.style.cssText = [
      "flex:1",
      "padding:20px",
      `font-family:${MONO_STACK}`,
      "font-size:13px",
      "line-height:1.6",
      "box-sizing:border-box",
      "overflow:hidden",
    ].join(";");

    const promptLine = document.createElement("div");
    promptLine.className = "mf-prompt-line";
    promptLine.style.cssText = "margin-bottom:12px;";

    const promptMarker = document.createElement("span");
    promptMarker.className = "mf-prompt";
    promptMarker.style.cssText = `color:${accent};font-weight:700;margin-right:8px;`;
    promptMarker.textContent = "$ ";
    promptLine.appendChild(promptMarker);

    const cmdSpan = document.createElement("span");
    cmdSpan.style.color = palette.textPrimary;
    cmdSpan.textContent = `motionforge dev --scene ${titleOrUrl}`;
    promptLine.appendChild(cmdSpan);
    termBody.appendChild(promptLine);

    const statusLine = document.createElement("div");
    statusLine.style.cssText = `color:${palette.textMuted};margin-bottom:6px;`;
    statusLine.textContent = "[info] Engine core ready, compiling render pipeline...";
    termBody.appendChild(statusLine);

    const readyLine = document.createElement("div");
    readyLine.style.cssText = `color:${accent};font-weight:600;margin-bottom:16px;`;
    readyLine.textContent = "[ok] Live timeline mounted at 60 fps";
    termBody.appendChild(readyLine);

    termBody.appendChild(buildContentUi(contentVariant, palette, accent, titleOrUrl));
    innerFrame.appendChild(termBody);
  }

  host.appendChild(innerFrame);
  ctx.content.appendChild(host);

  return { content: host };
}
