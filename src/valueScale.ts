import type { CompanionInputFieldNumber } from '@companion-module/base'
import { clamp } from './api/index.js'

/** How level values are shown to and entered by the user */
export type ValueScale = 'percent' | 'dmx'

/** Fixture parameters whose user-facing value follows the value scale setting */
export type LevelParameter = 'intensity' | 'saturation' | 'red' | 'green' | 'blue' | 'greenMagenta'

/** The range each parameter is held in within FixtureState, independent of the setting */
const STATE_RANGES: Record<LevelParameter, [number, number]> = {
	intensity: [0, 100],
	saturation: [0, 100],
	red: [0, 255],
	green: [0, 255],
	blue: [0, 255],
	greenMagenta: [-100, 100],
}

/** The range the user sees and enters for a parameter */
export function levelRange(scale: ValueScale, param: LevelParameter): [number, number] {
	if (scale === 'dmx') return [0, 255]
	return param === 'greenMagenta' ? [-100, 100] : [0, 100]
}

/** Convert a user-facing value (clamped to its range) into FixtureState's range */
export function toState(scale: ValueScale, param: LevelParameter, value: number): number {
	const [min, max] = levelRange(scale, param)
	const [stateMin, stateMax] = STATE_RANGES[param]
	return stateMin + ((clamp(value, min, max) - min) / (max - min)) * (stateMax - stateMin)
}

/** Convert a FixtureState value into the user-facing range, unrounded */
export function fromState(scale: ValueScale, param: LevelParameter, value: number): number {
	const [min, max] = levelRange(scale, param)
	const [stateMin, stateMax] = STATE_RANGES[param]
	return min + ((value - stateMin) / (stateMax - stateMin)) * (max - min)
}

/** "%" where the value is a percentage, otherwise nothing */
export function levelSuffix(scale: ValueScale, param: LevelParameter): string {
	return scale === 'percent' && param !== 'greenMagenta' ? '%' : ''
}

/** Label with the unit, e.g. "Intensity (%)" or "Intensity (0-255)" */
export function levelLabel(scale: ValueScale, param: LevelParameter, name: string): string {
	if (param === 'greenMagenta') {
		return `${name} (${scale === 'dmx' ? '0 green … 255 magenta' : '-100 green … +100 magenta'})`
	}
	return `${name} (${scale === 'dmx' ? '0-255' : '%'})`
}

/** Number option for a level, with its range and default in the user-facing scale */
export function levelOption<TKey extends string>(
	scale: ValueScale,
	id: TKey,
	param: LevelParameter,
	name: string,
	stateDefault: number,
): CompanionInputFieldNumber<TKey> {
	const [min, max] = levelRange(scale, param)
	return {
		id,
		type: 'number',
		label: levelLabel(scale, param, name),
		default: Math.round(fromState(scale, param, stateDefault)),
		min,
		max,
		range: true,
	}
}
