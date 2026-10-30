import type { CompanionInputFieldNumber } from '@companion-module/base'
import { effectiveMode, type FixtureParameter, type FixtureState } from './api/index.js'
import type { FixtureManager, ManagedFixture } from './fixtureManager.js'

export const LIGHT_PRESET_SLOTS = 100
// Each one adds a recall and a save button; higher slots are reached by changing the slot in the action
export const LIGHT_PRESET_BUTTONS = 10

// Mapped from the interface so it satisfies the JsonObject constraint on the config
type SavedFixtureState = Pick<FixtureState, keyof FixtureState>

/** A saved light setup: the full state of each fixture it covers, keyed by fixture id */
export type LightPreset = Record<string, SavedFixtureState>

/** Saved light presets, keyed by slot number */
export type LightPresets = Record<string, LightPreset>

/** Config key for a slot option value, or null when it isn't a whole number within the slot range */
export function lightPresetSlotKey(value: unknown): string | null {
	const slot = Number(value)
	return Number.isInteger(slot) && slot >= 1 && slot <= LIGHT_PRESET_SLOTS ? String(slot) : null
}

export function lightPresetAt(presets: LightPresets, slot: unknown): LightPreset | undefined {
	const key = lightPresetSlotKey(slot)
	return key ? presets[key] : undefined
}

export function captureLightPreset(fixtures: ManagedFixture[]): LightPreset {
	return Object.fromEntries(fixtures.map((f) => [f.id, { ...f.state }]))
}

/**
 * True when every fixture in the preset is online and still outputs the saved state. Only the values its mode
 * sends are compared, so e.g. RGB values left over from earlier don't matter for a CCT preset.
 */
export function isLightPresetActive(preset: LightPreset, fixtures: FixtureManager): boolean {
	const entries = Object.entries(preset)
	return (
		entries.length > 0 &&
		entries.every(([id, saved]) => {
			const fixture = fixtures.getFixture(id)
			if (!fixture?.online) return false
			const mode = effectiveMode(fixture.profile, saved.mode)
			if (effectiveMode(fixture.profile, fixture.state.mode) !== mode) return false
			const params = Object.keys(fixture.profile.modes[mode] ?? {}) as FixtureParameter[]
			return params.every((param) => fixture.state[param] === saved[param])
		})
	)
}

export function lightPresetSlotOption(): CompanionInputFieldNumber<'slot'> {
	return {
		id: 'slot',
		type: 'number',
		label: 'Light Preset Slot',
		default: 1,
		min: 1,
		max: LIGHT_PRESET_SLOTS,
	}
}
