import 'dotenv/config'
import express from 'express'
import { ConfidentialClientApplication } from '@azure/msal-node'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { PDFParse } from 'pdf-parse'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ngovbsarkjthevktgkrc.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nb3Zic2Fya2p0aGV2a3Rna3JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NTM4ODEsImV4cCI6MjA5NDEyOTg4MX0.hre1Vvn9Oym2jEca9TefwJ3Rq0aH54rZCW-Opu4A3og'
const DETAIL_BASE_URL = 'https://web-production-c0cae.up.railway.app'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ATTACHMENTS_DIR = path.join(__dirname, '..', 'attachments')

// Ensure attachments dir exists
if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true })

// MSAL setup
const msalConfig = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
}
const cca = new ConfidentialClientApplication(msalConfig)

async function getToken() {
  const result = await cca.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  })
  return result.accessToken
}

async function graphGet(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Graph API ${res.status}: ${text}`)
  }
  return res.json()
}

async function graphGetBuffer(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Graph API ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

// Clean deal name
function cleanDealName(name) {
  if (!name) return name
  return name
    .replace(/^(?:Fwd|FW|Re):\s*/gi, '')
    .replace(/\s*DBA\s*Name:\s*/gi, '')
    .trim()
}

// Extract deal info from PDF text
function extractDealInfo(text) {
  const info = {}

  const namePatterns = [
    /(?:business\s*name|company\s*name|legal\s*name|dba|doing\s*business\s*as)[:\s]+([^\n]+)/i,
    /(?:applicant|merchant)[:\s]+([^\n]+)/i,
  ]
  for (const p of namePatterns) {
    const m = text.match(p)
    if (m) { info.name = m[1].trim(); break }
  }

  const revPatterns = [
    /(?:amount\s*requested|funding\s*amount|loan\s*amount|advance\s*amount)[:\s]*\$?([\d,]+)/i,
    /(?:revenue|gross\s*revenue|annual\s*revenue)[:\s]*\$?([\d,]+)/i,
  ]
  for (const p of revPatterns) {
    const m = text.match(p)
    if (m) { info.revenue = parseInt(m[1].replace(/,/g, ''), 10); break }
  }

  const holdbackPatterns = [
    /(?:holdback|hold\s*back)[:\s]*([\d.]+)\s*%/i,
    /(?:factor\s*rate)[:\s]*([\d.]+)/i,
  ]
  for (const p of holdbackPatterns) {
    const m = text.match(p)
    if (m) {
      const val = parseFloat(m[1])
      info.holdback = val > 1 ? val / 100 : val
      break
    }
  }

  const brokerPatterns = [
    /(?:broker|iso|referral\s*partner|submitted\s*by)[:\s]+([^\n]+)/i,
  ]
  for (const p of brokerPatterns) {
    const m = text.match(p)
    if (m) { info.broker = m[1].trim(); break }
  }

  const US_STATES = new Set([
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC',
  ])
  const statePatterns = [
    /(?:state|state\/province|st)[:\s]+([A-Z]{2})\b/i,
    /[A-Za-z]+[,\s]+([A-Z]{2})\s+\d{5}/,
    /[A-Za-z]+[,]\s*([A-Z]{2})\s*$/m,
  ]
  for (const p of statePatterns) {
    const m = text.match(p)
    if (m) {
      const candidate = m[1].toUpperCase()
      if (US_STATES.has(candidate)) { info.state = candidate; break }
    }
  }

  return info
}

// Load deals from Supabase — single source of truth
async function loadDeals() {
  const { data, error } = await supabase
    .from('deals')
    .select('id,email_id,business_name,dba,broker_name,true_revenue_avg,avg_holdback_pct,state,subject,from_address,received_at,dashboard_status,dashboard_notes')
    .neq('dashboard_status', 'Deleted')
    .order('received_at', { ascending: false })
  if (error) {
    console.error('loadDeals failed:', error.message)
    return []
  }
  return data.map(row => ({
    id: row.id,
    emailId: row.email_id,
    supabaseId: row.id,
    name: cleanDealName(row.dba || row.business_name || row.subject) || 'Unknown Business',
    broker: row.broker_name || row.from_address || 'Unknown',
    trueRevenue: Math.round(row.true_revenue_avg || 0),
    holdback: row.avg_holdback_pct != null ? row.avg_holdback_pct / 100 : 0,
    status: row.dashboard_status || 'Open',
    date: row.received_at?.split('T')[0] || new Date().toISOString().split('T')[0],
    receivedAt: row.received_at || new Date().toISOString(),
    detailUrl: `${DETAIL_BASE_URL}/?deal_id=${row.id}`,
    state: row.state || null,
    notes: row.dashboard_notes || '',
    emailSubject: row.subject,
  }))
}

async function fetchInboxDeals() {
  // Get already-processed email IDs from Supabase
  const { data: existing } = await supabase
    .from('deals')
    .select('email_id')
  const processedIds = new Set((existing || []).map(d => d.email_id).filter(Boolean))

  let token
  try {
    token = await getToken()
  } catch (err) {
    console.error('Auth failed:', err.message)
    return
  }

  const user = process.env.OUTLOOK_USER
  const messagesUrl = `https://graph.microsoft.com/v1.0/users/${user}/mailFolders/Inbox/messages?$top=50&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,hasAttachments`

  let messages
  try {
    messages = await graphGet(messagesUrl, token)
  } catch (err) {
    console.error('Failed to fetch messages:', err.message)
    return
  }

  let newCount = 0
  for (const msg of messages.value) {
    if (processedIds.has(msg.id)) continue
    if (!msg.hasAttachments) continue

    // Get attachments
    const attUrl = `https://graph.microsoft.com/v1.0/users/${user}/messages/${msg.id}/attachments`
    let attachments
    try {
      attachments = await graphGet(attUrl, token)
    } catch (err) {
      console.error(`Failed to get attachments for ${msg.id}:`, err.message)
      continue
    }

    const pdfAttachments = attachments.value.filter(
      a => a.contentType === 'application/pdf' || a.name?.endsWith('.pdf')
    )
    if (pdfAttachments.length === 0) continue

    // Save PDFs and extract info from first PDF
    const emailDir = path.join(ATTACHMENTS_DIR, msg.id.substring(0, 40))
    if (!fs.existsSync(emailDir)) fs.mkdirSync(emailDir, { recursive: true })

    let dealInfo = {}
    for (let i = 0; i < pdfAttachments.length; i++) {
      const att = pdfAttachments[i]
      const filePath = path.join(emailDir, att.name)

      let buf
      if (att.contentBytes) {
        buf = Buffer.from(att.contentBytes, 'base64')
      } else {
        const contentUrl = `https://graph.microsoft.com/v1.0/users/${user}/messages/${msg.id}/attachments/${att.id}/$value`
        buf = await graphGetBuffer(contentUrl, token)
      }
      fs.writeFileSync(filePath, buf)

      if (i === 0) {
        try {
          const parser = new PDFParse({ data: new Uint8Array(buf) })
          await parser.load()
          const textResult = await parser.getText()
          const allText = textResult.pages?.map(p => p.text).join('\n') || ''
          dealInfo = extractDealInfo(allText)
        } catch (err) {
          console.error(`PDF parse failed for ${att.name}:`, err.message)
        }
      }
    }

    // Check if this email already has a Supabase row (created by extraction service)
    const { data: existingDeal } = await supabase
      .from('deals')
      .select('id')
      .eq('email_id', msg.id)
      .maybeSingle()

    if (existingDeal) {
      // Row exists from extraction service — just ensure dashboard_status is set
      await supabase
        .from('deals')
        .update({ dashboard_status: 'Open' })
        .eq('id', existingDeal.id)
        .is('dashboard_status', null)
    } else {
      // No row yet — insert minimal row so dashboard can track it
      const { error: insertErr } = await supabase
        .from('deals')
        .insert({
          email_id: msg.id,
          subject: msg.subject,
          from_address: msg.from?.emailAddress?.address || '',
          broker_name: dealInfo.broker || msg.from?.emailAddress?.name || 'Unknown',
          business_name: dealInfo.name || null,
          state: dealInfo.state || null,
          received_at: msg.receivedDateTime || new Date().toISOString(),
          status: 'New',
          dashboard_status: 'Open',
        })
      if (insertErr) {
        console.error(`Insert failed for ${msg.id}:`, insertErr.message)
        continue
      }
    }

    newCount++
    const dealName = dealInfo.name || msg.subject
    console.log(`New deal: ${dealName} (${pdfAttachments.length} PDFs)`)
  }

  if (newCount > 0) {
    console.log(`Added ${newCount} new deal(s)`)
  }
}

