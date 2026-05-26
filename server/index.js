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
const DEALS_FILE = path.join(__dirname, '..', 'deals.json')
const ATTACHMENTS_DIR = path.join(__dirname, '..', 'attachments')

// Ensure attachments dir exists
if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true })

// Load persisted deals
function loadDeals() {
  if (fs.existsSync(DEALS_FILE)) {
    return JSON.parse(fs.readFileSync(DEALS_FILE, 'utf-8'))
  }
  return []
}

function saveDeals(deals) {
  fs.writeFileSync(DEALS_FILE, JSON.stringify(deals, null, 2))
}

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

  // Try common patterns for business name
  const namePatterns = [
    /(?:business\s*name|company\s*name|legal\s*name|dba|doing\s*business\s*as)[:\s]+([^\n]+)/i,
    /(?:applicant|merchant)[:\s]+([^\n]+)/i,
  ]
  for (const p of namePatterns) {
    const m = text.match(p)
    if (m) { info.name = m[1].trim(); break }
  }

  // Revenue / amount requested
  const revPatterns = [
    /(?:amount\s*requested|funding\s*amount|loan\s*amount|advance\s*amount)[:\s]*\$?([\d,]+)/i,
    /(?:revenue|gross\s*revenue|annual\s*revenue)[:\s]*\$?([\d,]+)/i,
  ]
  for (const p of revPatterns) {
    const m = text.match(p)
    if (m) { info.revenue = parseInt(m[1].replace(/,/g, ''), 10); break }
  }

  // Holdback / factor rate
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

  // Broker
  const brokerPatterns = [
    /(?:broker|iso|referral\s*partner|submitted\s*by)[:\s]+([^\n]+)/i,
  ]
  for (const p of brokerPatterns) {
    const m = text.match(p)
    if (m) { info.broker = m[1].trim(); break }
  }

  return info
}

async function fetchInboxDeals() {
  const deals = loadDeals()
  const processedIds = new Set(deals.map(d => d.emailId))

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

    // Save PDFs and extract info from first (application) PDF
    const emailDir = path.join(ATTACHMENTS_DIR, msg.id.substring(0, 40))
    if (!fs.existsSync(emailDir)) fs.mkdirSync(emailDir, { recursive: true })

    let dealInfo = {}
    for (let i = 0; i < pdfAttachments.length; i++) {
      const att = pdfAttachments[i]
      const filePath = path.join(emailDir, att.name)

      // Inline attachments have contentBytes, large ones need separate fetch
      let buf
      if (att.contentBytes) {
        buf = Buffer.from(att.contentBytes, 'base64')
      } else {
        const contentUrl = `https://graph.microsoft.com/v1.0/users/${user}/messages/${msg.id}/attachments/${att.id}/$value`
        buf = await graphGetBuffer(contentUrl, token)
      }
      fs.writeFileSync(filePath, buf)

      // Parse first PDF for deal info (likely the application)
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

    // Look up Supabase deal by email_id for detail link + real data
    let supabaseId = null
    let sbData = {}
    try {
      const { data: sbDeal } = await supabase
        .from('deals')
        .select('id,business_name,dba,broker_name,true_revenue_avg,avg_holdback_pct,requested_amount,monthly_revenue,state')
        .eq('email_id', msg.id)
        .maybeSingle()
      if (sbDeal) {
        supabaseId = sbDeal.id
        sbData = sbDeal
      }
    } catch (err) {
      console.error('Supabase lookup failed:', err.message)
    }

    const nextId = deals.length > 0 ? Math.max(...deals.map(d => d.id)) + 1 : 1
    const revenue = sbData.true_revenue_avg || 0
    const holdback = sbData.avg_holdback_pct != null ? sbData.avg_holdback_pct / 100 : 0
    const deal = {
      id: nextId,
      emailId: msg.id,
      supabaseId,
      name: cleanDealName(sbData.dba || sbData.business_name || dealInfo.name || msg.subject) || 'Unknown Business',
      broker: sbData.broker_name || dealInfo.broker || msg.from?.emailAddress?.name || 'Unknown',
      trueRevenue: Math.round(revenue),
      holdback,
      status: 'Open',
      date: msg.receivedDateTime?.split('T')[0] || new Date().toISOString().split('T')[0],
      receivedAt: msg.receivedDateTime || new Date().toISOString(),
      detailUrl: supabaseId
        ? `${DETAIL_BASE_URL}/?deal_id=${supabaseId}`
        : null,
      state: sbData.state || null,
      attachmentCount: pdfAttachments.length,
      emailSubject: msg.subject,
      attachmentDir: emailDir,
    }

    deals.push(deal)
    newCount++
    console.log(`New deal: ${deal.name} (${pdfAttachments.length} PDFs)`)
  }

  if (newCount > 0) {
    saveDeals(deals)
    console.log(`Added ${newCount} new deal(s). Total: ${deals.length}`)
  }
}

