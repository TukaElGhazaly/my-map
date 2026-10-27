// All colours in one place.

export const GROUND_COLOR = '#f3f1ec'
export const BACKGROUND_COLOR = '#e6e3dc'
export const STREET_COLOR = '#8f8b84'

// Quiet colours for the main use of each building.
export const USE_COLORS = {
  residential: '#dcd6c8',
  undefined: '#c9c8c4',
  service: '#b4bec6',
  office: '#9cafc2',
  retail: '#bfb3d3',
  food_and_drink: '#cfb6c6',
  accommodation: '#b3cad3',
  education: '#a6c0a2',
  civic: '#a7b1cc',
  culture: '#bea7c3',
  entertainment: '#c9bfd9',
  health: '#9ec6bd',
  sport: '#bccd9c',
  transport: '#a6a59f',
  light_industrial: '#93948a',
}

export const useLabel = (use) => use.replaceAll('_', ' ')

// One accent in three shades: 5, 10 and 15 minutes.
export const REACH_COLORS = ['#b23a1d', '#e2703f', '#f3b291']

// Buildings renovated by the fund: outline and label.
export const RENOVATED_COLOR = '#1d5c3f'

// The thinking roof: plants, uses, windows, and the heat overlay from blue (held in) to red (escaping).
export const ROOF_COLORS = {
  bare: '#9b9a95',
  thin: '#9fbb7a',
  dense: '#5e8d45',
  terrace: '#b89068',
  path: '#ddd5c6',
  bench: '#6e4a2c',
  locked: '#1d4d2a',
  plantDark: '#3f6e33',
  plantLight: '#7fae5a',
  drawing: '#b23a1d',
  glowWarm: '#ffb347',
  glowCold: '#6fa3d8',
  glowCool: '#fff1d6',
  glowHot: '#ff5a36',
}

const HEAT_STOPS = ['#2f6db5', '#f2efe8', '#c0392b']
export function heatColor(t) {
  const x = Math.max(0, Math.min(1, t)) * 2
  const i = Math.min(1, Math.floor(x))
  const a = HEAT_STOPS[i], b = HEAT_STOPS[i + 1], f = x - i
  const ch = (h, k) => parseInt(h.slice(1 + 2 * k, 3 + 2 * k), 16)
  return `#${[0, 1, 2].map((k) => Math.round(ch(a, k) + (ch(b, k) - ch(a, k)) * f).toString(16).padStart(2, '0')).join('')}`
}
