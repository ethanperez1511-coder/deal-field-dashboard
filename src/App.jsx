import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from './supabaseClient'

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')
const DETAIL_BASE = 'https://web-production-c0cae.up.railway.app'

const STATUSES = ['Open', 'In U/W', 'Pass', 'Offer Out']
const SORT_OPTIONS = [
  { value: 'date-desc', label: 'Newest first' },
  { value: 'date-asc', label: 'Oldest first' },
  { value: 'revenue-desc', label: 'Revenue ↓' },
  { value: 'revenue-asc', label: 'Revenue ↑' },
  { value: 'name-asc', label: 'Name A-Z' },
]

const STATUS_CONFIG = {
  Open:        { bg: 'var(--status-open-bg)',  text: 'var(--status-open-text)',  dot: 'var(--status-open-dot)',  accent: '#10B981' },
  'In U/W':    { bg: 'var(--status-uw-bg)',    text: 'var(--status-uw-text)',    dot: 'var(--status-uw-dot)',    accent: '#F59E0B' },
  Pass:        { bg: 'var(--status-pass-bg)',   text: 'var(--status-pass-text)',  dot: 'var(--status-pass-dot)', accent: '#EF4444' },
  'Offer Out': { bg: 'var(--status-offer-bg)',  text: 'var(--status-offer-text)', dot: 'var(--status-offer-dot)', accent: '#3B82F6' },
}