// Health tracking
const health = {
  startedAt: new Date().toISOString(),
  lastFetchAttempt: null,
  lastFetchSuccess: null,
  lastFetchError: null,
  lastEnrichAttempt: null,
  lastEnrichSuccess: null,
  lastEnrichError: null,
  fetchCount: 0,
  enrichCount: 0,
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
app.get('/api/deals', (req, res) => {
  res.json(loadDeals())
})

// Update deal (status, notes)
app.patch('/api/deals/:id', (req, res) => {
  const deals = loadDeals()
  const id = parseInt(req.params.id, 10)
  const deal = deals.find(d => d.id === id)
  if (!deal) return res.status(404).json({ error: 'Not found' })
  if (req.body.status) deal.status = req.body.status
  if (req.body.notes !== undefined) deal.notes = req.body.notes
  saveDeals(deals)
  res.json(deal)
})

// Bulk status update
app.patch('/api/deals/bulk/status', (req, res) => {
  const { ids, status } = req.body
  if (!ids || !status) return res.status(400).json({ error: 'ids and status required' })
  const deals = loadDeals()
  let updated = 0
  for (const deal of deals) {
    if (ids.includes(deal.id)) {
      deal.status = status
      updated++
    }
  }
  saveDeals(deals)
  res.json({ updated })
})

// Re-enrich all deals from Supabase
async function enrichDeals() {
  const deals = loadDeals()
  let enriched = 0
  for (const deal of deals) {
    if (!deal.emailId) continue
    try {
      const { data: sb } = await supabase
        .from('deals')
        .select('id,business_name,dba,broker_name,true_revenue_avg,avg_holdback_pct,state')
        .eq('email_id', deal.emailId)
        .maybeSingle()
      if (!sb) continue
      deal.supabaseId = sb.id
      deal.detailUrl = `${DETAIL_BASE_URL}/?deal_id=${sb.id}`
      if (sb.dba || sb.business_name) deal.name = cleanDealName(sb.dba || sb.business_name)
      if (sb.broker_name) deal.broker = sb.broker_name
      if (sb.true_revenue_avg) deal.trueRevenue = Math.round(sb.true_revenue_avg)
      if (sb.avg_holdback_pct != null) deal.holdback = sb.avg_holdback_pct / 100
      if (sb.state) deal.state = sb.state
      enriched++
    } catch (err) {
      console.error(`Enrich failed for ${deal.name}:`, err.message)
    }
  }
  if (enriched > 0) {
    saveDeals(deals)
    console.log(`Enriched ${enriched}/${deals.length} deals from Supabase`)
  }
}

app.post('/api/enrich', async (req, res) => {
  await enrichDeals()
  res.json(loadDeals())
})

// Delete deal (only when user says to)
app.delete('/api/deals/:id', (req, res) => {
  const deals = loadDeals()
  const id = parseInt(req.params.id, 10)
  const idx = deals.findIndex(d => d.id === id)
  if (idx === -1) return res.status(404).json({ error: 'Not found' })
  deals.splice(idx, 1)
  saveDeals(deals)
  res.json({ ok: true })
})

// Health endpoint
app.get('/api/health', (req, res) => {
  const now = new Date()
  const lastFetch = health.lastFetchSuccess ? new Date(health.lastFetchSuccess) : null
  const lastEnrich = health.lastEnrichSuccess ? new Date(health.lastEnrichSuccess) : null
  const fetchAgeMs = lastFetch ? now - lastFetch : null
  const enrichAgeMs = lastEnrich ? now - lastEnrich : null

  const issues = []
  if (!lastFetch) issues.push('Never fetched successfully')
  else if (fetchAgeMs > 5 * 60 * 1000) issues.push(`Last fetch ${Math.round(fetchAgeMs / 60000)}m ago`)
  if (!lastEnrich) issues.push('Never enriched successfully')
  else if (enrichAgeMs > 5 * 60 * 1000) issues.push(`Last enrich ${Math.round(enrichAgeMs / 60000)}m ago`)

  const ok = issues.length === 0
  res.status(ok ? 200 : 503).json({
    status: ok ? 'healthy' : 'degraded',
    issues,
    uptime: Math.round((now - new Date(health.startedAt)) / 1000),
    ...health,
    dealCount: loadDeals().length,
  })
})

// Manual trigger
app.post('/api/fetch-deals', async (req, res) => {
  await fetchInboxDeals()
  res.json(loadDeals())
})

// Wrapped versions that never throw — keeps setInterval alive
async function safeFetchInboxDeals() {
  health.lastFetchAttempt = new Date().toISOString()
  try {
    await fetchInboxDeals()
    health.lastFetchSuccess = new Date().toISOString()
    health.fetchCount++
    health.lastFetchError = null
    console.log(`[heartbeat] fetch OK — ${loadDeals().length} deals`)
  } catch (err) {
    health.lastFetchError = err.message
    health.errorCount++
    console.error(`[heartbeat] fetch FAILED:`, err.message)
  }
}

async function safeEnrichDeals() {
  health.lastEnrichAttempt = new Date().toISOString()
  try {
    await enrichDeals()
    health.lastEnrichSuccess = new Date().toISOString()
    health.enrichCount++
    health.lastEnrichError = null
  } catch (err) {
    health.lastEnrichError = err.message
    health.errorCount++
    console.error(`[heartbeat] enrich FAILED:`, err.message)
  }
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Deal server running on http://localhost:${PORT}`)

  // Initial fetch + enrich
  safeFetchInboxDeals().then(() => safeEnrichDeals())

  // Poll inbox every 2 minutes
  setInterval(safeFetchInboxDeals, 2 * 60 * 1000)

  // Re-enrich from Supabase every 2 minutes
  setInterval(safeEnrichDeals, 2 * 60 * 1000)

  // Self-ping keepalive — prevents Railway from sleeping
  const SELF_URL = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${PORT}`
  setInterval(() => {
    fetch(`${SELF_URL}/api/health`).catch(() => {})
  }, 4 * 60 * 1000)

  // Heartbeat log every 5 minutes
  setInterval(() => {
    const uptime = Math.round((Date.now() - new Date(health.startedAt).getTime()) / 60000)
    console.log(`[heartbeat] uptime=${uptime}m fetches=${health.fetchCount} enriches=${health.enrichCount} errors=${health.errorCount} deals=${loadDeals().length}`)
  }, 5 * 60 * 1000)
})
