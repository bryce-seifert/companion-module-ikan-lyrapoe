import type { CompanionVariableDefinitions } from '@companion-module/base'
import type IkanInstance from './main.js'
import { universeOf, type ManagedFixture } from './fixtureManager.js'
import { effectiveMode } from './api/index.js'
import { fromState, levelLabel, type LevelParameter, type ValueScale } from './valueScale.js'

export type VariablesSchema = {
	fixture_count: number
	[key: string]: string | number | boolean | undefined
}

const FIXTURE_VARIABLES: Record<string, string> = {
	model: 'Model',
	ip: 'IP address',
	dmx_address: 'DMX address',
	universe: 'Universe',
	protocol: 'Protocol',
	online: 'Online',
	mode: 'Color mode',
	cct: 'Color temperature (K)',
	hue: 'Hue (°)',
}

/** Variables whose value and label follow the value scale setting */
const LEVEL_VARIABLES: Record<string, { param: LevelParameter; name: string }> = {
	intensity: { param: 'intensity', name: 'Intensity' },
	green_magenta: { param: 'greenMagenta', name: 'Green/magenta' },
	saturation: { param: 'saturation', name: 'Saturation' },
	red: { param: 'red', name: 'Red' },
	green: { param: 'green', name: 'Green' },
	blue: { param: 'blue', name: 'Blue' },
}

export function UpdateVariableDefinitions(self: IkanInstance): void {
	const definitions: CompanionVariableDefinitions<VariablesSchema> = {
		fixture_count: { name: 'Number of fixtures found' },
	}
	const scale = self.config.valueScale
	const labels: Record<string, string> = { ...FIXTURE_VARIABLES }
	for (const [suffix, { param, name }] of Object.entries(LEVEL_VARIABLES))
		labels[suffix] = levelLabel(scale, param, name)
	for (const fixture of self.fixtures.fixtures) {
		for (const [suffix, label] of Object.entries(labels)) {
			definitions[`${fixture.id}_${suffix}`] = { name: `${fixture.name} ${fixture.ip}: ${label}` }
		}
	}
	self.setVariableDefinitions(definitions)
}

function fixtureVariableValues(scale: ValueScale, fixture: ManagedFixture): Partial<VariablesSchema> {
	const { id, state } = fixture
	const mode = effectiveMode(fixture.profile, state.mode)
	const values: Partial<VariablesSchema> = {
		[`${id}_model`]: fixture.name,
		[`${id}_ip`]: fixture.ip,
		[`${id}_dmx_address`]: fixture.dmx.dmxAddress,
		[`${id}_universe`]: universeOf(fixture),
		[`${id}_protocol`]: fixture.protocol,
		[`${id}_online`]: fixture.online,
		[`${id}_mode`]: mode.toUpperCase(),
		[`${id}_cct`]: state.cct,
		[`${id}_hue`]: state.hue,
	}
	for (const [suffix, { param }] of Object.entries(LEVEL_VARIABLES)) {
		values[`${id}_${suffix}`] = Math.round(fromState(scale, param, state[param]))
	}
	return values
}

export function UpdateVariableValues(self: IkanInstance, fixtures: ManagedFixture[]): void {
	const values: Partial<VariablesSchema> = { fixture_count: self.fixtures.fixtures.length }
	for (const fixture of fixtures) Object.assign(values, fixtureVariableValues(self.config.valueScale, fixture))
	self.setVariableValues(values)
}
