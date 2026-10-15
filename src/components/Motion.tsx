import { useEffect, useRef, useState, type ReactNode } from 'react'

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Animates the first number inside a formatted string (e.g. "₱2,700,000" or "70%")
 * from its previous value, keeping the original prefix, suffix, grouping and decimals.
 */
export function CountUp({ value, duration = 700 }: { value: string; duration?: number }) {
  const match = value.match(/-?[\d,]*\.?\d+/)
  const target = match ? Number(match[0].replace(/,/g, '')) : NaN
  const decimals = match && match[0].includes('.') ? match[0].split('.')[1].length : 0
  const grouped = match ? match[0].includes(',') : false
  const previous = useRef<number | null>(null)
  const [shown, setShown] = useState<number>(() => prefersReducedMotion() ? target : 0)

  useEffect(() => {
    if (!Number.isFinite(target)) return
    const from = previous.current ?? 0
    previous.current = target
    if (from === target || prefersReducedMotion()) { setShown(target); return }
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      setShown(from + (target - from) * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])

  if (!match || !Number.isFinite(target)) return <>{value}</>
  const formatted = shown.toLocaleString('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped })
  return <>{value.slice(0, match.index)}{formatted}{value.slice((match.index ?? 0) + match[0].length)}</>
}

/** Shimmering placeholder rows shaped like a list of records. */
export function SkeletonRows({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return <div className="skeleton-rows" role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}>
      <i className="skeleton-dot" />
      <span><i className="skeleton-bar is-title" /><i className="skeleton-bar is-sub" /></span>
      <i className="skeleton-bar is-amount" />
    </div>)}
  </div>
}

/** Circular progress ring that fills on mount. */
export function ProgressRing({ value, size = 76, stroke = 7 }: { value: number; size?: number; stroke?: number }) {
  const clamped = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return <span className="progress-ring" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(clamped)}% complete`}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="progress-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} />
      <circle className="progress-ring-fill" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped / 100)} style={{ ['--ring-length' as string]: circumference }} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
    <strong><CountUp value={`${Math.round(clamped)}`} /><small>%</small></strong>
  </span>
}

/** Tiny trend line for metric cards. */
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2 || values.every((item) => item === 0)) return null
  const max = Math.max(...values)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const step = width / (values.length - 1)
  const points = values.map((item, index) => [index * step, height - 3 - (item - min) / span * (height - 6)] as const)
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  const [lastX, lastY] = points[points.length - 1]
  return <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <path className="sparkline-area" d={area} />
    <path className="sparkline-line" d={line} />
    <circle className="sparkline-dot" cx={lastX} cy={lastY} r="2.5" />
  </svg>
}

export type EmptyArtKind = 'blueprint' | 'receipt' | 'clipboard' | 'hardhat' | 'folder' | 'wallet' | 'document'

/** Line illustrations for empty states, drawn in the current text colour. */
export function EmptyArt({ kind }: { kind: EmptyArtKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const art: Record<EmptyArtKind, ReactNode> = {
    blueprint: <><rect x="14" y="14" width="60" height="44" rx="3" {...common} /><path d="M14 22h60M22 30h20v20H22zM48 30h18M48 37h14M48 44h18M42 40h6" {...common} /><circle cx="78" cy="58" r="8" {...common} /><path d="M78 50v-6M84 62l4 4" {...common} /></>,
    receipt: <><path d="M24 10h40v54l-6-4-6 4-6-4-6 4-6-4-6 4-4-3z" {...common} /><path d="M32 22h24M32 30h24M32 38h14" {...common} /><path d="M50 44v12M46 47h8M46 51h8" {...common} /></>,
    clipboard: <><rect x="20" y="14" width="48" height="54" rx="4" {...common} /><rect x="34" y="9" width="20" height="10" rx="3" {...common} /><path d="M28 32l4 4 7-8M45 32h15M28 46l4 4 7-8M45 46h15M45 58h10" {...common} /></>,
    hardhat: <><path d="M16 52h56M20 52c0-15 10-26 24-26s24 11 24 26" {...common} /><path d="M38 27v-6h12v6M44 21v31M30 32l3 20M58 32l-3 20" {...common} /><path d="M12 52h64v6H12z" {...common} /></>,
    folder: <><path d="M12 22a4 4 0 014-4h18l6 6h32a4 4 0 014 4v32a4 4 0 01-4 4H16a4 4 0 01-4-4z" {...common} /><path d="M26 38h36M26 46h28M26 54h20" {...common} /></>,
    wallet: <><rect x="12" y="22" width="64" height="40" rx="6" {...common} /><path d="M18 22l36-10 4 10" {...common} /><rect x="56" y="36" width="20" height="12" rx="4" {...common} /><circle cx="63" cy="42" r="1.6" fill="currentColor" /></>,
    document: <><path d="M26 10h26l14 14v42a2 2 0 01-2 2H26a2 2 0 01-2-2V12a2 2 0 012-2z" {...common} /><path d="M52 10v14h14M32 34h26M32 42h26M32 50h18" {...common} /><path d="M56 56l6 6M58 50a6 6 0 11-8 8" {...common} /></>,
  }
  return <svg className="empty-art" width="88" height="72" viewBox="0 0 88 72" aria-hidden="true">{art[kind]}</svg>
}
