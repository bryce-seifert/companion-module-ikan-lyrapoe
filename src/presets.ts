import {
	combineRgb,
	splitRgb,
	type CompanionButtonStyleProps,
	type CompanionPresetAction,
	type CompanionPresetDefinitions,
	type CompanionPresetFeedback,
	type CompanionPresetGroupSimple,
	type CompanionPresetSection,
} from '@companion-module/base'
import type { ActionsSchema, FixtureTargetOptions } from './actions.js'
import type { FeedbacksSchema } from './feedbacks.js'
import type { ManagedFixture } from './fixtureManager.js'
import type { ModuleSchema } from './main.js'
import type IkanInstance from './main.js'
import { COLOR_MODES } from './api/index.js'
import { LIGHT_PRESET_BUTTONS } from './lightPresets.js'
import { fromState, levelSuffix, type LevelParameter, type ValueScale } from './valueScale.js'

type PresetAction = CompanionPresetAction<ActionsSchema>
type PresetFeedback = CompanionPresetFeedback<FeedbacksSchema>

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREY = combineRgb(40, 40, 40)

const CCT_PRESETS = [2700, 3200, 4300, 5600, 6500]

const GREEN_MAGENTA_PRESETS = [
	{ id: 'green', label: 'Green +50', text: 'G +50', value: -50, color: combineRgb(150, 255, 150) },
	{ id: 'neutral', label: 'Green/Magenta Neutral', text: 'G/M 0', value: 0, color: combineRgb(220, 220, 220) },
	{ id: 'magenta', label: 'Magenta +50', text: 'M +50', value: 50, color: combineRgb(255, 150, 255) },
]

const COLOR_PRESETS: { id: string; label: string; hue: number; saturation: number; rgb: [number, number, number] }[] = [
	{ id: 'red', label: 'Red', hue: 0, saturation: 100, rgb: [255, 0, 0] },
	{ id: 'orange', label: 'Orange', hue: 30, saturation: 100, rgb: [255, 128, 0] },
	{ id: 'yellow', label: 'Yellow', hue: 60, saturation: 100, rgb: [255, 255, 0] },
	{ id: 'green', label: 'Green', hue: 120, saturation: 100, rgb: [0, 255, 0] },
	{ id: 'cyan', label: 'Cyan', hue: 180, saturation: 100, rgb: [0, 255, 255] },
	{ id: 'blue', label: 'Blue', hue: 240, saturation: 100, rgb: [0, 0, 255] },
	{ id: 'magenta', label: 'Magenta', hue: 300, saturation: 100, rgb: [255, 0, 255] },
	{ id: 'white', label: 'White', hue: 0, saturation: 0, rgb: [255, 255, 255] },
]

/** Approximate button colour for a Kelvin value: warm amber at the low end, cool blue-white at the high end */
function kelvinColor(kelvin: number, min: number, max: number): number {
	const t = (kelvin - min) / (max - min)
	const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
	return combineRgb(lerp(255, 200), lerp(170, 220), lerp(80, 255))
}

/** Button style with black or white text, whichever reads better on the background */
function buttonStyle(text: string, bgcolor: number): CompanionButtonStyleProps {
	const { r, g, b } = splitRgb(bgcolor)
	const dark = r * 0.299 + g * 0.587 + b * 0.114 < 140
	return { text, size: 'auto', show_topbar: false, color: dark ? WHITE : BLACK, bgcolor }
}

// Companion rewrites the connection label in $(...) references when a preset is placed
const v = (fixtureId: string, suffix: string) => `$(lyra:${fixtureId}_${suffix})`