// Health tracking
const health = {
  startedAt: new Date().toISOString(),
  lastFetchAttempt: null,
  lastFetchSuccess: null,
  lastFetchError: null,
  fetchCount: 0,
  errorCount: 0,
}

// Express server
const app = express()
app.use(express.json())

// CORS
const ALLOWED_ORIGINS = ['https://deal-field-dashboard.vercel.app', 'https://courageous-ambition-production-df45.up.railway.app', 'http://localhost:5173']
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin)
  }
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

// Get all deals
app.get('/api/deals', async (req, res) => {
  res.json(await loadDeals())
})

// Update deal (status, notes)
app.patch('/api/deals/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const updates = {}
  if (req.body.status) updates.dashboard_status = req.body.status
  if (req.body.notes !== undefined) updates.dashboard_notes = req.body.notes

  const { data, error } = await supabase
    .from('deals')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(404).json({ error: 'Not found' })
  res.json({ id: data.id, status: data.dashboard_status, notes: data.dashboard_notes })
})

// Bulk status update
app.patch('/api/deals/bulk/status', async (req, res) => {
  const { ids, status } = req.body
  if (!ids || !status) return res.status(400).json({ error: 'ids and status required' })

  const { count, error } = await supabase
    .from('deals')
    .update({ dashboard_status: status })
    .in('id', ids)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ updated: count || ids.length })
})

