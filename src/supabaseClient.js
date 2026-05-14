import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://ngovbsarkjthevktgkrc.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nb3Zic2Fya2p0aGV2a3Rna3JjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NTM4ODEsImV4cCI6MjA5NDEyOTg4MX0.hre1Vvn9Oym2jEca9TefwJ3Rq0aH54rZCW-Opu4A3og'

export const supabase = createClient(supabaseUrl, supabaseKey)
