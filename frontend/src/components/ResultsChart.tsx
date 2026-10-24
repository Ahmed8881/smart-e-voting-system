import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { CandidateResult } from './Results.tsx'

// One series, compared by size: a single hue. Text stays in ink colours, not the bar colour.
const BAR = '#047857' // emerald-700, 5.5:1 on white
const INK_MUTED = '#4b5563' // gray-600

/** Votes per candidate as horizontal bars, highest first. Decorative: the table is the data. */
export default function ResultsChart({ results }: { results: CandidateResult[] }) {
  const height = Math.max(120, results.length * 44 + 24)
  return (
    <div aria-hidden="true" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={results}
          layout="vertical"
          accessibilityLayer={false}
          margin={{ top: 0, right: 64, bottom: 0, left: 0 }}
        >
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tickLine={false}
            axisLine={false}
            tick={{ fill: INK_MUTED, fontSize: 14 }}
          />
          <Tooltip
            cursor={{ fill: '#f3f4f6' }}
            formatter={(value, _name, item) => [
              `${value} votes (${item.payload.percent}%)`,
              item.payload.party,
            ]}
          />
          <Bar
            dataKey="votes"
            fill={BAR}
            radius={[0, 4, 4, 0]}
            barSize={20}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="percent"
              position="right"
              formatter={(v) => `${v}%`}
              style={{ fill: INK_MUTED, fontSize: 13 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