/** Build one preset section, either for every fixture (fixture null) or for a single fixture */
function buildSection(
	presets: CompanionPresetDefinitions<ModuleSchema>,
	scale: ValueScale,
	sectionId: string,
	label: string,
	fixture: ManagedFixture | null,
): CompanionPresetSection {
	const selection: FixtureTargetOptions = fixture
		? { target: 'select', fixtures: [fixture.id] }
		: { target: 'all', fixtures: [] }
	const groups: CompanionPresetGroupSimple[] = []
	const group = (suffix: string, name: string, description: string, presetIds: string[]) => {
		groups.push({ id: `${sectionId}_${suffix}`, name, description, type: 'simple', presets: presetIds })
	}
	const line = (text: string) => `${label}\\n${text}`
	// Preset values are written in the user's chosen scale
	const level = (param: LevelParameter, stateValue: number) => Math.round(fromState(scale, param, stateValue))
	const intensitySuffix = levelSuffix(scale, 'intensity')
	const intensityStep = scale === 'dmx' ? 25 : 10
	const intensityRotaryStep = scale === 'dmx' ? 10 : 5

	const button = (
		suffix: string,
		name: string,
		text: string,
		bgcolor: number,
		action: PresetAction | null,
		feedbacks: PresetFeedback[],
	): string => {
		const id = `${sectionId}_${suffix}`
		presets[id] = {
			type: 'simple',
			name: `${label}: ${name}`,
			style: buttonStyle(text, bgcolor),
			steps: action ? [{ down: [action], up: [] }] : [],
			feedbacks,
		}
		return id
	}

	const rotary = (
		suffix: string,
		name: string,
		text: string,
		adjust: (delta: number) => PresetAction,
		step: number,
		keywords: string[],
	): string => {
		const id = `${sectionId}_${suffix}`
		presets[id] = {
			type: 'simple',
			name: `${label}: ${name} (rotary)`,
			style: buttonStyle(text, GREY),
			previewStyle: { text: line('Rotary') },
			steps: [{ down: [], up: [], rotate_left: [adjust(-step)], rotate_right: [adjust(step)] }],
			feedbacks: [],
			keywords: ['encoder', 'dial', 'knob', ...keywords],
		}
		return id
	}

	const control = [
		button(
			'full',
			'Full',
			line('FULL'),
			WHITE,
			{ actionId: 'set_intensity', options: { ...selection, intensity: level('intensity', 100) } },
			[
				{
					feedbackId: 'intensity_above',
					options: { ...selection, threshold: level('intensity', 99) },
					style: { bgcolor: combineRgb(0, 200, 0) },
				},
			],
		),
		button(
			'off',
			'Off',
			line('OFF'),
			BLACK,
			{ actionId: 'set_intensity', options: { ...selection, intensity: level('intensity', 0) } },
			[],
		),
		...[intensityStep, -intensityStep].map((delta) => {
			const text = `${delta > 0 ? '+' : ''}${delta}${intensitySuffix}`
			return button(
				delta > 0 ? 'up' : 'down',
				text,
				line(text),
				GREY,
				{ actionId: 'adjust_intensity', options: { ...selection, delta } },
				[],
			)
		}),
		rotary(
			'rotary',
			'Intensity',
			line(fixture ? `${v(fixture.id, 'intensity')}${intensitySuffix}` : 'INTENSITY'),
			(delta) => ({ actionId: 'adjust_intensity', options: { ...selection, delta } }),
			intensityRotaryStep,
			[],
		),
	]
	// Individual fixtures get Kelvin buttons in their CCT Controls group instead
	if (!fixture) {
		for (const cct of [3200, 5600]) {
			control.push(
				button(
					`cct${cct}`,
					`${cct}K`,
					line(`${cct}K`),
					combineRgb(255, 220, 160),
					{ actionId: 'set_cct', options: { ...selection, cct } },
					[],
				),
			)
		}
	}
	group('group', 'Control', fixture ? 'Intensity' : 'Intensity and color temperature', control)

	// Color groups only per fixture: fixtures can have different supported modes, so "all" doesn't make sense
	if (fixture) {
		const { profile } = fixture

		if (profile.modeChannel) {
			group(
				'modes',
				'Color Mode',
				'Switch between CCT, HSI and RGB',
				COLOR_MODES.map((mode) =>
					button(
						`mode_${mode.id}`,
						`${mode.label} Mode`,
						line(mode.label),
						BLACK,
						{ actionId: 'set_mode', options: { fixtures: [fixture.id], mode: mode.id } },
						[
							{
								feedbackId: 'color_mode',
								options: { fixtures: [fixture.id], mode: mode.id },
								style: { bgcolor: combineRgb(0, 0, 200) },
							},
						],
					),
				),
			)
		}

		const cctLayout = profile.modes.cct
		if (cctLayout) {
			const { min, max } = profile.cctRange
			const ids = CCT_PRESETS.filter((k) => k >= min && k <= max).map((cct) =>
				button(
					`cct_${cct}`,
					`${cct}K`,
					line(`${cct}K`),
					kelvinColor(cct, min, max),
					{ actionId: 'set_cct', options: { ...selection, cct } },
					[],
				),
			)
			ids.push(
				rotary(
					'cct_rotary',
					'Color Temperature',
					line(`${v(fixture.id, 'cct')}K`),
					(delta) => ({ actionId: 'adjust_cct', options: { ...selection, delta } }),
					100,
					['kelvin'],
				),
			)
			if (cctLayout.greenMagenta) {
				for (const gm of GREEN_MAGENTA_PRESETS) {
					ids.push(
						button(
							`gm_${gm.id}`,
							gm.label,
							line(gm.text),
							gm.color,
							{ actionId: 'set_green_magenta', options: { ...selection, value: level('greenMagenta', gm.value) } },
							[],
						),
					)
				}
			}
			group(
				'cct_controls',
				'CCT Controls',
				profile.modeChannel ? 'Color temperature and green/magenta (switches to CCT mode)' : 'Color temperature',
				ids,
			)
		}

		if (profile.modes.hsi) {
			group(
				'hsi_controls',
				'HSI Controls',
				'Hue and saturation (switches to HSI mode)',
				COLOR_PRESETS.map((c) =>
					button(
						`hsi_${c.id}`,
						`HSI ${c.label}`,
						line(c.label),
						combineRgb(...c.rgb),
						{
							actionId: 'set_hsi',
							options: { ...selection, hue: c.hue, saturation: level('saturation', c.saturation) },
						},
						[],
					),
				),
			)
		}

		if (profile.modes.rgb) {
			group(
				'rgb_controls',
				'RGB Controls',
				'Red, green and blue mixes (switches to RGB mode)',
				COLOR_PRESETS.map((c) =>
					button(
						`rgb_${c.id}`,
						`RGB ${c.label}`,
						line(c.label),
						combineRgb(...c.rgb),
						{
							actionId: 'set_rgb',
							options: {
								...selection,
								red: level('red', c.rgb[0]),
								green: level('green', c.rgb[1]),
								blue: level('blue', c.rgb[2]),
							},
						},
						[],
					),
				),
			)
		}

		const statusLine = (text: string) => `${fixture.name}\\n${text}`
		const status = [
			button(
				'status_intensity',
				'current intensity',
				statusLine(`${v(fixture.id, 'intensity')}${intensitySuffix}`),
				BLACK,
				null,
				[],
			),
			button('status_cct', 'current color temperature', statusLine(`${v(fixture.id, 'cct')}K`), BLACK, null, []),
		]
		if (profile.modeChannel) {
			status.push(button('status_mode', 'current mode', statusLine(v(fixture.id, 'mode')), BLACK, null, []))
		}
		group('status', 'Status', 'Current values', status)
	}

	return { id: sectionId, name: label, definitions: groups }
}

