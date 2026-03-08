import { useState, useEffect } from 'react'
import './App.css'

const API = 'https://api.openf1.org/v1'
const YEARS = [2026, 2025, 2024, 2023]

// Year-aware team slug mapping for car images
// Format: { 'API team_name': { yearRange: slug } }
const TEAM_SLUGS = {
  'Red Bull Racing':              { 2024: 'redbullracing' },
  'McLaren':                      { 2024: 'mclaren' },
  'Ferrari':                      { 2024: 'ferrari' },
  'Mercedes':                     { 2024: 'mercedes' },
  'Aston Martin':                 { 2024: 'astonmartin' },
  'Alpine':                       { 2024: 'alpine' },
  'Williams':                     { 2024: 'williams' },
  'Haas F1 Team':                 { 2024: 'haas' },
  'RB':                           { 2024: 'rb' },
  'Racing Bulls':                 { 2025: 'rb', 2026: 'racingbulls' },
  'Kick Sauber':                  { 2024: 'kicksauber' },
  'Stake F1 Team Kick Sauber':    { 2024: 'kicksauber' },
  'Audi':                         { 2026: 'audi' },
  'Cadillac':                     { 2026: 'cadillac' },
}

function getCarImageUrl(teamName, year) {
  const entry = TEAM_SLUGS[teamName]
  if (!entry) return null
  // Find the best matching slug: use the highest year key <= requested year
  const years = Object.keys(entry).map(Number).sort((a, b) => a - b)
  let slug = null
  for (const y of years) {
    if (y <= year) slug = entry[y]
  }
  // If no year matched (all keys are > year), try the earliest
  if (!slug) slug = entry[years[0]]
  if (!slug) return null
  return `https://media.formula1.com/image/upload/c_lfill,w_3392/q_auto/v1740000000/common/f1/${year}/${slug}/${year}${slug}carright.webp`
}

// Rate-limited fetch: max 2 req/s to stay under the 3/s API limit
let lastFetchTime = 0
const MIN_INTERVAL = 550 // ms between requests

class SessionLiveError extends Error {
  constructor() {
    super('Live session in progress')
    this.name = 'SessionLiveError'
  }
}

async function fetchJson(url) {
  const now = Date.now()
  const wait = Math.max(0, MIN_INTERVAL - (now - lastFetchTime))
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastFetchTime = Date.now()

  const res = await fetch(url)
  if (res.status === 401) throw new SessionLiveError()
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// localStorage cache with TTL
const CACHE_PREFIX = 'f1tb_'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function getCacheTTL(year) {
  const currentYear = new Date().getFullYear()
  // Past seasons are stable — cache for 30 days
  // Current/future season — cache for 1 hour (updates during race weekends)
  return year < currentYear ? 30 * DAY : HOUR
}

function readCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key)
    if (!raw) return null
    const { data, expiry } = JSON.parse(raw)
    if (Date.now() > expiry) {
      localStorage.removeItem(CACHE_PREFIX + key)
      return null
    }
    return data
  } catch {
    return null
  }
}

function writeCache(key, data, ttl) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data,
      expiry: Date.now() + ttl,
    }))
  } catch {
    // localStorage full or unavailable — no big deal
  }
}

async function getLatestRaceSessionKey(year) {
  const cacheKey = `sessions_${year}`
  let sessions = readCache(cacheKey)
  if (!sessions) {
    sessions = await fetchJson(`${API}/sessions?year=${year}&session_type=Race`)
    // Cache race sessions — short TTL for current year so new races are picked up
    if (sessions.length) writeCache(cacheKey, sessions, getCacheTTL(year))
  }
  const now = new Date().toISOString()
  const past = sessions.filter(s => s.date_start < now)
  if (past.length === 0) return null
  return past[past.length - 1].session_key
}

async function loadData(year) {
  const cached = readCache(`teams_${year}`)
  if (cached) return cached

  const sessionKey = await getLatestRaceSessionKey(year)

  // Fetch driver roster — from race session if available, otherwise latest session for the year
  let drivers, standings

  if (sessionKey) {
    drivers = await fetchJson(`${API}/drivers?session_key=${sessionKey}`)
    standings = await fetchJson(`${API}/championship_drivers?session_key=${sessionKey}`)
  } else {
    // No races yet — grab driver list from any session this year
    const allSessions = await fetchJson(`${API}/sessions?year=${year}`)
    if (!allSessions.length) return null

    const now = new Date().toISOString()
    const pastSessions = allSessions.filter(s => s.date_start < now)
    const sessionToUse = pastSessions.length
      ? pastSessions[pastSessions.length - 1]
      : allSessions[0]

    drivers = await fetchJson(`${API}/drivers?session_key=${sessionToUse.session_key}`)
    standings = [] // no championship data yet
  }

  if (!drivers.length) return null

  const pointsMap = {}
  const posMap = {}
  for (const s of standings) {
    pointsMap[s.driver_number] = s.points_current
    posMap[s.driver_number] = s.position_current
  }

  const seen = new Set()
  const uniqueDrivers = []
  for (const d of drivers) {
    if (!seen.has(d.driver_number)) {
      seen.add(d.driver_number)
      uniqueDrivers.push(d)
    }
  }

  const teams = {}
  for (const d of uniqueDrivers) {
    const team = d.team_name
    if (!teams[team]) {
      teams[team] = { name: team, colour: d.team_colour, drivers: [] }
    }
    teams[team].drivers.push({
      number: d.driver_number,
      name: `${d.first_name} ${d.last_name}`,
      acronym: d.name_acronym,
      headshot: d.headshot_url,
      points: pointsMap[d.driver_number] ?? 0,
      position: posMap[d.driver_number] ?? 99,
      teamColour: d.team_colour,
    })
  }

  const teamList = Object.values(teams)
    .filter(t => t.drivers.length === 2)
    .map(t => {
      t.drivers.sort((a, b) => b.points - a.points)
      t.totalPoints = t.drivers.reduce((s, d) => s + d.points, 0)
      return t
    })
    .sort((a, b) => b.totalPoints - a.totalPoints)

  writeCache(`teams_${year}`, teamList, getCacheTTL(year))
  return teamList
}

