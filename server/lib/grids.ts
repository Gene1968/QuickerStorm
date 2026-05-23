// server/lib/grids.ts — load and validate grid config
import { readFileSync } from 'fs'
import { join } from 'path'

export interface Grid {
	nick:                 string
	name:                 string
	loginURI:             string
	slurlBase:            string
	platform?:            'OpenSim' | 'SecondLife'
	system?:              boolean
	gatekeeper?:          string
	helperURI?:           string
	loginPage?:           string
	about?:               string
	help?:                string
	register?:            string
	password?:            string
	search?:              string
	webProfileURL?:       string
	currencySymbol?:      string
	loginIdentifierTypes?: string[]
	// user-added grids (stored client-side, never in grids.json)
	userAdded?:           boolean
}

let _grids: Record<string, Grid> | null = null

export function getGrids(): Record<string, Grid> {
	if (_grids) return _grids
	const raw = readFileSync(join(import.meta.dir, '../../src/config/grids.json'), 'utf8')
	_grids = JSON.parse(raw) as Record<string, Grid>
	return _grids
}

export function getGrid(nick: string): Grid | undefined {
	return getGrids()[nick]
}
