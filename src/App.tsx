import { useEffect, useMemo, useState } from 'react'

type CalcValue =
  | { kind: 'value'; value: number }
  | { kind: 'infinite'; reason: string }
  | { kind: 'undefined'; reason: string }

type Inputs = {
  todayGmv: string
  todaySpend: string
  todayRefundRate: string
  platformRefundRate1h: string
  oneHourGmv: string
  oneHourSpend: string
  targetFeeRate: string
  targetRefundRate: string
  monthGmv: string
  monthSpend: string
  monthRefundRate: string
  monthExpectedRefundRate: string
}

type Scenario = {
  id: string
  name: string
  createdAt: number
  inputs: Inputs
}

const STORAGE_KEY = 'douyin_ecom_calc_scenarios_v1'

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const fixed2Formatter = new Intl.NumberFormat('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function isBlank(s: string) {
  return s.trim().length === 0
}

function parseMoney(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * 解析“百分比/费率”输入为 0~N 的小数：
 * - "10%" / "10" -> 0.1
 * - "0.1" -> 0.1（兼容小数写法）
 */
function parsePercentToRate(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const hasPercent = s.endsWith('%')
  const raw = hasPercent ? s.slice(0, -1).trim() : s
  const n = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  if (hasPercent) return n / 100
  if (n <= 1) return n
  return n / 100
}

function moneyError(input: string, value: number | null): string | null {
  if (isBlank(input)) return null
  if (value === null) return '请输入金额数字（例如：125000）'
  if (value < 0) return '金额不能为负数'
  return null
}

function refundRateError(input: string, rate: number | null): string | null {
  if (isBlank(input)) return null
  if (rate === null) return '请输入百分比（例如：10% 或 10）'
  if (rate < 0) return '退款率不能小于 0%'
  if (rate > 1) return '退款率不能大于 100%'
  return null
}

function feeRateError(input: string, rate: number | null): string | null {
  if (isBlank(input)) return null
  if (rate === null) return '请输入费率（例如：10% 或 10）'
  if (rate < 0) return '费率不能为负数'
  return null
}

function calcDiv(
  numer: number | null,
  denom: number | null,
  opts: { missing: string; denomZero: string; bothZero?: string },
): CalcValue {
  if (numer === null || denom === null) return { kind: 'undefined', reason: opts.missing }
  if (denom === 0) {
    if (numer === 0) return { kind: 'undefined', reason: opts.bothZero ?? '0/0 无定义' }
    return { kind: 'infinite', reason: opts.denomZero }
  }
  return { kind: 'value', value: numer / denom }
}

function formatCalc(
  value: CalcValue,
  fmt: (n: number) => string,
): { text: string; note?: string } {
  if (value.kind === 'value') return { text: fmt(value.value) }
  if (value.kind === 'infinite') return { text: '∞', note: value.reason }
  return { text: '—', note: value.reason }
}

function formatMoney(n: number) {
  return moneyFormatter.format(n)
}

function formatFixed2(n: number) {
  return fixed2Formatter.format(n)
}

function formatPercentFromRate(rate: number) {
  return `${fixed2Formatter.format(rate * 100)}%`
}

function calcNetGmv(gmv: number | null, refundRate: number | null): number | null {
  if (gmv === null || refundRate === null) return null
  return gmv * (1 - refundRate)
}

function safeNowLabel(ts: number) {
  const d = new Date(ts)
  const pad2 = (v: number) => String(v).padStart(2, '0')
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(
    d.getMinutes(),
  )}`
}

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function normalizeInputs(inputs: unknown): Inputs | null {
  if (!inputs || typeof inputs !== 'object') return null
  const obj = inputs as Record<string, unknown>
  const get = (key: keyof Inputs) => (typeof obj[key] === 'string' ? (obj[key] as string) : '')
  return {
    todayGmv: get('todayGmv'),
    todaySpend: get('todaySpend'),
    todayRefundRate: get('todayRefundRate'),
    platformRefundRate1h: get('platformRefundRate1h'),
    oneHourGmv: get('oneHourGmv'),
    oneHourSpend: get('oneHourSpend'),
    targetFeeRate: get('targetFeeRate'),
    targetRefundRate: get('targetRefundRate'),
    monthGmv: get('monthGmv'),
    monthSpend: get('monthSpend'),
    monthRefundRate: get('monthRefundRate'),
    monthExpectedRefundRate: get('monthExpectedRefundRate'),
  }
}

function loadScenarios(): Scenario[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((x) => {
        if (!x || typeof x !== 'object') return null
        const obj = x as Record<string, unknown>
        const id = obj.id
        const name = obj.name
        const createdAt = obj.createdAt
        if (typeof id !== 'string' || typeof name !== 'string' || typeof createdAt !== 'number') return null
        const inputs = normalizeInputs(obj.inputs)
        if (!inputs) return null
        const scenario: Scenario = { id, name, createdAt, inputs }
        return scenario
      })
      .filter((x): x is Scenario => x !== null)
      .slice(0, 100)
  } catch {
    return []
  }
}

function saveScenarios(list: Scenario[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 100)))
  } catch {
    // ignore
  }
}

function Card(props: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-slate-900">{props.title}</h2>
        {props.subtitle ? <p className="mt-1 text-sm text-slate-600">{props.subtitle}</p> : null}
      </header>
      {props.children}
    </section>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  error?: string | null
}) {
  const hasError = Boolean(props.error)
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{props.label}</label>
      <input
        className={[
          'mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none transition',
          hasError
            ? 'border-rose-300 ring-2 ring-rose-100 focus:border-rose-400'
            : 'border-slate-200 focus:border-slate-300 focus:ring-2 focus:ring-slate-100',
        ].join(' ')}
        inputMode="decimal"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error ? <p className="mt-1 text-xs text-rose-600">{props.error}</p> : null}
      {!props.error && props.hint ? <p className="mt-1 text-xs text-slate-500">{props.hint}</p> : null}
    </div>
  )
}

function Metric(props: { label: string; value: { text: string; note?: string } }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="text-xs font-medium text-slate-600">{props.label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{props.value.text}</div>
      {props.value.note ? <div className="mt-1 text-xs text-slate-600">{props.value.note}</div> : null}
    </div>
  )
}

function Button(props: {
  children: React.ReactNode
  onClick: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
}) {
  const variant = props.variant ?? 'primary'
  const cls =
    variant === 'primary'
      ? 'bg-slate-900 text-white hover:bg-slate-800'
      : variant === 'danger'
        ? 'bg-rose-600 text-white hover:bg-rose-700'
        : 'bg-white text-slate-900 hover:bg-slate-50'
  return (
    <button
      type="button"
      className={[
        'inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium transition',
        cls,
        props.disabled ? 'cursor-not-allowed opacity-50 hover:bg-inherit' : '',
      ].join(' ')}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  )
}

function computeQuickMetrics(inputs: Inputs) {
  const todayGmv = parseMoney(inputs.todayGmv)
  const todaySpend = parseMoney(inputs.todaySpend)

  const todayRefundParsed = parsePercentToRate(inputs.todayRefundRate)
  const todayRefundInvalid = refundRateError(inputs.todayRefundRate, todayRefundParsed) !== null
  const todayRefundRate = todayRefundInvalid ? null : todayRefundParsed ?? 0

  const refund1hParsed = parsePercentToRate(inputs.platformRefundRate1h)
  const refund1hInvalid = refundRateError(inputs.platformRefundRate1h, refund1hParsed) !== null
  const refund1hRate = refund1hInvalid ? null : refund1hParsed ?? 0

  const netGmvToday = calcNetGmv(todayGmv, todayRefundRate)
  const feeRateToday = calcDiv(todaySpend, netGmvToday, {
    missing: '缺少成交/消耗/退款率',
    denomZero: '净成交为0',
  })

  const oneHourGmv = parseMoney(inputs.oneHourGmv)
  const oneHourSpend = parseMoney(inputs.oneHourSpend)
  const baseGmv = oneHourGmv !== null && oneHourSpend !== null ? oneHourGmv : todayGmv
  const baseSpend = oneHourGmv !== null && oneHourSpend !== null ? oneHourSpend : todaySpend

  const netGmvBase = calcNetGmv(baseGmv, refund1hRate)
  const netRoiBase = calcDiv(netGmvBase, baseSpend, {
    missing: '缺少数据',
    denomZero: '消耗为0',
  })

  const feeToday = formatCalc(feeRateToday, formatPercentFromRate)
  const netRoi = formatCalc(netRoiBase, formatFixed2)
  return { feeToday, netRoi }
}

export function App() {
  const [todayGmv, setTodayGmv] = useState('')
  const [todaySpend, setTodaySpend] = useState('')
  const [todayRefundRate, setTodayRefundRate] = useState('')

  const [platformRefundRate1h, setPlatformRefundRate1h] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [oneHourGmv, setOneHourGmv] = useState('')
  const [oneHourSpend, setOneHourSpend] = useState('')

  const [targetFeeRate, setTargetFeeRate] = useState('')
  const [targetRefundRate, setTargetRefundRate] = useState('')

  const [monthGmv, setMonthGmv] = useState('')
  const [monthSpend, setMonthSpend] = useState('')
  const [monthRefundRate, setMonthRefundRate] = useState('')
  const [monthAdvancedOpen, setMonthAdvancedOpen] = useState(false)
  const [monthExpectedRefundRate, setMonthExpectedRefundRate] = useState('')

  const [scenarioName, setScenarioName] = useState('')
  const [scenarios, setScenarios] = useState<Scenario[]>([])

  useEffect(() => {
    setScenarios(loadScenarios())
  }, [])

  useEffect(() => {
    saveScenarios(scenarios)
  }, [scenarios])

  const todayGmvNum = parseMoney(todayGmv)
  const todaySpendNum = parseMoney(todaySpend)
  const todayGmvErr = moneyError(todayGmv, todayGmvNum)
  const todaySpendErr = moneyError(todaySpend, todaySpendNum)

  const todayRefundParsed = parsePercentToRate(todayRefundRate)
  const todayRefundErr = refundRateError(todayRefundRate, todayRefundParsed)
  const todayRefundAssumed = isBlank(todayRefundRate)
  const todayRefundForCalc = todayRefundErr ? null : todayRefundParsed ?? 0

  const refund1hParsed = parsePercentToRate(platformRefundRate1h)
  const refund1hErr = refundRateError(platformRefundRate1h, refund1hParsed)
  const refund1hAssumed = isBlank(platformRefundRate1h)
  const refund1hForCalc = refund1hErr ? null : refund1hParsed ?? 0

  const oneHourGmvNum = parseMoney(oneHourGmv)
  const oneHourSpendNum = parseMoney(oneHourSpend)
  const oneHourGmvErr = moneyError(oneHourGmv, oneHourGmvNum)
  const oneHourSpendErr = moneyError(oneHourSpend, oneHourSpendNum)

  const enable1hExact = oneHourGmvNum !== null && oneHourSpendNum !== null && !oneHourGmvErr && !oneHourSpendErr
  const baseGmv = enable1hExact ? oneHourGmvNum : todayGmvErr ? null : todayGmvNum
  const baseSpend = enable1hExact ? oneHourSpendNum : todaySpendErr ? null : todaySpendNum
  const baseModeLabel = enable1hExact ? '近1小时精算（成交/消耗/退款率同窗口）' : '今日累计估算（成交/消耗=今日，退款率=近1小时）'

  const roiGrossToday = calcDiv(todayGmvErr ? null : todayGmvNum, todaySpendErr ? null : todaySpendNum, {
    missing: '请填写成交金额与广告消耗',
    denomZero: '消耗为0',
    bothZero: '成交与消耗均为0（无定义）',
  })

  const netGmvToday = calcNetGmv(todayGmvErr ? null : todayGmvNum, todayRefundForCalc)
  const feeRateToday = calcDiv(todaySpendErr ? null : todaySpendNum, netGmvToday, {
    missing: '请填写成交/消耗/退款率',
    denomZero: '净成交为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })
  const netRoiToday = calcDiv(netGmvToday, todaySpendErr ? null : todaySpendNum, {
    missing: '请填写成交/消耗/退款率',
    denomZero: '消耗为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })

  const netGmvBase = calcNetGmv(baseGmv, refund1hForCalc)
  const netRoiBase = calcDiv(netGmvBase, baseSpend, {
    missing: '请填写成交金额与广告消耗',
    denomZero: '消耗为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })
  const feeRateBase = calcDiv(baseSpend, netGmvBase, {
    missing: '请填写成交金额与广告消耗',
    denomZero: '净成交为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })

  const targetFeeParsed = parsePercentToRate(targetFeeRate)
  const targetFeeErr = feeRateError(targetFeeRate, targetFeeParsed)
  const targetRefundParsed = parsePercentToRate(targetRefundRate)
  const targetRefundErr = refundRateError(targetRefundRate, targetRefundParsed)
  const targetRefundAssumed = isBlank(targetRefundRate)

  const targetFeeForCalc = targetFeeErr ? null : targetFeeParsed
  const targetRefundForCalc = targetRefundErr ? null : targetRefundParsed ?? 0

  const targetNetRoi = calcDiv(1, targetFeeForCalc, {
    missing: '请填写目标费率',
    denomZero: '目标费率为 0%',
  })

  const targetGrossRoi = calcDiv(
    1,
    targetFeeForCalc === null || targetRefundForCalc === null
      ? null
      : targetFeeForCalc * (1 - targetRefundForCalc),
    {
      missing: '请填写目标费率与退款率',
      denomZero: '目标费率为 0% 或 退款率为 100%',
    },
  )

  const monthGmvNum = parseMoney(monthGmv)
  const monthSpendNum = parseMoney(monthSpend)
  const monthGmvErr = moneyError(monthGmv, monthGmvNum)
  const monthSpendErr = moneyError(monthSpend, monthSpendNum)

  const monthRefundParsed = parsePercentToRate(monthRefundRate)
  const monthRefundErr = refundRateError(monthRefundRate, monthRefundParsed)
  const monthRefundAssumed = isBlank(monthRefundRate)
  const monthRefundForCalc = monthRefundErr ? null : monthRefundParsed ?? 0

  const monthExpectedParsed = parsePercentToRate(monthExpectedRefundRate)
  const monthExpectedErr = refundRateError(monthExpectedRefundRate, monthExpectedParsed)
  const monthExpectedForCalc =
    isBlank(monthExpectedRefundRate) ? null : monthExpectedErr ? null : monthExpectedParsed

  const roiGrossMonth = calcDiv(monthGmvErr ? null : monthGmvNum, monthSpendErr ? null : monthSpendNum, {
    missing: '请填写本月成交金额与广告消耗',
    denomZero: '消耗为0',
    bothZero: '成交与消耗均为0（无定义）',
  })

  const netGmvMonth = calcNetGmv(monthGmvErr ? null : monthGmvNum, monthRefundForCalc)
  const feeRateMonth = calcDiv(monthSpendErr ? null : monthSpendNum, netGmvMonth, {
    missing: '请填写本月成交/消耗/退款率',
    denomZero: '净成交为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })
  const netRoiMonth = calcDiv(netGmvMonth, monthSpendErr ? null : monthSpendNum, {
    missing: '请填写本月成交/消耗/退款率',
    denomZero: '消耗为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })

  const netGmvMonthForecast = calcNetGmv(monthGmvErr ? null : monthGmvNum, monthExpectedForCalc)
  const feeRateMonthForecast = calcDiv(monthSpendErr ? null : monthSpendNum, netGmvMonthForecast, {
    missing: '请填写本月成交/消耗与预计最终退款率',
    denomZero: '净成交为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })
  const netRoiMonthForecast = calcDiv(netGmvMonthForecast, monthSpendErr ? null : monthSpendNum, {
    missing: '请填写本月成交/消耗与预计最终退款率',
    denomZero: '消耗为0',
    bothZero: '净成交与消耗均为0（无定义）',
  })

  const diffSummary = useMemo(() => {
    if (todayRefundForCalc === null || refund1hForCalc === null) return null
    const delta = todayRefundForCalc - refund1hForCalc
    const text = `${delta >= 0 ? '+' : ''}${fixed2Formatter.format(delta * 100)}%`
    return { text }
  }, [todayRefundForCalc, refund1hForCalc])

  const handleSaveScenario = () => {
    const name = scenarioName.trim() || `方案 ${scenarios.length + 1}`
    const next: Scenario = {
      id: newId(),
      name,
      createdAt: Date.now(),
      inputs: {
        todayGmv,
        todaySpend,
        todayRefundRate,
        platformRefundRate1h,
        oneHourGmv,
        oneHourSpend,
        targetFeeRate,
        targetRefundRate,
        monthGmv,
        monthSpend,
        monthRefundRate,
        monthExpectedRefundRate,
      },
    }
    setScenarios([next, ...scenarios])
    setScenarioName('')
  }

  const handleLoadScenario = (s: Scenario) => {
    const i = s.inputs
    setTodayGmv(i.todayGmv)
    setTodaySpend(i.todaySpend)
    setTodayRefundRate(i.todayRefundRate)
    setPlatformRefundRate1h(i.platformRefundRate1h)
    setOneHourGmv(i.oneHourGmv)
    setOneHourSpend(i.oneHourSpend)
    setTargetFeeRate(i.targetFeeRate)
    setTargetRefundRate(i.targetRefundRate)
    setMonthGmv(i.monthGmv)
    setMonthSpend(i.monthSpend)
    setMonthRefundRate(i.monthRefundRate)
    setMonthExpectedRefundRate(i.monthExpectedRefundRate)
    setAdvancedOpen(!isBlank(i.oneHourGmv) || !isBlank(i.oneHourSpend))
    setMonthAdvancedOpen(!isBlank(i.monthExpectedRefundRate))
  }

  const handleDeleteScenario = (id: string) => {
    setScenarios(scenarios.filter((x) => x.id !== id))
  }

  const handleClearAll = () => {
    if (!confirm('确定要清空所有已保存方案吗？')) return
    setScenarios([])
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">抖音电商投放计算器</h1>
          <p className="mt-2 text-sm text-slate-600">
            运营口径（今日累计）与投放口径（平台近1小时退款率/净ROI）同屏对齐
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card
            title="实时指标（运营口径｜今日累计）"
            subtitle="输入：成交金额、广告消耗、今日实时退款率 → 输出：退款前ROI、实时费率、净ROI"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="成交金额（元）"
                value={todayGmv}
                onChange={setTodayGmv}
                placeholder="例如：125000"
                error={todayGmvErr}
              />
              <Field
                label="广告消耗（元）"
                value={todaySpend}
                onChange={setTodaySpend}
                placeholder="例如：32000"
                error={todaySpendErr}
              />
              <Field
                label="今日实时退款率（%）"
                value={todayRefundRate}
                onChange={setTodayRefundRate}
                placeholder="例如：10 或 10%"
                error={todayRefundErr}
                hint={todayRefundAssumed ? '未填写将按 0% 计算' : undefined}
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="退款前ROI（成交/消耗）" value={formatCalc(roiGrossToday, formatFixed2)} />
              <Metric label="实时费率（消耗/净成交）" value={formatCalc(feeRateToday, formatPercentFromRate)} />
              <Metric
                label="净ROI（剔除退款后）"
                value={formatCalc(netRoiToday, formatFixed2)}
              />
              <Metric
                label="今日净成交金额（成交*(1-退款率)）"
                value={
                  netGmvToday === null
                    ? { text: '—', note: '请填写成交金额与退款率' }
                    : { text: formatMoney(netGmvToday) }
                }
              />
            </div>
          </Card>

          <Card
            title="投放端对齐（平台近1小时退款率）"
            subtitle="默认：用“今日成交/消耗 + 近1小时退款率”做估算；可选填近1小时成交/消耗做精算"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="平台近1小时退款率（%）"
                value={platformRefundRate1h}
                onChange={setPlatformRefundRate1h}
                placeholder="例如：8 或 8%"
                error={refund1hErr}
                hint={refund1hAssumed ? '未填写将按 0% 计算' : undefined}
              />

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs font-medium text-slate-600">当前模式</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{baseModeLabel}</div>
                {enable1hExact ? null : !isBlank(oneHourGmv) || !isBlank(oneHourSpend) ? (
                  <div className="mt-1 text-xs text-slate-600">提示：要启用精算，需要同时填写近1小时成交与消耗</div>
                ) : null}
              </div>
            </div>

            <div className="mt-3">
              <Button variant="ghost" onClick={() => setAdvancedOpen(!advancedOpen)}>
                {advancedOpen ? '收起高级（近1小时精算）' : '展开高级（可选：近1小时精算）'}
              </Button>
            </div>

            {advancedOpen ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field
                  label="近1小时成交金额（元）"
                  value={oneHourGmv}
                  onChange={setOneHourGmv}
                  placeholder="留空则用今日成交"
                  error={oneHourGmvErr}
                />
                <Field
                  label="近1小时广告消耗（元）"
                  value={oneHourSpend}
                  onChange={setOneHourSpend}
                  placeholder="留空则用今日消耗"
                  error={oneHourSpendErr}
                />
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="净ROI（平台口径/估算）" value={formatCalc(netRoiBase, formatFixed2)} />
              <Metric label="对应费率（=1/净ROI）" value={formatCalc(feeRateBase, formatPercentFromRate)} />
              <Metric
                label="净成交金额（用于投放口径）"
                value={
                  netGmvBase === null
                    ? { text: '—', note: '请填写成交金额与退款率' }
                    : { text: formatMoney(netGmvBase) }
                }
              />
              <Metric
                label="今日退款率 - 近1小时退款率"
                value={diffSummary ? { text: diffSummary.text } : { text: '—', note: '请填写两种退款率' }}
              />
            </div>
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card
            title="目标换算（目标费率 → 预期ROI）"
            subtitle="这里的“预期ROI”是退款前ROI；目标费率口径=消耗/净成交"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="目标费率（%）"
                value={targetFeeRate}
                onChange={setTargetFeeRate}
                placeholder="例如：10 或 10%"
                error={targetFeeErr}
              />
              <Field
                label="退款率（%｜用于目标换算）"
                value={targetRefundRate}
                onChange={setTargetRefundRate}
                placeholder="例如：10 或 10%"
                error={targetRefundErr}
                hint={targetRefundAssumed ? '未填写将按 0% 计算' : undefined}
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setTargetRefundRate(todayRefundRate || '0')}>
                取今日退款率
              </Button>
              <Button variant="ghost" onClick={() => setTargetRefundRate(platformRefundRate1h || '0')}>
                取近1小时退款率
              </Button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="目标净ROI（=1/目标费率）" value={formatCalc(targetNetRoi, formatFixed2)} />
              <Metric
                label="预期退款前ROI（=1/(费率*(1-退款率))）"
                value={formatCalc(targetGrossRoi, formatFixed2)}
              />
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              公式提示：净ROI = 成交*(1-退款率)/消耗；费率 = 消耗/(成交*(1-退款率))；二者互为倒数。
            </div>
          </Card>

          <Card
            title="月度费率（本月累计）"
            subtitle="输入：本月成交、本月消耗、本月退款率（已发生） → 输出：月度费率、净ROI、退款前ROI"
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label="本月成交金额（元）"
                value={monthGmv}
                onChange={setMonthGmv}
                placeholder="例如：980000"
                error={monthGmvErr}
              />
              <Field
                label="本月广告消耗（元）"
                value={monthSpend}
                onChange={setMonthSpend}
                placeholder="例如：210000"
                error={monthSpendErr}
              />
              <Field
                label="本月退款率（%｜已发生）"
                value={monthRefundRate}
                onChange={setMonthRefundRate}
                placeholder="例如：12 或 12%"
                error={monthRefundErr}
                hint={
                  monthRefundAssumed
                    ? '未填写将按 0% 计算；建议口径：本月已退款金额 / 本月成交金额（截至今天）'
                    : '建议口径：本月已退款金额 / 本月成交金额（截至今天）'
                }
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Metric label="月度退款前ROI（成交/消耗）" value={formatCalc(roiGrossMonth, formatFixed2)} />
              <Metric label="月度费率（消耗/净成交）" value={formatCalc(feeRateMonth, formatPercentFromRate)} />
              <Metric label="月度净ROI（剔除退款后）" value={formatCalc(netRoiMonth, formatFixed2)} />
              <Metric
                label="本月净成交金额（成交*(1-退款率)）"
                value={
                  netGmvMonth === null
                    ? { text: '—', note: '请填写本月成交金额与退款率' }
                    : { text: formatMoney(netGmvMonth) }
                }
              />
            </div>

            <div className="mt-3">
              <Button variant="ghost" onClick={() => setMonthAdvancedOpen(!monthAdvancedOpen)}>
                {monthAdvancedOpen ? '收起高级（预计最终退款率）' : '展开高级（可选：预计最终退款率）'}
              </Button>
            </div>

            {monthAdvancedOpen ? (
              <div className="mt-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="预计最终退款率（%｜可选）"
                    value={monthExpectedRefundRate}
                    onChange={setMonthExpectedRefundRate}
                    placeholder="例如：18 或 18%"
                    error={monthExpectedErr}
                    hint="用于月末预估（解决退款延后导致的低估）"
                  />
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Metric
                    label="预计月度费率（按预计最终退款率）"
                    value={formatCalc(feeRateMonthForecast, formatPercentFromRate)}
                  />
                  <Metric
                    label="预计月度净ROI（按预计最终退款率）"
                    value={formatCalc(netRoiMonthForecast, formatFixed2)}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              提示：月度“已发生退款率”适合对账/当前净产出；由于退款会延后，做月末预测更建议用“预计最终退款率”（可取历史成熟退款率，或按成交日归因的 D+7 / D+14 退款率）。
            </div>
          </Card>

          <div className="lg:col-span-2">
            <Card title="方案保存（可选）" subtitle="保存多个输入组合，便于快速对比与回填（仅存本地浏览器）">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Field
                  label="方案名称"
                  value={scenarioName}
                  onChange={setScenarioName}
                  placeholder="例如：12/18 下午场"
                  hint="不填会自动命名：方案 1、方案 2..."
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSaveScenario}>保存当前方案</Button>
                <Button variant="danger" onClick={handleClearAll} disabled={scenarios.length === 0}>
                  清空
                </Button>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
              <div className="grid grid-cols-12 gap-2 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
                <div className="col-span-5">方案</div>
                <div className="col-span-3">今日费率</div>
                <div className="col-span-2">净ROI(投放)</div>
                <div className="col-span-2 text-right">操作</div>
              </div>
              {scenarios.length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-600">暂无已保存方案</div>
              ) : (
                <div className="divide-y divide-slate-200">
                  {scenarios.map((s) => {
                    const m = computeQuickMetrics(s.inputs)
                    return (
                      <div key={s.id} className="grid grid-cols-12 gap-2 px-3 py-3 text-sm">
                        <div className="col-span-5">
                          <div className="font-medium text-slate-900">{s.name}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{safeNowLabel(s.createdAt)}</div>
                        </div>
                        <div className="col-span-3">
                          <div className="font-semibold text-slate-900">{m.feeToday.text}</div>
                          {m.feeToday.note ? (
                            <div className="mt-0.5 text-xs text-slate-500">{m.feeToday.note}</div>
                          ) : null}
                        </div>
                        <div className="col-span-2">
                          <div className="font-semibold text-slate-900">{m.netRoi.text}</div>
                          {m.netRoi.note ? (
                            <div className="mt-0.5 text-xs text-slate-500">{m.netRoi.note}</div>
                          ) : null}
                        </div>
                        <div className="col-span-2 flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => handleLoadScenario(s)}>
                            载入
                          </Button>
                          <Button variant="ghost" onClick={() => handleDeleteScenario(s.id)}>
                            删除
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}