// Delete deal (soft-delete — set dashboard_status to Deleted so extraction service row stays)
app.delete('/api/deals/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10)
  const { error } = await supabase
    .from('deals')
    .update({ dashboard_status: 'Deleted' })
    .eq('id', id)

  if (error) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

// Health endpoint
app.get('/api/health', async (req, res) => {
  const now = new Date()
  const lastFetch = health.lastFetchSuccess ? new Date(health.lastFetchSuccess) : null
  const fetchAgeMs = lastFetch ? now - lastFetch : null

  const issues = []
  if (!lastFetch) issues.push('Never fetched successfully')
  else if (fetchAgeMs > 5 * 60 * 1000) issues.push(`Last fetch ${Math.round(fetchAgeMs / 60000)}m ago`)

  const deals = await loadDeals()
  const ok = issues.length === 0
  res.status(ok ? 200 : 503).json({
    status: ok ? 'healthy' : 'degraded',
    issues,
    uptime: Math.round((now - new Date(health.startedAt)) / 1000),
    ...health,
    dealCount: deals.length,
  })
})

// Manual trigger
app.post('/api/fetch-deals', async (req, res) => {
  await fetchInboxDeals()
  res.json(await loadDeals())
})

// Wrapped version that never throws — keeps setInterval alive
async function safeFetchInboxDeals() {
  health.lastFetchAttempt = new Date().toISOString()
  try {
    await fetchInboxDeals()
    health.lastFetchSuccess = new Date().toISOString()
    health.fetchCount++
    health.lastFetchError = null
    const deals = await loadDeals()
    console.log(`[heartbeat] fetch OK — ${deals.length} deals`)
  } catch (err) {
    health.lastFetchError = err.message
    health.errorCount++
    console.error(`[heartbeat] fetch FAILED:`, err.message)
  }
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Deal server running on http://localhost:${PORT}`)

  // Initial fetch
  safeFetchInboxDeals()

  // Poll inbox every 2 minutes
  setInterval(safeFetchInboxDeals, 2 * 60 * 1000)

  // Self-ping keepalive — prevents Railway from sleeping
  const SELF_URL = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${PORT}`
  setInterval(() => {
    fetch(`${SELF_URL}/api/health`).catch(() => {})
  }, 4 * 60 * 1000)

  // Heartbeat log every 5 minutes
  setInterval(async () => {
    const uptime = Math.round((Date.now() - new Date(health.startedAt).getTime()) / 60000)
    const deals = await loadDeals()
    console.log(`[heartbeat] uptime=${uptime}m fetches=${health.fetchCount} errors=${health.errorCount} deals=${deals.length}`)
  }, 5 * 60 * 1000)
})
