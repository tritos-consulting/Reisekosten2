// src/TravelExpenseFormDE.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

/**
 * Diese Version zeichnet das Deckblatt VEKTOBASIERT (echter Text) mit jsPDF
 * → deutlich bessere OCR/Metadaten-Erkennung bei DATEV.
 * - Dokumenteigenschaften (Titel/Keywords) + „Maschinenlese“-Zeile
 * - Upload Bilder & PDFs, Downscaling/Kompression, je Anhang 1 Seite
 * - Responsive UI, Pflichtfelder, Tests
 * - Ausklappbarer Bereich für Abzüge (Frühstück/Mittag/Abend)
 */

const TOKENS = {
  radius: 12,
  border: "#E5E7EB",
  bgCard: "#FFFFFF",
  bgApp: "#F8FAFC",
  text: "#0F172A",
  textDim: "#475569",
  textMut: "#64748B",
  primary: "#111827",
  primaryHover: "#0B1220",
  focus: "#2563EB",
};

function useWindowWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const onR = () => setW(window.innerWidth);
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);
  return w;
}
const isTablet = (w) => w >= 768 && w < 1024;
const isDesktop = (w) => w >= 1024;

// ---- UI primitives
const Card = ({ children }) => (
  <div style={{ border: `1px solid ${TOKENS.border}`, borderRadius: TOKENS.radius + 4, boxShadow: "0 8px 24px rgba(15,23,42,0.06)", overflow: "hidden", background: TOKENS.bgCard }}>
    {children}
  </div>
);
const CardHeader = ({ children }) => <div style={{ padding: 20, borderBottom: `1px solid ${TOKENS.border}`, background: "#FAFAFA" }}>{children}</div>;
const CardTitle = ({ children }) => <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.2 }}>{children}</div>;
const CardContent = ({ children }) => <div style={{ paddingInline: 32, paddingBlock: 24, display: "grid", gap: 24, boxSizing: "border-box" }}>{children}</div>;
const Button = ({ children, onClick, variant = "primary", style, disabled, title, ariaLabel }) => {
  const base = { height: 40, padding: "0 14px", borderRadius: TOKENS.radius, border: "1px solid transparent", cursor: disabled ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14, letterSpacing: 0.2, transition: "all .15s ease" };
  const variants = {
    primary: { background: disabled ? "#9CA3AF" : TOKENS.primary, color: "#fff", borderColor: TOKENS.primary },
    secondary: { background: "#FFFFFF", color: TOKENS.text, borderColor: TOKENS.border },
    danger: { background: "#fff", color: "#B91C1C", borderColor: "#FCA5A5" },
    ghost: { background: "rgba(255,255,255,0.9)", color: "#111827", borderColor: "#E5E7EB" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
      style={{ ...base, ...variants[variant], ...style }}
      onMouseEnter={(e) => { if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primaryHover; }}
      onMouseLeave={(e) => { if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primary; }}
    >
      {children}
    </button>
  );
};
const Input = ({ style, ...props }) => (
  <input
    {...props}
    style={{
      width: "100%", height: 34, padding: "6px 8px",
      borderRadius: TOKENS.radius, border: `1px solid ${TOKENS.border}`,
      outline: "none", fontSize: 14, transition: "box-shadow .15s ease, border-color .15s ease",
      background: "#FFFFFF", ...style,
    }}
    onFocus={(e) => { e.currentTarget.style.borderColor = TOKENS.focus; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37,99,235,0.2)"; }}
    onBlur={(e) => { e.currentTarget.style.borderColor = TOKENS.border; e.currentTarget.style.boxShadow = "none"; }}
  />
);
const Label = ({ children, htmlFor }) => (
  <label htmlFor={htmlFor} style={{ display: "block", fontSize: 12, fontWeight: 600, color: TOKENS.textDim, marginBottom: 8, letterSpacing: 0.2 }}>
    {children}
  </label>
);

// ---------- Helpers ----------
const fmt = (n) => (Number.isFinite(n) ? n : 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
function kwIsoFromDateStr(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return "";
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7 + 1; // 1..7 (Mo..So)
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  const year = dt.getUTCFullYear();
  return `${week}/${year}`;
}
function kmFlatCost(km, rate = 0.30) {
  const k = Math.max(0, Math.floor(num(km) * 100) / 100);
  return k * rate;
}

// --- Kompression/Anhang ---
const TARGET_IMG_PX = 1360;
const JPG_QUALITY_MAIN = 0.78;
const JPG_QUALITY_ATTACH = 0.72;

const LOGO_SRC = "logo.png"; // lege dein Logo in /public/logo.png
const LOGO_W = 180;
const LOGO_H = 84;
const LOGO_RIGHT = 24;

// pdf.js Loader (lokal -> CDN)
const PDFJS_VERSION = "3.11.174";
const PDFJS_CANDIDATES = [
  { lib: "pdfjs/pdf.min.js", worker: "pdfjs/pdf.worker.min.js" },
  { lib: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`, worker: `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js` },
];
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error(`Script load failed: ${src}`));
    document.head.appendChild(s);
  });
}
async function ensurePdfJs() {
  if (window.pdfjsLib) {
    if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";
    }
    return window.pdfjsLib;
  }
  let lastErr;
  for (const c of PDFJS_CANDIDATES) {
    try {
      await loadScript(c.lib);
      if (!window.pdfjsLib) throw new Error("pdfjsLib global missing");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = c.worker;
      return window.pdfjsLib;
    } catch (e) { lastErr = e; }
  }
  throw new Error(lastErr?.message || "pdf.js konnte nicht geladen werden.");
}

async function downscaleImage(dataUrl, targetWidthPx = TARGET_IMG_PX, quality = JPG_QUALITY_ATTACH) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, targetWidthPx / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

async function renderPdfFileToImages(file) {
  const pdfjsLib = await ensurePdfJs();
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const aspect = vp1.height / vp1.width;
    const targetW = TARGET_IMG_PX;
    const scale = targetW / vp1.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = Math.round(targetW * aspect);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport, intent: "print" }).promise;
    pages.push({ dataUrl: canvas.toDataURL("image/jpeg", JPG_QUALITY_ATTACH), aspect });
  }
  return pages;
}

// Summen
const computeSumFahrt = (fahrt) => kmFlatCost(fahrt.km, 0.30) + num(fahrt.oev) + num(fahrt.bahn) + num(fahrt.taxi);
const computeSumVerpf = (v) =>
  Math.max(
    0,
    num(v.tage8) * num(v.satz8) +
      num(v.tage24) * num(v.satz24) -
      num(v.fruehstueckAbz) * num(v.abzFruehstueck) -
      num(v.mittagAbz) * num(v.abzMittag) -
      num(v.abendAbz) * num(v.abzAbend)
  );
const computeSumUebernacht = (u) => num(u.tatsaechlich) + num(u.pauschale);
const computeSumAuslagen = (arr) => (arr || []).reduce((acc, r) => acc + num(r.betrag), 0);

// ===== PDF Deckblatt-Helper (Text/Tabellen, vektor-basiert) =====
const MARGIN = 24;          // Seitenrand (pt)
const LINE_H = 14;          // Tabellen-Zeilenhöhe
const TABLE_FONT = 11;
const H_FONT = 12;

function drawHeader(pdf, basis, pageW) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(basis.firma || "", MARGIN, MARGIN + 2);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("Reisekostenabrechnung", MARGIN, MARGIN + 22);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  const sub = `${basis.kw ? `KW ${basis.kw} – ` : ""}${basis.name || ""}`;
  pdf.text(sub, MARGIN, MARGIN + 36);
}
function drawLogo(pdf, imgEl, pageW) {
  if (!imgEl) return;
  const x = pageW - LOGO_RIGHT - LOGO_W;
  pdf.addImage(imgEl, "PNG", x, MARGIN, LOGO_W, LOGO_H);
}
function drawKeyValueBlock(pdf, rows, x, y) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  let cy = y;
  rows.forEach(([label, value]) => {
    pdf.setFont("helvetica", "bold");
    pdf.text(`${label}:`, x, cy);
    pdf.setFont("helvetica", "normal");
    pdf.text(String(value || "—"), x + 50, cy);
    cy += LINE_H;
  });
  return cy;
}
function drawTableHeader(pdf, title, x, y) {
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(H_FONT);
  pdf.text(title, x, y);
  return y + 6;
}
function drawRow(pdf, colTexts, colXs, y, isBold = false, rightAlignMask = []) {
  pdf.setFont("helvetica", isBold ? "bold" : "normal");
  pdf.setFontSize(TABLE_FONT);
  for (let i = 0; i < colTexts.length; i++) {
    const txt = String(colTexts[i] ?? "");
    const x = colXs[i];
    if (rightAlignMask[i]) {
      const w = pdf.getTextWidth(txt);
      pdf.text(txt, x - 2, y); // rechtsbündig (x ist rechte Kante)
    } else {
      pdf.text(txt, x, y);
    }
  }
}
function drawHLine(pdf, x1, x2, y) {
  pdf.setLineWidth(0.3);
  pdf.line(x1, y, x2, y);
}
function euro(n) { return fmt(num(n)); }

// ===== Komponente =====
export default function TravelExpenseFormDE() {
  const width = useWindowWidth();

  // ---------- State ----------
  const [basis, setBasis] = useState({
    name: "Kromer Tobias",
    zweck: "",
    beginn: "",
    ende: "",
    kw: "",
    firma: "Tritos Consulting GmbH",
    kwAuto: true,
  });
  const [fahrt, setFahrt] = useState({
    kennzeichen: "",
    tachostandBeginn: "",
    tachostandEnde: "",
    km: "",
    oev: "",
    bahn: "",
    taxi: "",
  });
  const [verpf, setVerpf] = useState({
    tage8: 0,
    tage24: 0,
    fruehstueckAbz: 0,
    satz8: 14,
    satz24: 28,
    abzFruehstueck: 5.6,
    mittagAbz: 0,
    abzMittag: 11.2,
    abendAbz: 0,
    abzAbend: 11.2,
  });
  const [uebernacht, setUebernacht] = useState({ tatsaechlich: "", pauschale: "" });
  const [auslagen, setAuslagen] = useState([{ id: 1, text: "", betrag: "" }]);
  // attachments: {kind:'image'|'pdf', name, dataUrl?|file?}
  const [attachments, setAttachments] = useState([]);
  const [pdfUrl, setPdfUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [testOutput, setTestOutput] = useState([]);

  // Ausklappbarer Bereich für Abzüge
  const [showDeductions, setShowDeductions] = useState(false);

  // Drag & Drop
  const [isDragging, setIsDragging] = useState(false);
  const dropRef = useRef(null);

  // ---------- Effects ----------
  useEffect(() => {
    if (basis.kwAuto && basis.beginn) {
      const kw = kwIsoFromDateStr(basis.beginn);
      setBasis((b) => ({ ...b, kw }));
    }
  }, [basis.beginn, basis.kwAuto]);

  useEffect(() => {
    const hasBeginn = String(fahrt.tachostandBeginn ?? "") !== "";
    const hasEnde = String(fahrt.tachostandEnde ?? "") !== "";
    if (!hasBeginn || !hasEnde) return;
    const b = num(fahrt.tachostandBeginn);
    const e = num(fahrt.tachostandEnde);
    const diff = Math.max(0, e - b);
    if (String(diff) !== String(fahrt.km)) setFahrt((prev) => ({ ...prev, km: String(diff) }));
  }, [fahrt.tachostandBeginn, fahrt.tachostandEnde]);

  // ---------- Memos ----------
  const kilometergeld = useMemo(() => kmFlatCost(fahrt.km, 0.30), [fahrt.km]);
  const sumFahrt = useMemo(() => computeSumFahrt(fahrt), [fahrt]);
  const sumVerpf = useMemo(() => computeSumVerpf(verpf), [verpf]);
  const sumUebernacht = useMemo(() => computeSumUebernacht(uebernacht), [uebernacht]);
  const sumAuslagen = useMemo(() => computeSumAuslagen(auslagen), [auslagen]);
  const gesamt = useMemo(() => sumFahrt + sumVerpf + sumUebernacht + sumAuslagen, [sumFahrt, sumVerpf, sumUebernacht, sumAuslagen]);

  const basisOk = Boolean(basis.name && basis.zweck && basis.beginn && basis.ende && basis.firma);

  // ---------- Handlers ----------
  const addAuslage = () => setAuslagen((a) => [...a, { id: Date.now(), text: "", betrag: "" }]);
  const delAuslage = (id) => setAuslagen((a) => a.filter((x) => x.id !== id));

  const handleFiles = async (filesList) => {
    const files = Array.from(filesList || []);
    const next = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const dataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(file);
        });
        next.push({ kind: "image", name: file.name, dataUrl });
      } else if (file.type === "application/pdf") {
        next.push({ kind: "pdf", name: file.name, file });
      }
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
  };
  const handleFileInputChange = async (e) => { await handleFiles(e.target.files); e.target.value = ""; };
  const removeAttachment = (idx) => setAttachments((prev) => prev.filter((_, i) => i !== idx));

  const onDragOver = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); if (dropRef.current && !dropRef.current.contains(e.relatedTarget)) setIsDragging(false); };
  const onDrop = async (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); if (e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files); };

  // ===== generatePDF: vektorbasierte Deckblatt-Seite + Anhang-Seiten =====
  const generatePDF = async () => {
    setErrMsg("");
    setPdfUrl("");
    try {
      setBusy(true);

      // Logo laden
      const logoImg = await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = LOGO_SRC;
      });

      const pdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
      const pageW = pdf.internal.pageSize.getWidth();

      // Dokumenteigenschaften (für OCR/Erkennung)
      const belegName = `Reisekosten_${basis.name || "Mitarbeiter"}_KW${(basis.kw || "XX").replace("/", "-")}`;
      pdf.setProperties({
        title: belegName,
        subject: "Reisekostenabrechnung",
        keywords: `Reisekosten, ${basis.name || ""}, ${basis.kw || ""}, ${basis.firma || ""}`,
        creator: "Reisekosten Webformular",
      });

      // Unsichtbare Maschinenlese-Zeile (weiß)
      pdf.setTextColor(255, 255, 255);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(1);
      pdf.text(`DOC_NAME:${belegName} TOTAL_EUR:${euro(gesamt).replace(/\s/g, "")}`, MARGIN, 8);
      pdf.setTextColor(0, 0, 0);

      // === Deckblatt zeichnen ===
      drawHeader(pdf, basis, pageW);
      drawLogo(pdf, logoImg, pageW);

      let y = MARGIN + 56;
      const leftEndY = drawKeyValueBlock(pdf, [["Name", basis.name], ["Zweck", basis.zweck]], MARGIN, y);
      const rightEndY = drawKeyValueBlock(pdf, [["Beginn", basis.beginn], ["Ende", basis.ende]], MARGIN + 280, y);
      y = Math.max(leftEndY, rightEndY) + 6;

      // Tabellenbreite, Spalten (Text/Text/Text/Text/Betrag rechts)
      const x = MARGIN;
      const w = pdf.internal.pageSize.getWidth() - MARGIN * 2;
      const colXs = [x, x + 150, x + 330, x + 480, x + w - 2];

      // Fahrtkosten
      y = drawTableHeader(pdf, "Fahrtkosten", x, y + 10);
      drawHLine(pdf, x, x + w, y + 4);
      let rowY = y + 18;

      const km = num(fahrt.km);
      const kmCost = kmFlatCost(km, 0.30);

      drawRow(pdf, ["Privat-PKW", `Kennzeichen: ${fahrt.kennzeichen || "—"}`, `Tachostand: ${fahrt.tachostandBeginn || "—"} → ${fahrt.tachostandEnde || "—"}`, `${km} km × 0,30 €/km`, euro(kmCost)], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawRow(pdf, ["Deutsche Bahn", "", "", "", euro(fahrt.bahn)], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawRow(pdf, ["Taxi", "", "", "", euro(fahrt.taxi)], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawRow(pdf, ["Öffentliche Verkehrsmittel", "", "", "", euro(fahrt.oev)], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;

      drawHLine(pdf, x, x + w, rowY + 4); rowY += LINE_H;
      drawRow(pdf, ["Zwischensumme Fahrtkosten", "", "", "", euro(sumFahrt)], colXs, rowY, true, [false,false,false,false,true]);
      y = rowY + 10;

      // Verpflegung
      y = drawTableHeader(pdf, "Verpflegungsmehraufwand", x, y + 10);
      drawHLine(pdf, x, x + w, y + 4);
      rowY = y + 18;

      drawRow(pdf, ["Tage > 8 Std.", String(verpf.tage8), `Satz ${euro(verpf.satz8)}`, "", euro(num(verpf.tage8) * num(verpf.satz8))], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawRow(pdf, ["Tage 24 Std.", String(verpf.tage24), `Satz ${euro(verpf.satz24)}`, "", euro(num(verpf.tage24) * num(verpf.satz24))], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;

      const abzugFr = num(verpf.fruehstueckAbz) * num(verpf.abzFruehstueck);
      const abzugMi = num(verpf.mittagAbz) * num(verpf.abzMittag);
      const abzugAb = num(verpf.abendAbz) * num(verpf.abzAbend);

      drawRow(pdf, ["abzgl. Frühstück", String(verpf.fruehstueckAbz), `${euro(verpf.abzFruehstueck)} pro Frühstück`, "", `- ${euro(abzugFr)}`], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawRow(pdf, ["abzgl. Mittagessen", String(verpf.mittagAbz), `${euro(verpf.abzMittag)} pro Mittagessen`, "", `- ${euro(abzugMi)}`], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawRow(pdf, ["abzgl. Abendessen", String(verpf.abendAbz), `${euro(verpf.abzAbend)} pro Abendessen`, "", `- ${euro(abzugAb)}`], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;

      drawHLine(pdf, x, x + w, rowY + 4); rowY += LINE_H;
      drawRow(pdf, ["Zwischensumme", "", "", "", euro(sumVerpf)], colXs, rowY, true, [false,false,false,false,true]);
      y = rowY + 10;

      // Übernachtung
      y = drawTableHeader(pdf, "Übernachtungskosten", x, y + 10);
      drawHLine(pdf, x, x + w, y + 4);
      rowY = y + 18;
      drawRow(pdf, ["Tatsächliche Kosten (ohne Verpflegung)", "", "", "", euro(uebernacht.tatsaechlich)], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawRow(pdf, ["Pauschale", "", "", "", euro(uebernacht.pauschale)], colXs, rowY, false, [false,false,false,false,true]); rowY += LINE_H;
      drawHLine(pdf, x, x + w, rowY + 4); rowY += LINE_H;
      drawRow(pdf, ["Zwischensumme", "", "", "", euro(sumUebernacht)], colXs, rowY, true, [false,false,false,false,true]);
      y = rowY + 10;

      // Auslagen
      y = drawTableHeader(pdf, "Sonstige Auslagen", x, y + 10);
      drawHLine(pdf, x, x + w, y + 4);
      rowY = y + 18;
      (auslagen || []).forEach((r) => {
        drawRow(pdf, [r.text || "—", "", "", "", euro(r.betrag)], colXs, rowY, false, [false,false,false,false,true]);
        rowY += LINE_H;
      });
      drawHLine(pdf, x, x + w, rowY + 4); rowY += LINE_H;
      drawRow(pdf, ["Zwischensumme", "", "", "", euro(sumAuslagen)], colXs, rowY, true, [false,false,false,false,true]);
      y = rowY + 14;

      // Gesamtsumme (rechts)
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      const totalTxt = `Gesamte Reisekosten: ${euro(gesamt)}`;
      const totalW = pdf.getTextWidth(totalTxt);
      pdf.text(totalTxt, x + w - totalW, y);

      // === Anhänge (Bilder & PDFs → Seiten) ===
      const allImages = [];
      let pdfRenderFailed = false;

      // Bilder (downscalen)
      for (const att of attachments) {
        if (att.kind === "image") {
          try {
            const small = await downscaleImage(att.dataUrl, TARGET_IMG_PX, JPG_QUALITY_ATTACH);
            allImages.push({ dataUrl: small, name: att.name });
          } catch (e) { console.error("Bildanhang Fehler:", att.name, e); }
        }
      }
      // PDFs als Bilder rendern
      for (const att of attachments) {
        if (att.kind === "pdf") {
          try {
            const imgs = await renderPdfFileToImages(att.file);
            imgs.forEach((img, i) => allImages.push({ dataUrl: img.dataUrl, name: `${att.name} (Seite ${i + 1})` }));
          } catch (e) { console.error("PDF-Render-Fehler:", att.name, e); pdfRenderFailed = true; }
        }
      }

      for (const { dataUrl, name } of allImages) {
        const dim = await new Promise((resolve) => { const image = new Image(); image.onload = () => resolve({ w: image.width, h: image.height }); image.src = dataUrl; });
        const isLandscape = dim.h / dim.w < 1;
        pdf.addPage("a4", isLandscape ? "landscape" : "portrait");
        const curW = pdf.internal.pageSize.getWidth();
        const curH = pdf.internal.pageSize.getHeight();
        const m = 20;
        const maxW = curW - m * 2;
        const maxH = curH - m * 2;
        const s = Math.min(maxW / dim.w, maxH / dim.h);
        const drawW = dim.w * s;
        const drawH = dim.h * s;
        const cx = (curW - drawW) / 2;
        const cy = (curH - drawH) / 2;
        pdf.addImage(dataUrl, "JPEG", cx, cy, drawW, drawH, undefined, "FAST");
        pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
        pdf.text(name || "Anhang", m, curH - m / 2);
      }

      // Download + Preview
      const filename = `${belegName}.pdf`;
      try { pdf.save(filename, { returnPromise: true }); } catch {}
      const blob = pdf.output("blob");
      setPdfUrl(URL.createObjectURL(blob));
      if (pdfRenderFailed) setErrMsg("Hinweis: Mindestens ein PDF-Anhang konnte nicht gerendert werden. Bilder wurden dennoch exportiert.");
      setBusy(false);
    } catch (err) {
      setBusy(false);
      console.error(err);
      setErrMsg(`PDF-Erzeugung fehlgeschlagen: ${err?.message || err}`);
    }
  };

  // ---------- Tests ----------
  const runTests = () => {
    const results = [];
    const pass = (name) => results.push({ name, ok: true });
    const fail = (name, msg) => results.push({ name, ok: false, msg });
    try {
      const n1 = num("1,5"); Math.abs(n1 - 1.5) < 1e-9 ? pass("num('1,5')") : fail("num('1,5')", n1);
      const sf = computeSumFahrt({ km: 100, oev: 10, bahn: 0, taxi: 0 }); Math.abs(sf - 40) < 1e-9 ? pass("Fahrt 100km + 10€") : fail("Fahrt", sf);
      const sv = computeSumVerpf({ tage8: 2, satz8: 14, tage24: 1, satz24: 28, fruehstueckAbz: 1, abzFruehstueck: 5.6, mittagAbz: 1, abzMittag: 11.2, abendAbz: 1, abzAbend: 11.2 });
      Math.abs(sv - 28) < 1e-9 ? pass("Verpflegung inkl. F/M/A-Abzüge") : fail("Verpflegung-Abzüge", sv);
      const svFloor = computeSumVerpf({ tage8: 0, satz8: 14, tage24: 0, satz24: 28, fruehstueckAbz: 10, abzFruehstueck: 100, mittagAbz: 5, abzMittag: 100, abendAbz: 3, abzAbend: 100 });
      svFloor === 0 ? pass("Verpflegung nie negativ") : fail("Verpflegung nie negativ", svFloor);
      setTestOutput(results);
    } catch (e) { setTestOutput([{ name: "Test runner crashed", ok: false, msg: String(e) }]); }
  };

  // ---------- Layout helpers ----------
  const containerPadding = isDesktop(width) ? 56 : isTablet(width) ? 40 : 24;
  const colGap = isDesktop(width) ? 28 : isTablet(width) ? 24 : 20;
  const cols = (desktop, tablet, mobile) => (isDesktop(width) ? `repeat(${desktop}, minmax(0,1fr))` : isTablet(width) ? `repeat(${tablet}, minmax(0,1fr))` : `repeat(${mobile}, minmax(0,1fr))`);

  // ---------- Render ----------
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", paddingInline: containerPadding, paddingBlock: containerPadding, fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"', color: TOKENS.text, background: TOKENS.bgApp, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reisekostenabrechnung</h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={runTests}>🧪 Tests</Button>
          <Button onClick={generatePDF} disabled={busy || !basisOk}>{busy ? "⏳ Erzeuge PDF…" : "⬇️ PDF erzeugen"}</Button>
          <Button variant="secondary" onClick={() => {
            const kw = basis.kw || "XX";
            const mailtoLink = `mailto:rechnungswesen@tritos-consulting.com?subject=${encodeURIComponent(`Reisekosten KW ${kw}`)}&body=${encodeURIComponent("Bitte die PDF-Reisekostenabrechnung im Anhang einfügen.")}`;
            window.location.href = mailtoLink;
          }}>📧 Email</Button>
        </div>
      </div>

      {/* Basisdaten */}
      <Card>
        <CardHeader><CardTitle>Basisdaten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(3, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label htmlFor="name">Name*</Label><Input id="name" required value={basis.name} onChange={(e) => setBasis({ ...basis, name: e.target.value })} /></div>
            <div><Label htmlFor="zweck">Zweck*</Label><Input id="zweck" required placeholder="z.B. Beratung Hallesche" value={basis.zweck} onChange={(e) => setBasis({ ...basis, zweck: e.target.value })} /></div>
            <div>
              <Label htmlFor="kw">Kalenderwoche {basis.kwAuto ? "(automatisch)" : "(manuell)"}</Label>
              <Input id="kw" placeholder="z.B. 27/2025" value={basis.kw} onChange={(e) => setBasis({ ...basis, kw: e.target.value })} disabled={basis.kwAuto} style={{ background: basis.kwAuto ? "#F3F4F6" : "#fff" }} />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <input id="kwAuto" type="checkbox" checked={basis.kwAuto} onChange={(e) => setBasis({ ...basis, kwAuto: e.target.checked })} style={{ width: 16, height: 16 }} />
                <Label htmlFor="kwAuto">KW automatisch aus Beginn-Datum</Label>
              </div>
            </div>
            <div><Label htmlFor="beginn">Beginn*</Label><Input id="beginn" type="date" required value={basis.beginn} onChange={(e) => setBasis({ ...basis, beginn: e.target.value })} /></div>
            <div><Label htmlFor="ende">Ende*</Label><Input id="ende" type="date" required value={basis.ende} onChange={(e) => setBasis({ ...basis, ende: e.target.value })} /></div>
            <div><Label htmlFor="firma">Firma*</Label><Input id="firma" required value={basis.firma} onChange={(e) => setBasis({ ...basis, firma: e.target.value })} /></div>
          </div>
        </CardContent>
      </Card>

      {/* Fahrtkosten */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Fahrtkosten</CardTitle></CardHeader>
        <CardContent>
          <div style={{ display: "grid", gridTemplateColumns: cols(5, 3, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label>Privat-PKW Kennzeichen</Label><Input placeholder="z.B. S-AB 1234" value={fahrt.kennzeichen} onChange={(e) => setFahrt({ ...fahrt, kennzeichen: e.target.value })} /></div>
            <div><Label>Tachostand Beginn</Label><Input inputMode="decimal" placeholder="z.B. 25 300,0" value={fahrt.tachostandBeginn} onChange={(e) => setFahrt({ ...fahrt, tachostandBeginn: e.target.value })} /></div>
            <div><Label>Tachostand Ende</Label><Input inputMode="decimal" placeholder="z.B. 25 420,5" value={fahrt.tachostandEnde} onChange={(e) => setFahrt({ ...fahrt, tachostandEnde: e.target.value })} /></div>
            <div><Label>KM Gesamt</Label><Input inputMode="decimal" placeholder="auto aus Tachostand" value={fahrt.km} onChange={(e) => setFahrt({ ...fahrt, km: e.target.value })} /></div>
            <div><Label>Kilometergeld (0,30 €/km)</Label><Input readOnly value={fmt(kilometergeld)} style={{ background: "#F3F4F6" }} /></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: cols(3, 2, 1), columnGap: colGap, rowGap: 24 }}>
            <div><Label>Deutsche Bahn</Label><Input inputMode="decimal" placeholder="0,00" value={fahrt.bahn} onChange={(e) => setFahrt({ ...fahrt, bahn: e.target.value })} /></div>
            <div><Label>Taxi</Label><Input inputMode="decimal" placeholder="0,00" value={fahrt.taxi} onChange={(e) => setFahrt({ ...fahrt, taxi: e.target.value })} /></div>
            <div><Label>Öffentliche Verkehrsmittel (gesamt)</Label><Input inputMode="decimal" placeholder="0,00" value={fahrt.oev} onChange={(e) => setFahrt({ ...fahrt, oev: e.target.value })} /></div>
          </div>

          <div style={{ fontSize: 12, color: TOKENS.textMut }}>
            Zwischensumme Fahrtkosten: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumFahrt)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Verpflegung (mit ausklappbaren Abzügen) */}
      <div style={{ height: 18 }} />
      <Card>
        <CardHeader><CardTitle>Verpflegungsmehraufwand</CardTitle></CardHeader>
        <
