import type { CompanionInputFieldDropdown, CompanionInputFieldMultiDropdown } from '@companion-module/base'
import type IkanInstance from './main.js'
import type { FixtureTarget, ManagedFixture } from './fixtureManager.js'
import { clamp, COLOR_MODES, DEFAULT_FIXTURE_STATE, type ColorMode } from './api/index.js'
import { fromState, levelLabel, levelOption, levelRange, toState } from './valueScale.js'

export type FixtureTargetOptions = { target: FixtureTarget; fixtures: string[] }

export type ActionsSchema = {
	set_intensity: { options: FixtureTargetOptions & { intensity: number } }
	adjust_intensity: { options: FixtureTargetOptions & { delta: number } }
	set_cct: { options: FixtureTargetOptions & { cct: number } }
	adjust_cct: { options: FixtureTargetOptions & { delta: number } }
	set_green_magenta: { options: FixtureTargetOptions & { value: number } }
	set_hsi: { options: FixtureTargetOptions & { hue: number; saturation: number } }
	set_rgb: { options: FixtureTargetOptions & { red: number; green: number; blue: number } }
	set_mode: { options: { fixtures: string[]; mode: ColorMode } }
	discover: { options: Record<string, never> }
}

/** "All Fixtures" / "Select Fixtures", with the multi-select only shown for the latter */
export function fixtureTargetOptions(
	self: IkanInstance,
): [CompanionInputFieldDropdown<'target', FixtureTarget>, CompanionInputFieldMultiDropdown<'fixtures', string>] {
	return [
		{
			id: 'target',
			type: 'dropdown',
			label: 'Fixtures',
			choices: [
				{ id: 'all', label: 'All Fixtures' },
				{ id: 'select', label: 'Select Fixtures' },
			],
			default: 'all',
			disableAutoExpression: true,
		},
		{
			...modeFixturesOption(self, false),
			label: 'Selected fixtures',
			isVisibleExpression: `$(options:target) == 'select'`,
		},
	]
}

/** Fixture multi-select; color mode only lists fixtures that can switch modes */
export function modeFixturesOption(
	self: IkanInstance,
	modeSwitchingOnly: boolean,
): CompanionInputFieldMultiDropdown<'fixtures', string> {
	return {
		id: 'fixtures',
		type: 'multidropdown',
		label: 'Fixtures',
		choices: self.fixtures.fixtureChoices(modeSwitchingOnly),
		default: [],
		minChoicesForSearch: 8,
		sortSelection: true,
	}
}

export function modeOption(): CompanionInputFieldDropdown<'mode', ColorMode> {
	return { id: 'mode', type: 'dropdown', label: 'Mode', default: 'cct', choices: COLOR_MODES }
}

export function targetsOf(self: IkanInstance, options: FixtureTargetOptions): ManagedFixture[] {
	return self.fixtures.resolveTargets(options.target, options.fixtures)
}

export function UpdateActions(self: IkanInstance): void {
	const scale = self.config.valueScale
	const [intensityMin, intensityMax] = levelRange(scale, 'intensity')
	const intensitySpan = intensityMax - intensityMin
	self.setActionDefinitions({
		set_intensity: {
			name: 'Set Intensity',
			options: [...fixtureTargetOptions(self), levelOption(scale, 'intensity', 'intensity', 'Intensity', 100)],
			callback: (event) => {
				self.applyState(targetsOf(self, event.options), {
					intensity: toState(scale, 'intensity', event.options.intensity),
				})
			},
		},
		adjust_intensity: {
			name: 'Adjust Intensity',
			options: [
				...fixtureTargetOptions(self),
				{
					id: 'delta',
					type: 'number',
					label: levelLabel(scale, 'intensity', 'Change by'),
					default: Math.round(fromState(scale, 'intensity', 10)),
					min: -intensitySpan,
					max: intensitySpan,
				},
			],
			callback: (event) => {
				self.applyState(targetsOf(self, event.options), (f) => ({
					intensity: toState(
						scale,
						'intensity',
						fromState(scale, 'intensity', f.state.intensity) + event.options.delta,
					),
				}))
			},
		},
		set_cct: {
			name: 'Set Color Temperature',
			description: 'Switches the fixture to CCT mode',
			options: [
				...fixtureTargetOptions(self),
				{ id: 'cct', type: 'number', label: 'Kelvin', default: 5600, min: 2700, max: 6500, step: 100, range: true },
			],
			callback: (event) => {
				self.applyState(targetsOf(self, event.options), { mode: 'cct', cct: event.options.cct })
			},
		},
		adjust_cct: {
			name: 'Adjust Color Temperature',
			description: 'Switches the fixture to CCT mode',
			options: [
				...fixtureTargetOptions(self),
				{ id: 'delta', type: 'number', label: 'Change by (K)', default: 100, min: -3800, max: 3800, step: 100 },
			],
			callback: (event) => {
				self.applyState(targetsOf(self, event.options), (f) => ({
					mode: 'cct',
					cct: clamp(f.state.cct + event.options.delta, f.profile.cctRange.min, f.profile.cctRange.max),
				}))
			},
		},
		set_green_magenta: {
			name: 'Set Green/Magenta',
			description: 'Switches the fixture to CCT mode',
			options: [
				...fixtureTargetOptions(self),
				levelOption(scale, 'value', 'greenMagenta', 'Green/Magenta', DEFAULT_FIXTURE_STATE.greenMagenta),
			],
			callback: (event) => {
				self.applyState(targetsOf(self, event.options), {
					mode: 'cct',
					greenMagenta: toState(scale, 'greenMagenta', event.options.value),
				})
			},
		},
		set_hsi: {
			name: 'Set Hue / Saturation',
			description: 'Switches the fixture to HSI mode',
			options: [
				...fixtureTargetOptions(self),
				{ id: 'hue', type: 'number', label: 'Hue (°)', default: 0, min: 0, max: 360, range: true },
				levelOption(scale, 'saturation', 'saturation', 'Saturation', 100),
			],
			callback: (event) => {
				self.applyState(targetsOf(self, event.options), {
					mode: 'hsi',
					hue: event.options.hue,
					saturation: toState(scale, 'saturation', event.options.saturation),
				})
			},
		},
		set_rgb: {
			name: 'Set Red / Green / Blue',
			description: 'Switches the fixture to RGB mode',
			options: [
				...fixtureTargetOptions(self),
				levelOption(scale, 'red', 'red', 'Red', 255),
				levelOption(scale, 'green', 'green', 'Green', 255),
				levelOption(scale, 'blue', 'blue', 'Blue', 255),
			],
			callback: (event) => {
				self.applyState(targetsOf(self, event.options), {
					mode: 'rgb',
					red: toState(scale, 'red', event.options.red),
					green: toState(scale, 'green', event.options.green),
					blue: toState(scale, 'blue', event.options.blue),
				})
			},
		},
		set_mode: {
			name: 'Set Color Mode',
			options: [modeFixturesOption(self, true), modeOption()],
			callback: (event) => {
				self.applyState(self.fixtures.getFixtures(event.options.fixtures), { mode: event.options.mode })
			},
		},
		discover: {
			name: 'Search for Fixtures',
			options: [],
			callback: async () => {
				await self.discover()
			},
		},
	})
}