/** Recall and save buttons for the first light preset slots */
function buildLightPresetSection(presets: CompanionPresetDefinitions<ModuleSchema>): CompanionPresetSection {
	const slots = Array.from({ length: LIGHT_PRESET_BUTTONS }, (_, i) => i + 1)
	const recallIds = slots.map((slot) => {
		const id = `light_preset_recall_${slot}`
		presets[id] = {
			type: 'simple',
			name: `Recall Light Preset ${slot}`,
			style: buttonStyle(`PRESET\\n${slot}`, GREY),
			steps: [{ down: [{ actionId: 'recall_light_preset', options: { slot } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'light_preset_active',
					options: { slot },
					style: { bgcolor: combineRgb(0, 200, 0), color: BLACK },
				},
			],
			keywords: ['scene', 'look', 'memory'],
		}
		return id
	})
	const saveIds = slots.map((slot) => {
		const id = `light_preset_save_${slot}`
		presets[id] = {
			type: 'simple',
			name: `Save Light Preset ${slot}`,
			style: buttonStyle(`SAVE\\n${slot}`, combineRgb(140, 50, 50)),
			steps: [
				{
					down: [{ actionId: 'save_light_preset', options: { target: 'all', fixtures: [], slot } }],
					up: [],
				},
			],
			feedbacks: [],
			keywords: ['store', 'scene', 'look', 'memory'],
		}
		return id
	})

	return {
		id: 'light_presets',
		name: 'Light Presets',
		definitions: [
			{
				id: 'light_presets_recall',
				name: 'Recall',
				description: 'Lit while every fixture in the preset still matches it',
				type: 'simple',
				presets: recallIds,
			},
			{
				id: 'light_presets_save',
				name: 'Save',
				description: 'Store the current state of all fixtures in the slot',
				type: 'simple',
				presets: saveIds,
			},
		],
	}
}

export function UpdatePresets(self: IkanInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}
	const scale = self.config.valueScale
	const structure = [
		buildSection(presets, scale, 'all', 'All Fixtures', null),
		...self.fixtures.fixtures.map((f) => buildSection(presets, scale, f.id, `${f.name} (DMX ${f.dmx.dmxAddress})`, f)),
		buildLightPresetSection(presets),
	]
	self.setPresetDefinitions(structure, presets)
}
