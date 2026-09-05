import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Appraisal } from "../api/types";
import "./ValueChart.css";

interface Point {
  timestamp: number;
  valueCents: number;
  source: string;
  note: string;
  dateLabel: string;
}

function toPoints(appraisals: Appraisal[]): Point[] {
  return [...appraisals]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((a) => ({
      timestamp: new Date(a.timestamp).getTime(),
      valueCents: a.valueCents,
      source: a.source,
      note: a.note,
      dateLabel: new Date(a.timestamp).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    }));
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="value-chart__tooltip">
      <div className="value-chart__tooltip-value">${(point.valueCents / 100).toFixed(2)}</div>
      <div className="value-chart__tooltip-date">{point.dateLabel}</div>
      <div className="value-chart__tooltip-source">{point.source}</div>
    </div>
  );
}

export function ValueChart({ appraisals }: { appraisals: Appraisal[] }) {
  const points = toPoints(appraisals);

  if (points.length < 2) {
    return (
      <div className="value-chart value-chart--empty">
        <p>Not enough appraisal history yet to chart a trend — record another valuation to see it here.</p>
      </div>
    );
  }

  return (
    <div className="value-chart">
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="valueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(t) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" })}
            stroke="var(--text-muted)"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={{ stroke: "var(--border-strong)" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `$${Math.round(v / 100)}`}
            stroke="var(--text-muted)"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="valueCents"
            stroke="var(--accent)"
            strokeWidth={2}
            fill="url(#valueFill)"
            dot={{ r: 3, fill: "var(--accent)", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "var(--accent)", strokeWidth: 2, stroke: "var(--surface-1)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
