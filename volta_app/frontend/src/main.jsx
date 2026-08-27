import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleGauge,
  Factory,
  LayoutDashboard,
  Map as MapIcon,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import "./styles.css";

const NAV = [
  { id: "overview", label: "Control Tower", icon: LayoutDashboard },
  { id: "floor", label: "Plant Floor", icon: Factory },
  { id: "hero", label: "LINE-04 Decision", icon: CircleGauge },
];

const EXAMPLE_QUESTIONS = [
  "Why is LINE-0004 trending toward a stop?",
  "Which plant has the highest downtime exposure?",
  "How many lines are currently critical?",
];

const riskColor = (band) =>
  ({ critical: "#ff4d4f", elevated: "#ff9f43", watch: "#ffd166" }[band] || "#34d399");

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const money = (value, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(number(value));

async function request(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Keep the status-based fallback.
    }
    throw new Error(message);
  }
  return response.json();
}

function App() {
  const [active, setActive] = useState("overview");
  const [fleet, setFleet] = useState([]);
  const [summary, setSummary] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [genieOpen, setGenieOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [fleetData, summaryData, recData] = await Promise.all([
        request("/api/fleet"),
        request("/api/summary"),
        request("/api/recommendations/LINE-0004").catch(() => null),
      ]);
      setFleet(fleetData);
      setSummary(summaryData);
      setRecommendation(recData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const hero = fleet.find((line) => line.line_id === "LINE-0004") || fleet[0];

  return (
    <div className="app-shell">
      <Backdrop />
      <aside className="sidebar">
        <div className="powered"><Zap size={15} /> Data + AI on Databricks</div>
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">V</div>
          <div>
            <strong>VOLTA</strong>
            <span>Industrial Intelligence</span>
          </div>
        </div>
        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={active === id ? "active" : ""}
              onClick={() => setActive(id)}
            >
              <Icon size={19} /> {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className="live-dot" />
          <div><strong>Live operations</strong><small>8 plants connected</small></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">Predictive maintenance</span>
            <strong>PLANT FLOOR CONTROL</strong>
          </div>
          <div className="top-actions">
            <span className="timestamp">{new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
            <button className="button ghost" onClick={load} disabled={loading}>
              <RefreshCw size={16} className={loading ? "spin" : ""} /> Refresh
            </button>
            <button className="button primary" onClick={() => setGenieOpen(true)}>
              <Sparkles size={16} /> Ask Genie
            </button>
          </div>
        </header>

        <div className="content">
          {error && <div className="error-banner"><AlertTriangle size={18} /> {error}</div>}
          {loading && !summary ? <Loading /> : (
            <>
              {active === "overview" && <Overview fleet={fleet} summary={summary} hero={hero} setActive={setActive} />}
              {active === "floor" && <PlantFloor fleet={fleet} />}
              {active === "hero" && <Hero line={hero} recommendation={recommendation} openGenie={() => setGenieOpen(true)} />}
            </>
          )}
        </div>
      </main>
      {genieOpen && <GeniePanel onClose={() => setGenieOpen(false)} />}
    </div>
  );
}

function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="grid-lines" />
      <div className="glow glow-one" />
      <div className="glow glow-two" />
    </div>
  );
}

function Loading() {
  return (
    <div className="loading-state">
      <div className="loader"><Factory size={28} /></div>
      <strong>Connecting to the plant floor</strong>
      <span>Loading governed operational data…</span>
    </div>
  );
}

function Overview({ fleet, summary, hero, setActive }) {
  const atRisk = useMemo(
    () => fleet.filter((row) => ["critical", "elevated", "watch"].includes(row.risk_band)),
    [fleet],
  );
  const plants = useMemo(() => {
    const grouped = new Map();
    atRisk.forEach((row) => {
      grouped.set(row.plant_name, (grouped.get(row.plant_name) || 0) + number(row.downtime_exposure_usd));
    });
    return [...grouped.entries()]
      .map(([plant, exposure]) => ({ plant: String(plant).replace("Volta ", ""), exposure }))
      .sort((a, b) => b.exposure - a.exposure)
      .slice(0, 6);
  }, [atRisk]);
  const scatter = fleet.map((row) => ({
    x: number(row.utilization_pct),
    y: number(row.failure_risk_score),
    line: row.line_id,
    band: row.risk_band,
    fill: riskColor(row.risk_band),
  }));

  return (
    <section className="page enter">
      <PageHeading
        kicker="Executive operations"
        title="Stop failures before they stop production."
        copy="Prioritize the lines trending toward failure, quantify the exposure, and act while maintenance is still planned."
      />
      <Kpis summary={summary} />
      <div className="hero-alert glass">
        <div className="alert-icon"><AlertTriangle /></div>
        <div>
          <span className="eyebrow danger">Priority decision</span>
          <h2>{hero?.line_name || "LINE-04"} is trending toward a stop</h2>
          <p>
            Failure risk <strong>{Math.round(number(hero?.failure_risk_score) * 100)}%</strong> ·{" "}
            {money(hero?.downtime_exposure_usd)} exposed · replacement part{" "}
            {String(hero?.part_local).toLowerCase() === "true" ? "available locally" : "not stocked locally"}.
          </p>
        </div>
        <button className="button danger-button" onClick={() => setActive("hero")}>
          Review decision <ArrowRight size={16} />
        </button>
      </div>

      <div className="dashboard-grid">
        <Card title="Risk vs utilization" subtitle="The upper-right cluster needs intervention" icon={Activity} className="wide">
          <div className="chart">
            <RiskScatter data={scatter} />
          </div>
        </Card>
        <Card title="Exposure by plant" subtitle="Downtime value currently at risk" icon={Factory}>
          <div className="chart">
            <ExposureBars data={plants} />
          </div>
        </Card>
      </div>
      <PlantMap fleet={atRisk} />
    </section>
  );
}

function PageHeading({ kicker, title, copy }) {
  return (
    <div className="page-heading">
      <span className="eyebrow">{kicker}</span>
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  );
}

function Kpis({ summary }) {
  const cards = [
    { label: "Lines monitored", value: summary?.totalLines?.toLocaleString(), detail: "Across 8 plants", icon: Activity, tone: "blue" },
    { label: "At-risk lines", value: summary?.atRiskLines?.toLocaleString(), detail: `${summary?.criticalLines || 0} critical`, icon: AlertTriangle, tone: "red" },
    { label: "Downtime exposure", value: money(summary?.downtimeExposureUsd, true), detail: "Avoidable production risk", icon: Zap, tone: "gold" },
    { label: "Open work orders", value: summary?.openWorkOrders?.toLocaleString(), detail: "Corrective maintenance", icon: Wrench, tone: "green" },
  ];
  return (
    <div className="kpi-grid">
      {cards.map(({ icon: Icon, ...card }) => (
        <div className="kpi glass" key={card.label}>
          <div className={`kpi-icon ${card.tone}`}><Icon size={20} /></div>
          <span>{card.label}</span><strong>{card.value || "0"}</strong><small>{card.detail}</small>
        </div>
      ))}
    </div>
  );
}

function Card({ title, subtitle, icon: Icon, children, className = "" }) {
  return (
    <div className={`card glass ${className}`}>
      <div className="card-title">
        <div><Icon size={18} /><span><strong>{title}</strong><small>{subtitle}</small></span></div>
        <Settings2 size={16} />
      </div>
      {children}
    </div>
  );
}

function RiskScatter({ data }) {
  const xTicks = [0, 25, 50, 75, 100];
  const yTicks = [0, .25, .5, .75, 1];
  return (
    <svg className="risk-scatter" viewBox="0 0 620 260" role="img" aria-label="Failure risk versus utilization">
      {xTicks.map((tick) => <g key={`x-${tick}`}><line x1={50 + tick * 5.35} x2={50 + tick * 5.35} y1="16" y2="220" /><text x={50 + tick * 5.35} y="243" textAnchor="middle">{tick}%</text></g>)}
      {yTicks.map((tick) => <g key={`y-${tick}`}><line x1="50" x2="585" y1={220 - tick * 204} y2={220 - tick * 204} /><text x="39" y={224 - tick * 204} textAnchor="end">{Math.round(tick * 100)}%</text></g>)}
      <line className="threshold" x1="50" x2="585" y1={220 - .7 * 204} y2={220 - .7 * 204} />
      <text className="threshold-label" x="580" y={215 - .7 * 204} textAnchor="end">critical threshold</text>
      {data.map((point, index) => (
        <circle key={`${point.line}-${index}`} cx={50 + point.x * 5.35} cy={220 - point.y * 204} r={point.band === "critical" ? 4.5 : 3.2} fill={point.fill} opacity={point.band === "healthy" ? .38 : .76}>
          <title>{point.line}: {Math.round(point.y * 100)}% risk, {point.x.toFixed(1)}% utilization</title>
        </circle>
      ))}
      <text className="axis-label" x="318" y="258" textAnchor="middle">UTILIZATION</text>
    </svg>
  );
}

function ExposureBars({ data }) {
  const max = Math.max(...data.map((row) => row.exposure), 1);
  return (
    <div className="exposure-bars">
      {data.map((row) => (
        <div className="exposure-row" key={row.plant}>
          <span>{row.plant}</span>
          <div><i style={{ width: `${Math.max(3, row.exposure / max * 100)}%` }} /></div>
          <strong>{money(row.exposure, true)}</strong>
        </div>
      ))}
    </div>
  );
}

function PlantMap({ fleet }) {
  const points = fleet
    .map((row) => ({ ...row, latN: number(row.lat), lonN: number(row.lon) }))
    .filter((row) => row.latN >= -90 && row.latN <= 90 && row.lonN >= -180 && row.lonN <= 180);
  const unique = [...new Map(points.map((row) => [row.plant_id, row])).values()];
  return (
    <Card title="Fleet footprint" subtitle={`${unique.length} plants with active risk`} icon={MapIcon}>
      <div className="fleet-map">
        <svg viewBox="0 0 1000 300" role="img" aria-label="Plant risk locations">
          <defs>
            <pattern id="map-grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="1000" height="300" fill="url(#map-grid)" />
          <path className="map-contours" d="M55 92 C125 34 225 42 290 83 C370 135 390 63 486 70 C570 76 607 130 690 112 C786 90 855 110 948 174 M78 218 C180 160 258 205 346 170 C430 137 502 207 582 176 C670 141 756 196 914 224" />
          {unique.map((row) => {
            const x = ((row.lonN + 180) / 360) * 900 + 50;
            const y = ((90 - row.latN) / 180) * 250 + 25;
            const critical = row.risk_band === "critical";
            return (
              <g key={row.plant_id} transform={`translate(${x} ${y})`}>
                <circle r={critical ? 15 : 11} fill={riskColor(row.risk_band)} opacity=".18" className="map-pulse" />
                <circle r={critical ? 6 : 5} fill={riskColor(row.risk_band)} stroke="#fff" strokeWidth="1.5" />
                <title>{row.plant_name}: {row.risk_band}</title>
              </g>
            );
          })}
        </svg>
        <div className="map-legend"><span><i className="critical" /> Critical</span><span><i className="elevated" /> Elevated</span><span><i className="watch" /> Watch</span></div>
      </div>
    </Card>
  );
}

function PlantFloor({ fleet }) {
  const [query, setQuery] = useState("");
  const [band, setBand] = useState("all");
  const rows = fleet.filter((row) => {
    const matchesBand = band === "all" || row.risk_band === band;
    const haystack = `${row.line_id} ${row.line_name} ${row.plant_name} ${row.machine_type}`.toLowerCase();
    return matchesBand && haystack.includes(query.toLowerCase());
  });
  return (
    <section className="page enter">
      <PageHeading kicker="Operations queue" title="Work the at-risk lines." copy="Ranked by downtime exposure so the plant team acts where every minute matters most." />
      <div className="filters glass">
        <div className="search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search line, plant, or machine…" /></div>
        <div className="pills">
          {["all", "critical", "elevated", "watch", "healthy"].map((value) => <button key={value} className={band === value ? "active" : ""} onClick={() => setBand(value)}>{value.replace("_", " ")}</button>)}
        </div>
      </div>
      <div className="table-wrap glass">
        <table>
          <thead><tr><th>Line</th><th>Plant</th><th>Machine</th><th>Risk</th><th>Utilization</th><th>Exposure</th><th>Open WOs</th><th>Part local</th></tr></thead>
          <tbody>{rows.slice(0, 75).map((row) => (
            <tr key={`${row.plant_id}-${row.line_id}`}>
              <td><strong>{row.line_id}</strong><small>{row.line_name}</small></td>
              <td>{row.plant_name}</td><td>{row.machine_type}</td>
              <td><span className={`risk-badge ${row.risk_band}`}>{Math.round(number(row.failure_risk_score) * 100)}% · {row.risk_band}</span></td>
              <td>{number(row.utilization_pct).toFixed(1)}%</td>
              <td className="mono">{money(row.downtime_exposure_usd)}</td>
              <td>{row.open_wo_count}</td>
              <td>{String(row.part_local).toLowerCase() === "true" ? <CheckCircle2 className="ok" size={17} /> : <X className="bad" size={17} />}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div className="empty">No production lines match this view.</div>}
      </div>
    </section>
  );
}

function Hero({ line, recommendation, openGenie }) {
  const ranking = Array.isArray(recommendation?.action_ranking) ? recommendation.action_ranking : [];
  const actions = ranking.length ? ranking : [
    { action: "pull_now", predicted_net_value_usd: recommendation?.predicted_net_value_usd },
    { action: "expedite_parts_and_run", predicted_net_value_usd: 0 },
    { action: "run_to_shift_end", predicted_net_value_usd: 0 },
  ];
  return (
    <section className="page enter">
      <PageHeading kicker="Decision spotlight" title="LINE-04: pull now or keep running?" copy="A governed recommendation combining telemetry, maintenance state, parts availability, and the cost of an unplanned stop." />
      <div className="decision-layout">
        <div className="decision-main glass">
          <div className="decision-score">
            <div className="risk-ring" style={{ "--risk": `${number(line?.failure_risk_score) * 360}deg` }}><span>{Math.round(number(line?.failure_risk_score) * 100)}%</span><small>failure risk</small></div>
            <div><span className="eyebrow danger">Critical intervention</span><h2>Pull the line now</h2><p>The replacement part is not stocked locally. A controlled stop protects more value than gambling on the end of shift.</p></div>
          </div>
          <div className="decision-metrics"><div><span>Exposure</span><strong>{money(line?.downtime_exposure_usd)}</strong></div><div><span>Utilization</span><strong>{number(line?.utilization_pct).toFixed(1)}%</strong></div><div><span>Open work orders</span><strong>{line?.open_wo_count || 0}</strong></div><div><span>Part local</span><strong>No</strong></div></div>
          <button className="button primary large" onClick={openGenie}><Bot size={18} /> Ask Genie to explain the evidence</button>
        </div>
        <div className="action-ranking glass">
          <span className="eyebrow">Ranked actions</span>
          <h3>Best path by predicted value</h3>
          {actions.map((item, index) => {
            const action = item.action || item.actionType || item.action_type || item.name || "action";
            const value = item.predicted_net_value_usd ?? item.estimatedNetValueUsd ?? item.net_value_usd ?? item.value ?? 0;
            return <div className={`action-row ${index === 0 ? "winner" : ""}`} key={`${action}-${index}`}><span className="rank">{index + 1}</span><div><strong>{String(action).replaceAll("_", " ")}</strong><small>{index === 0 ? "Recommended" : "Alternative scenario"}</small></div><b>{money(value)}</b></div>;
          })}
        </div>
      </div>
    </section>
  );
}

function GeniePanel({ onClose }) {
  const [question, setQuestion] = useState(EXAMPLE_QUESTIONS[0]);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const ask = async (text = question) => {
    if (!text.trim() || busy) return;
    setMessages((current) => [...current, { role: "user", text }]);
    setQuestion("");
    setBusy(true);
    try {
      const result = await request("/api/genie", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text }) });
      setMessages((current) => [...current, { role: "assistant", text: result.answer, tables: result.tables }]);
    } catch (err) {
      setMessages((current) => [...current, { role: "error", text: err.message }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="genie-panel">
        <div className="genie-header"><div><span className="genie-icon"><Sparkles size={18} /></span><span><strong>Plant Floor Genie</strong><small>Governed operations analyst</small></span></div><button onClick={onClose}><X /></button></div>
        <div className="genie-body">
          {!messages.length && <div className="genie-welcome"><Bot size={30} /><h3>Ask the governed data</h3><p>Investigate risk, exposure, telemetry, and recommended action across the fleet.</p>{EXAMPLE_QUESTIONS.map((item) => <button key={item} onClick={() => ask(item)}>{item}<ArrowRight size={14} /></button>)}</div>}
          {messages.map((message, index) => <div className={`message ${message.role}`} key={index}><span>{message.role === "user" ? "You" : "Genie"}</span><p>{message.text}</p>{message.tables?.map((table, ti) => <MiniTable table={table} key={ti} />)}</div>)}
          {busy && <div className="thinking"><Sparkles size={16} /> Genie is investigating…</div>}
        </div>
        <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(); }}><textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about a line, plant, or risk…" rows={2} /><button disabled={busy || !question.trim()}><Send size={18} /></button></form>
      </aside>
    </div>
  );
}

function MiniTable({ table }) {
  return <div className="mini-table"><table><thead><tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{table.rows.slice(0, 8).map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{String(v ?? "—")}</td>)}</tr>)}</tbody></table></div>;
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