function DriverCard({ driver, isLeading, teamColour }) {
  const borderColor = `#${teamColour}`
  return (
    <div className={`driver-card ${isLeading ? 'leading' : ''}`}>
      <div className="driver-headshot-wrap">
        <img
          className="driver-headshot"
          src={driver.headshot || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="%23333" width="1" height="1"/></svg>'}
          alt={driver.name}
          loading="lazy"
        />
      </div>
      <div className="driver-info">
        <span className="driver-acronym" style={{ borderLeftColor: borderColor }}>{driver.acronym}</span>
        <span className="driver-name">{driver.name}</span>
      </div>
      <div className="driver-points">
        <span className="points-value">{driver.points}</span>
        <span className="points-label">PTS</span>
      </div>
      <div className="driver-position">{driver.position < 99 ? `P${driver.position}` : '—'}</div>
    </div>
  )
}

function PointsBar({ driver1, driver2, teamColour }) {
  const total = driver1.points + driver2.points
  const pct1 = total > 0 ? (driver1.points / total) * 100 : 50
  const color = `#${teamColour}`
  const diff = Math.abs(driver1.points - driver2.points)

  return (
    <div className="points-bar-section">
      <div className="points-bar-track">
        <div
          className="points-bar-fill left"
          style={{ width: `${pct1}%`, background: color }}
        />
        <div
          className="points-bar-fill right"
          style={{ width: `${100 - pct1}%`, background: color, opacity: 0.35 }}
        />
      </div>
      {total > 0 && (
        <div className="points-diff">
          <span style={{ color }}>{diff > 0 ? `+${diff} PTS` : 'TIED'}</span>
        </div>
      )}
    </div>
  )
}

function TeamBattle({ team, year }) {
  const [d1, d2] = team.drivers
  const carImg = getCarImageUrl(team.name, year)

  return (
    <div className="team-card">
      {carImg && (
        <img
          className="team-car"
          src={carImg}
          alt=""
          loading="lazy"
          onError={e => { e.target.style.display = 'none' }}
        />
      )}
      <div className="team-header">
        <div className="team-color-bar" style={{ background: `#${team.colour}` }} />
        <div className="team-name-row">
          <span className="team-name">{team.name}</span>
          <span className="team-total">{team.totalPoints} PTS</span>
        </div>
      </div>
      <div className="battle-area">
        <DriverCard driver={d1} isLeading={true} teamColour={team.colour} />
        <div className="vs-badge">VS</div>
        <DriverCard driver={d2} isLeading={false} teamColour={team.colour} />
      </div>
      <PointsBar driver1={d1} driver2={d2} teamColour={team.colour} />
    </div>
  )
}

function SessionLiveModal({ onDismiss }) {
  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-light" />
        <div className="modal-icon">🔴</div>
        <h2 className="modal-title">LIVE SESSION IN PROGRESS</h2>
        <p className="modal-body">
          The OpenF1 API restricts access to all data (including historical) while a live F1 session is running. Data will be available again once the session ends.
        </p>
        <p className="modal-sub">
          If you have an API key, you can access data during live sessions at{' '}
          <a href="https://openf1.org" target="_blank" rel="noopener">openf1.org</a>
        </p>
        <button className="modal-btn" onClick={onDismiss}>Got it</button>
      </div>
    </div>
  )
}

export default function App() {
  const [year, setYear] = useState(YEARS[0])
  const [teams, setTeams] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sessionLive, setSessionLive] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSessionLive(false)
    loadData(year).then(data => {
      if (cancelled) return
      if (!data) {
        setError(`No championship data available for ${year} yet.`)
        setTeams(null)
      } else {
        setTeams(data)
      }
      setLoading(false)
    }).catch(err => {
      if (cancelled) return
      if (err instanceof SessionLiveError) {
        setSessionLive(true)
      } else {
        setError('Failed to load data. Please try again.')
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [year])

  return (
    <div className="app">
      <header>
        <div className="header-content">
          <div className="logo">
            <span className="logo-f1">F1</span>
            <span className="logo-divider" />
            <span className="logo-text">TEAMMATE BATTLES</span>
          </div>
          <div className="year-selector">
            {YEARS.map(y => (
              <button
                key={y}
                className={`year-btn ${y === year ? 'active' : ''}`}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main>
        {loading && (
          <div className="loading">
            <div className="spinner" />
            <p>Loading {year} championship data...</p>
          </div>
        )}
        {error && !loading && (
          <div className="error-msg">{error}</div>
        )}
        {!loading && teams && (
          <div className="teams-container">
            {teams.map(team => (
              <TeamBattle key={team.name} team={team} year={year} />
            ))}
          </div>
        )}
      </main>

      <footer>
        <p>Data from <a href="https://openf1.org" target="_blank" rel="noopener">OpenF1 API</a> · Not affiliated with Formula 1</p>
      </footer>

      {sessionLive && <SessionLiveModal onDismiss={() => setSessionLive(false)} />}
    </div>
  )
}
