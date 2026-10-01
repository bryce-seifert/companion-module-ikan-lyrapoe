/**
 * DMX channel maps per fixture model. Models are identified by the `longName` in the
 * ArtPollReply / `dev_name` from `/sys_cfg_load`.
 */

export type FixtureParameter = 'intensity' | 'cct' | 'greenMagenta' | 'hue' | 'saturation' | 'red' | 'green' | 'blue'

export type ColorMode = 'cct' | 'hsi' | 'rgb'

export const COLOR_MODES: { id: ColorMode; label: string }[] = [
	{ id: 'cct', label: 'CCT' },
	{ id: 'hsi', label: 'HSI' },
	{ id: 'rgb', label: 'RGB' },
]

/** 1-based channel offset within the footprint for each parameter available in a mode */
export type ChannelLayout = Partial<Record<FixtureParameter, number>>

export interface FixtureProfile {
	model: string
	/** Total channel footprint */
	channels: number
	/** Kelvin range covered by the 0-255 CCT channel */
	cctRange: { min: number; max: number }
	/** Channel that selects the color mode, and the DMX value to send for each; null for single-mode fixtures */
	modeChannel: { channel: number; values: Record<ColorMode, number> } | null
	/** Channel layout per mode. Single-mode fixtures only define their one mode. */
	modes: Partial<Record<ColorMode, ChannelLayout>>
}

/** Two-channel bi-color fixture: intensity and color temperature */
function biColorProfile(model: string, minKelvin: number, maxKelvin: number): FixtureProfile {
	return {
		model,
		channels: 2,
		cctRange: { min: minKelvin, max: maxKelvin },
		modeChannel: null,
		modes: {
			cct: { intensity: 1, cct: 2 },
		},
	}
}

/** Four-channel color fixture with CCT, HSI and RGB modes */
function colorProfile(model: string, minKelvin: number, maxKelvin: number): FixtureProfile {
	return {
		model,
		channels: 4,
		cctRange: { min: minKelvin, max: maxKelvin },
		// Channel 4: 0-85 CCT, 86-170 HSI, 171-255 RGB — the meaning of channels 1-3 follows it
		modeChannel: { channel: 4, values: { cct: 0, hsi: 128, rgb: 255 } },
		modes: {
			cct: { intensity: 1, cct: 2, greenMagenta: 3 },
			hsi: { intensity: 1, hue: 2, saturation: 3 },
			rgb: { red: 1, green: 2, blue: 3 },
		},
	}
}

/** Models are matched as part of the device name, so "LBX8" also matches "LBX8-POE" */
const FIXTURE_PROFILES: FixtureProfile[] = [
	biColorProfile('LBX5', 2700, 5600),
	biColorProfile('LBX8', 3200, 5600),
	biColorProfile('LBX10', 3200, 5600),
	biColorProfile('LBX16', 2700, 5600),
	biColorProfile('LBX20', 3200, 5600),
	biColorProfile('LBX30', 2700, 6500),
	biColorProfile('LBF60', 2700, 6500),
	biColorProfile('LBF60B', 2700, 6500),
	biColorProfile('LBF60Z', 2700, 6500),
	colorProfile('LCX5', 2700, 5600),
	colorProfile('LCX8', 2700, 6500),
	colorProfile('LCX10', 2700, 6500),
]

/**
 * Used when the device name doesn't identify the model. It exposes every control: its channels 1-2 line up
 * with the bi-color fixtures, and DMX is unicast to each fixture so the extra channels can't reach another one.
 */
export const UNKNOWN_FIXTURE_PROFILE: FixtureProfile = colorProfile('Unknown', 2700, 6500)

// Longest first, so a model whose name contains another model's name wins
const PROFILES_BY_MODEL_LENGTH = [...FIXTURE_PROFILES].sort((a, b) => b.model.length - a.model.length)

/**
 * Find the profile for a fixture from its device name. The name is user-editable in the fixture's web UI
 * and nothing else identifies the model, so a name that merely contains a model (e.g. "LCX10-POE Key") matches.
 */
export function getFixtureProfile(deviceName: string): FixtureProfile | null {
	const name = deviceName.toUpperCase()
	return PROFILES_BY_MODEL_LENGTH.find((p) => name.includes(p.model.toUpperCase())) ?? null
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

/** Map a Kelvin value onto the fixture's 0-255 CCT channel */
function kelvinToDmx(profile: FixtureProfile, kelvin: number): number {
	const { min, max } = profile.cctRange
	const clamped = clamp(kelvin, min, max)
	return Math.round(((clamped - min) / (max - min)) * 255)
}

/** Map a 0-100 percentage onto 0-255 */
function percentToDmx(percent: number): number {
	return Math.round((clamp(percent, 0, 100) / 100) * 255)
}

export interface FixtureState {
	mode: ColorMode
	/** 0-100 */
	intensity: number
	/** Kelvin */
	cct: number
	/** -100 (full green) .. 100 (full magenta) */
	greenMagenta: number
	/** 0-360 */
	hue: number
	/** 0-100 */
	saturation: number
	/** 0-255 */
	red: number
	green: number
	blue: number
}

export const DEFAULT_FIXTURE_STATE: FixtureState = {
	mode: 'cct',
	intensity: 0,
	cct: 5600,
	greenMagenta: 0,
	hue: 0,
	saturation: 100,
	red: 255,
	green: 255,
	blue: 255,
}

/** The mode the fixture will actually be in: single-mode fixtures ignore the requested mode */
export function effectiveMode(profile: FixtureProfile, mode: ColorMode): ColorMode {
	if (profile.modes[mode]) return mode
	return Object.keys(profile.modes)[0] as ColorMode
}

function encodeParameter(profile: FixtureProfile, param: FixtureParameter, state: FixtureState): number {
	switch (param) {
		case 'intensity':
			return percentToDmx(state.intensity)
		case 'cct':
			return kelvinToDmx(profile, state.cct)
		case 'greenMagenta':
			return Math.round(((clamp(state.greenMagenta, -100, 100) + 100) / 200) * 255)
		case 'hue':
			return Math.round(((((state.hue % 360) + 360) % 360) / 360) * 255)
		case 'saturation':
			return percentToDmx(state.saturation)
		case 'red':
			return Math.round(clamp(state.red, 0, 255))
		case 'green':
			return Math.round(clamp(state.green, 0, 255))
		case 'blue':
			return Math.round(clamp(state.blue, 0, 255))
	}
}

/** Render a fixture's state into the DMX values for its channel footprint */
export function encodeFixtureState(profile: FixtureProfile, state: FixtureState): number[] {
	const values: number[] = new Array(profile.channels).fill(0)
	const mode = effectiveMode(profile, state.mode)
	const layout = profile.modes[mode] ?? {}
	if (profile.modeChannel) values[profile.modeChannel.channel - 1] = profile.modeChannel.values[mode]
	for (const [param, channel] of Object.entries(layout)) {
		values[channel - 1] = encodeParameter(profile, param as FixtureParameter, state)
	}
	return values
}