function formatCurrency(amount) {
  if (!amount) return '—'
  return '$' + amount.toLocaleString('en-US')
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((today - d) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isToday(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return d.getTime() === today.getTime()
}

function StatCard({ label, color, count, total, delay }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="stat-card rounded-xl bg-white px-5 py-4 border" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="stat-count text-2xl font-bold tracking-tight" style={{ fontVariantNumeric: 'tabular-nums', animationDelay: `${delay}ms` }}>
          {count}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full" style={{ backgroundColor: `${color}15` }}>
        <div className="stat-bar h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color, animationDelay: `${delay + 200}ms` }} />
      </div>
    </div>
  )
}

function DealCard({ deal, onStatusChange, onNotesChange, onDelete, index, selected, onSelect }) {
  const cfg = STATUS_CONFIG[deal.status] || STATUS_CONFIG.Open
  const [flashing, setFlashing] = useState(false)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState(deal.notes || '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const notesRef = useRef(null)

  const prefetch = () => {
    if (!deal.detailUrl) return
    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.href = deal.detailUrl
    if (!document.head.querySelector(`link[href="${deal.detailUrl}"]`)) {
      document.head.appendChild(link)
    }
  }

  const handleStatusChange = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onStatusChange(deal.id, e.target.value)
    setFlashing(true)
    setTimeout(() => setFlashing(false), 400)
  }

  const saveNotes = () => {
    onNotesChange(deal.id, notesDraft)
    setEditingNotes(false)
  }

  const todayDeal = isToday(deal.date)

  return (
    <div
      className={`deal-card block rounded-xl border bg-white p-5 transition-all duration-200 ${selected ? 'ring-2 ring-blue-400' : ''}`}
      style={{
        borderColor: selected ? 'var(--accent)' : 'var(--border)',
        animationDelay: `${index * 50}ms`,
        '--card-accent': cfg.accent,
      }}
      onMouseEnter={prefetch}
    >
      {/* Top row: checkbox + name + status */}
      <div className="flex items-start gap-3 mb-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(deal.id)}
          className="mt-1 shrink-0 cursor-pointer accent-blue-500"
          onClick={(e) => e.stopPropagation()}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {deal.detailUrl ? (
              <a
                href={deal.detailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="deal-link text-sm font-semibold leading-snug truncate hover:underline"
                style={{ color: 'var(--text-primary)' }}
              >
                {deal.name}
              </a>
            ) : (
              <div className="text-sm font-semibold leading-snug truncate" style={{ color: 'var(--text-primary)' }}>
                {deal.name}
              </div>
            )}
            {todayDeal && (
              <span className="new-badge shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                style={{ backgroundColor: 'var(--status-open-bg)', color: 'var(--status-open-text)' }}>
                New
              </span>
            )}
          </div>
          <div className="mt-1 text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
            {deal.broker}
          </div>
        </div>
        <select
          value={deal.status}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={handleStatusChange}
          className={`status-select shrink-0 rounded-lg px-2.5 py-1 text-xs font-semibold ${flashing ? 'status-changed' : ''}`}
          style={{ backgroundColor: cfg.bg, color: cfg.text }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Revenue */}
      <div className="mb-4">
        <span className="font-mono text-xl font-medium tracking-tight" style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(deal.trueRevenue)}
        </span>
      </div>

      {/* Notes */}
      <div className="mb-3">
        {editingNotes ? (
          <div className="flex gap-1">
            <input
              ref={notesRef}
              autoFocus
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveNotes(); if (e.key === 'Escape') setEditingNotes(false) }}
              placeholder="Add a note..."
              className="flex-1 rounded-md border px-2 py-1 text-xs outline-none focus:border-blue-400"
              style={{ borderColor: 'var(--border)' }}
              onClick={(e) => e.stopPropagation()}
            />
            <button onClick={saveNotes} className="rounded-md px-2 py-1 text-xs font-medium text-white" style={{ backgroundColor: 'var(--accent)' }}>
              Save
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); setNotesDraft(deal.notes || ''); setEditingNotes(true) }}
            className="w-full text-left rounded-md px-2 py-1 text-xs transition-colors hover:bg-gray-50"
            style={{ color: deal.notes ? 'var(--text-secondary)' : 'var(--text-muted)' }}
          >
            {deal.notes || '+ Add note'}
          </button>
        )}
      </div>

      {/* Footer: Meta + Delete */}
      <div className="flex items-center gap-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        {deal.state && (
          <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
            {deal.state}
          </span>
        )}
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {formatDate(deal.date)}
        </span>
        <span className="ml-auto">
          {confirmDelete ? (
            <span className="flex items-center gap-1">
              <button onClick={() => { onDelete(deal.id); setConfirmDelete(false) }} className="rounded px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 hover:bg-red-600">
                Confirm
              </button>
              <button onClick={() => setConfirmDelete(false)} className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
              className="rounded p-1 text-xs transition-colors hover:bg-red-50 hover:text-red-500"
              style={{ color: 'var(--text-muted)' }}
              title="Delete deal"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M5.3 4V2.7a1.3 1.3 0 011.4-1.4h2.6a1.3 1.3 0 011.4 1.4V4m2 0v9.3a1.3 1.3 0 01-1.4 1.4H4.7a1.3 1.3 0 01-1.4-1.4V4" />
              </svg>
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

export default function App() {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('date-desc')
  const [selected, setSelected] = useState(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const prevCountRef = useRef(0)
  const [newDealFlash, setNewDealFlash] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [secondsAgo, setSecondsAgo] = useState(0)

  const fetchDeals = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/deals`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      if (prevCountRef.current > 0 && data.length > prevCountRef.current) {
        setNewDealFlash(true)
        setTimeout(() => setNewDealFlash(false), 2000)
      }
      prevCountRef.current = data.length
      setDeals(data)
      setError(null)
      setLastRefresh(Date.now())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll every 30s + refresh on tab focus + tick "last refreshed" counter
  useEffect(() => {
    fetchDeals()
    const interval = setInterval(fetchDeals, 30_000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchDeals()
    }
    document.addEventListener('visibilitychange', onVisible)

    const onFocus = () => fetchDeals()
    window.addEventListener('focus', onFocus)

    // Update "X seconds ago" display every 10s
    const ticker = setInterval(() => {
      setLastRefresh(prev => {
        if (prev) setSecondsAgo(Math.round((Date.now() - prev) / 1000))
        return prev
      })
    }, 10_000)

    return () => {
      clearInterval(interval)
      clearInterval(ticker)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchDeals])

  const updateStatus = useCallback(async (dealId, newStatus) => {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, status: newStatus } : d))
    try {
      await fetch(`${API_URL}/api/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
    } catch (err) {
      console.error('Status update failed:', err)
      fetchDeals()
    }
  }, [fetchDeals])

  const updateNotes = useCallback(async (dealId, notes) => {
    setDeals(prev => prev.map(d => d.id === dealId ? { ...d, notes } : d))
    try {
      await fetch(`${API_URL}/api/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
    } catch (err) {
      console.error('Notes update failed:', err)
      fetchDeals()
    }
  }, [fetchDeals])

  const deleteDeal = useCallback(async (dealId) => {
    setDeals(prev => prev.filter(d => d.id !== dealId))
    setSelected(prev => { const n = new Set(prev); n.delete(dealId); return n })
    try {
      await fetch(`${API_URL}/api/deals/${dealId}`, { method: 'DELETE' })
    } catch (err) {
      console.error('Delete failed:', err)
      fetchDeals()
    }
  }, [fetchDeals])

  const bulkUpdateStatus = useCallback(async () => {
    if (!bulkStatus || selected.size === 0) return
    const ids = [...selected]
    setDeals(prev => prev.map(d => ids.includes(d.id) ? { ...d, status: bulkStatus } : d))
    setSelected(new Set())
    setBulkStatus('')
    try {
      await fetch(`${API_URL}/api/deals/bulk/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status: bulkStatus }),
      })
    } catch (err) {
      console.error('Bulk update failed:', err)
      fetchDeals()
    }
  }, [bulkStatus, selected, fetchDeals])

  const toggleSelect = (id) => {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // Keep Railway app warm
  useEffect(() => {
    fetch(DETAIL_BASE, { mode: 'no-cors' }).catch(() => {})
    const warmup = setInterval(() => {
      fetch(DETAIL_BASE, { mode: 'no-cors' }).catch(() => {})
    }, 2 * 60 * 1000)
    return () => clearInterval(warmup)
  }, [])

  // Status counts
  const counts = {}
  for (const s of STATUSES) counts[s] = 0
  for (const d of deals) {
    if (counts[d.status] !== undefined) counts[d.status]++
  }

  // Filter + search
  let filtered = filter === 'All' ? deals : deals.filter(d => d.status === filter)
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(d =>
      d.name?.toLowerCase().includes(q) ||
      d.broker?.toLowerCase().includes(q) ||
      d.notes?.toLowerCase().includes(q)
    )
  }

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'date-asc': return (a.receivedAt || a.date).localeCompare(b.receivedAt || b.date)
      case 'revenue-desc': return (b.trueRevenue || 0) - (a.trueRevenue || 0)
      case 'revenue-asc': return (a.trueRevenue || 0) - (b.trueRevenue || 0)
      case 'name-asc': return (a.name || '').localeCompare(b.name || '')
      default: return (b.receivedAt || b.date).localeCompare(a.receivedAt || a.date)
    }
  })

  // Group by date (only for date sorts)
  const useGroups = sort === 'date-desc' || sort === 'date-asc'
  const grouped = {}
  if (useGroups) {
    for (const deal of sorted) {
      if (!grouped[deal.date]) grouped[deal.date] = []
      grouped[deal.date].push(deal)
    }
  }
  const sortedDays = useGroups ? Object.keys(grouped).sort((a, b) => sort === 'date-asc' ? a.localeCompare(b) : b.localeCompare(a)) : []

  const selectAllVisible = () => {
    const ids = sorted.map(d => d.id)
    setSelected(prev => {
      const allSelected = ids.every(id => prev.has(id))
      if (allSelected) return new Set()
      return new Set(ids)
    })
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="header-alive border-b px-8 py-6" style={{ borderColor: '#C8D9F0' }}>
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-lg font-bold tracking-tight" style={{ color: '#1E3A5F' }}>
                Fairmont
                <span className="ml-2 font-normal" style={{ color: '#5B7FA6' }}>Deals Pipeline</span>
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {error && (
                <span className="flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-600">
                  <span className="block h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  Offline
                </span>
              )}
              {!error && !loading && (
                <span className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: 'rgba(16,185,129,0.1)', color: '#047857' }}>
                  <span className="live-dot block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Live
                </span>
              )}
              <span className="text-sm tabular-nums transition-all duration-300" style={{ color: newDealFlash ? '#047857' : '#5B7FA6' }}>
                {deals.length} deal{deals.length !== 1 ? 's' : ''}
                {newDealFlash && ' ✦'}
              </span>
              {lastRefresh && (
                <span className="text-[10px] tabular-nums" style={{ color: '#9CA3AF' }}>
                  {secondsAgo < 10 ? 'just now' : secondsAgo < 60 ? `${secondsAgo}s ago` : `${Math.round(secondsAgo / 60)}m ago`}
                </span>
              )}
              <button
                onClick={() => supabase.auth.signOut()}
                className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/50"
                style={{ color: '#5B7FA6' }}
              >
                Sign out
              </button>
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {STATUSES.map((s, i) => (
              <StatCard key={s} label={s} color={STATUS_CONFIG[s].dot} count={counts[s]} total={deals.length} delay={i * 100} />
            ))}
          </div>
        </div>
      </header>

      {/* Toolbar: filters + search + sort */}
      <div className="border-b bg-white px-8 py-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mx-auto max-w-7xl flex flex-wrap items-center gap-3">
          {/* Filter tabs */}
          <div className="flex gap-1 overflow-x-auto">
            {['All', ...STATUSES].map((s) => {
              const isActive = filter === s
              return (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`filter-tab shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${isActive ? 'active' : ''}`}
                  style={{
                    backgroundColor: isActive ? 'var(--accent)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--text-secondary)',
                  }}
                >
                  {s}
                  {s !== 'All' && <span className="ml-1 tabular-nums opacity-70">{counts[s]}</span>}
                </button>
              )
            })}
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="7" cy="7" r="5" />
              <path d="M14 14l-3.5-3.5" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search deals..."
              className="rounded-lg border py-1.5 pl-8 pr-3 text-xs outline-none transition-colors focus:border-blue-400"
              style={{ borderColor: 'var(--border)', width: 200 }}
            />
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs outline-none cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="border-b px-8 py-2" style={{ backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }}>
          <div className="mx-auto max-w-7xl flex items-center gap-3">
            <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
              {selected.size} selected
            </span>
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              className="rounded-lg border px-2 py-1 text-xs outline-none"
              style={{ borderColor: '#BFDBFE' }}
            >
              <option value="">Change status to...</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {bulkStatus && (
              <button onClick={bulkUpdateStatus} className="rounded-lg px-3 py-1 text-xs font-medium text-white" style={{ backgroundColor: 'var(--accent)' }}>
                Apply
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="mx-auto max-w-7xl px-8 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 rounded-full border-2 border-gray-200 border-t-gray-600 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {deals.length === 0 ? 'No deals yet. Waiting for emails…' : 'No deals match this filter.'}
            </p>
          </div>
        ) : useGroups ? (
          <div className="space-y-10">
            {/* Select all */}
            <div className="flex items-center gap-2">
              <input type="checkbox" onChange={selectAllVisible} checked={sorted.length > 0 && sorted.every(d => selected.has(d.id))} className="cursor-pointer accent-blue-500" />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Select all ({sorted.length})</span>
            </div>
            {sortedDays.map((day) => (
              <section key={day}>
                <div className="date-label mb-4 flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                    {formatDate(day)}
                  </span>
                  <span className="flex-1 border-t" style={{ borderColor: 'var(--border)' }} />
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {grouped[day].length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {grouped[day].map((deal, i) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onStatusChange={updateStatus}
                      onNotesChange={updateNotes}
                      onDelete={deleteDeal}
                      index={i}
                      selected={selected.has(deal.id)}
                      onSelect={toggleSelect}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-6">
              <input type="checkbox" onChange={selectAllVisible} checked={sorted.length > 0 && sorted.every(d => selected.has(d.id))} className="cursor-pointer accent-blue-500" />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Select all ({sorted.length})</span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sorted.map((deal, i) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  onStatusChange={updateStatus}
                  onNotesChange={updateNotes}
                  onDelete={deleteDeal}
                  index={i}
                  selected={selected.has(deal.id)}
                  onSelect={toggleSelect}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
