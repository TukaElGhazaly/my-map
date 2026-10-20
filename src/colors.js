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
