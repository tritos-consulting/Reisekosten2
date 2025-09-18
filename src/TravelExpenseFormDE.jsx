// src/TravelExpenseFormDE.jsx
import React, { useMemo, useRef, useState, useEffect } from "react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

// --------- Design Tokens ----------
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

// --------- Responsive Hook ----------
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

// --------- Minimal UI primitives ---------
const Card = ({ children }) => (
  <div
    style={{
      border: `1px solid ${TOKENS.border}`,
      borderRadius: TOKENS.radius + 4,
      boxShadow: "0 8px 24px rgba(15,23,42,0.06)",
      overflow: "hidden",
      background: TOKENS.bgCard,
    }}
  >
    {children}
  </div>
);

const CardHeader = ({ children }) => (
  <div
    style={{
      padding: 20,
      borderBottom: `1px solid ${TOKENS.border}`,
      background: "#FAFAFA",
    }}
  >
    {children}
  </div>
);

const CardTitle = ({ children }) => (
  <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.2 }}>{children}</div>
);

const CardContent = ({ children }) => (
  <div
    style={{
      paddingInline: 32,
      paddingBlock: 24,
      display: "grid",
      gap: 24,
      boxSizing: "border-box",
    }}
  >
    {children}
  </div>
);

const Button = ({ children, onClick, variant = "primary", style, disabled, title, ariaLabel }) => {
  const base = {
    height: 40,
    padding: "0 14px",
    borderRadius: TOKENS.radius,
    border: "1px solid transparent",
    cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: 0.2,
    transition: "all .15s ease",
  };
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
      onMouseEnter={(e) => {
        if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primaryHover;
      }}
      onMouseLeave={(e) => {
        if (variant === "primary" && !disabled) e.currentTarget.style.background = TOKENS.primary;
      }}
    >
      {children}
    </button>
  );
};

const Input = ({ style, ...props }) => (
  <input
    {...props}
    style={{
      width: "100%",
      height: 34,
      padding: "6px 8px",
      borderRadius: TOKENS.radius,
      border: `1px solid ${TOKENS.border}`,
      outline: "none",
      fontSize: 14,
      background: "#FFFFFF",
      ...style,
    }}
  />
);

const Label = ({ children, htmlFor }) => (
  <label
    htmlFor={htmlFor}
    style={{
      display: "block",
      fontSize: 12,
      fontWeight: 600,
      color: TOKENS.textDim,
      marginBottom: 8,
    }}
  >
    {children}
  </label>
);

// ---------- Helpers ----------
const fmt = (n) => (Number.isFinite(n) ? n : 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
function kmFlatCost(km, rate = 0.30) {
  return Math.max(0, num(km)) * rate;
}

// Summen
const computeSumVerpf = (v) =>
  Math.max(
    0,
    num(v.tage8) * num(v.satz8) +
      num(v.tage24) * num(v.satz24) -
      num(v.fruehstueckAbz) * num(v.abzFruehstueck) -
      num(v.mittagAbz) * num(v.abzMittag) -
      num(v.abendAbz) * num(v.abzAbend)
  );

// --------- Component ----------
export default function TravelExpenseFormDE() {
  const width = useWindowWidth();

  const [verpf, setVerpf] = useState({
    tage8: 0,
    tage24: 0,
    fruehstueckAbz: 0,
    mittagAbz: 0,
    abendAbz: 0,
    satz8: 14,
    satz24: 28,
    abzFruehstueck: 5.6,
    abzMittag: 11.2,
    abzAbend: 11.2,
  });
  const [showDeductions, setShowDeductions] = useState(false);

  const sumVerpf = useMemo(() => computeSumVerpf(verpf), [verpf]);

  const colGap = isDesktop(width) ? 28 : isTablet(width) ? 24 : 20;
  const cols = (d, t, m) =>
    isDesktop(width) ? `repeat(${d}, minmax(0,1fr))` : isTablet(width) ? `repeat(${t}, minmax(0,1fr))` : `repeat(${m}, minmax(0,1fr))`;

  return (
    <Card>
      <CardHeader><CardTitle>Verpflegungsmehraufwand</CardTitle></CardHeader>
      <CardContent>
        {/* Pflichtwerte */}
        <div style={{ display: "grid", gridTemplateColumns: cols(2, 2, 1), columnGap: colGap, rowGap: 24 }}>
          <div>
            <Label>Tage &gt; 8 Std.</Label>
            <Input inputMode="numeric" value={verpf.tage8} onChange={(e) => setVerpf({ ...verpf, tage8: e.target.value })} />
          </div>
          <div>
            <Label>Satz (€/Tag)</Label>
            <Input inputMode="decimal" value={verpf.satz8} onChange={(e) => setVerpf({ ...verpf, satz8: e.target.value })} />
          </div>
          <div>
            <Label>Tage 24 Std.</Label>
            <Input inputMode="numeric" value={verpf.tage24} onChange={(e) => setVerpf({ ...verpf, tage24: e.target.value })} />
          </div>
          <div>
            <Label>Satz (€/Tag)</Label>
            <Input inputMode="decimal" value={verpf.satz24} onChange={(e) => setVerpf({ ...verpf, satz24: e.target.value })} />
          </div>
        </div>

        {/* Toggle für optionale Abzüge */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
          <div style={{ fontSize: 12, color: TOKENS.textMut }}>
            Optional: Abzüge für Frühstück, Mittag- und Abendessen
          </div>
          <Button
            variant="secondary"
            aria-expanded={showDeductions}
            onClick={() => setShowDeductions((s) => !s)}
            style={{ height: 32, padding: "0 10px" }}
          >
            {showDeductions ? "▼ Ausblenden" : "▶ Anzeigen"}
          </Button>
        </div>

        {/* Ausklappbarer Bereich */}
        {showDeductions && (
          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: cols(2, 2, 1), columnGap: colGap, rowGap: 24 }}>
            {/* Frühstück */}
            <div>
              <Label>abzgl. Frühstück (Anzahl)</Label>
              <Input inputMode="numeric" value={verpf.fruehstueckAbz} onChange={(e) => setVerpf({ ...verpf, fruehstueckAbz: e.target.value })} />
            </div>
            <div>
              <Label>Abzug pro Frühstück (€)</Label>
              <Input inputMode="decimal" value={verpf.abzFruehstueck} onChange={(e) => setVerpf({ ...verpf, abzFruehstueck: e.target.value })} />
            </div>

            {/* Mittag */}
            <div>
              <Label>abzgl. Mittagessen (Anzahl)</Label>
              <Input inputMode="numeric" value={verpf.mittagAbz} onChange={(e) => setVerpf({ ...verpf, mittagAbz: e.target.value })} />
            </div>
            <div>
              <Label>Abzug pro Mittagessen (€)</Label>
              <Input inputMode="decimal" value={verpf.abzMittag} onChange={(e) => setVerpf({ ...verpf, abzMittag: e.target.value })} />
            </div>

            {/* Abend */}
            <div>
              <Label>abzgl. Abendessen (Anzahl)</Label>
              <Input inputMode="numeric" value={verpf.abendAbz} onChange={(e) => setVerpf({ ...verpf, abendAbz: e.target.value })} />
            </div>
            <div>
              <Label>Abzug pro Abendessen (€)</Label>
              <Input inputMode="decimal" value={verpf.abzAbend} onChange={(e) => setVerpf({ ...verpf, abzAbend: e.target.value })} />
            </div>
          </div>
        )}

        {/* Summe */}
        <div style={{ fontSize: 12, color: TOKENS.textMut, marginTop: 8 }}>
          Zwischensumme: <span style={{ fontWeight: 600, color: TOKENS.text }}>{fmt(sumVerpf)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
