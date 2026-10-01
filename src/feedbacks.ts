import { combineRgb } from '@companion-module/base'
import type IkanInstance from './main.js'
import {
	fixtureTargetOptions,
	modeFixturesOption,
	modeOption,
	targetsOf,
	type FixtureTargetOptions,
} from './actions.js'
import { effectiveMode, type ColorMode } from './api/index.js'
import { fromState, levelLabel, levelRange } from './valueScale.js'

export type FeedbacksSchema = {
	fixture_online: { type: 'boolean'; options: FixtureTargetOptions }
	color_mode: { type: 'boolean'; options: { fixtures: string[]; mode: ColorMode } }
	intensity_above: { type: 'boolean'; options: FixtureTargetOptions & { threshold: number } }
}

export function UpdateFeedbacks(self: IkanInstance): void {
	const scale = self.config.valueScale
	const [intensityMin, intensityMax] = levelRange(scale, 'intensity')
	self.setFeedbackDefinitions({
		fixture_online: {
			name: 'Fixture Online',
			description: 'True when the fixture answered the most recent poll (with several fixtures: every one answered)',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(0, 128, 0), color: combineRgb(255, 255, 255) },
			options: fixtureTargetOptions(self),
			callback: (feedback) => {
				const targets = targetsOf(self, feedback.options)
				return targets.length > 0 && targets.every((f) => f.online)
			},
		},
		color_mode: {
			name: 'Color Mode',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(0, 0, 200), color: combineRgb(255, 255, 255) },
			options: [modeFixturesOption(self, true), modeOption()],
			callback: (feedback) => {
				const targets = self.fixtures.getFixtures(feedback.options.fixtures)
				return (
					targets.length > 0 && targets.every((f) => effectiveMode(f.profile, f.state.mode) === feedback.options.mode)
				)
			},
		},
		intensity_above: {
			name: 'Intensity',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(0, 200, 0), color: combineRgb(0, 0, 0) },
			options: [
				...fixtureTargetOptions(self),
				{
					id: 'threshold',
					type: 'number',
					label: levelLabel(scale, 'intensity', 'Threshold'),
					default: intensityMin,
					min: intensityMin,
					max: intensityMax,
				},
			],
			callback: (feedback) => {
				const targets = targetsOf(self, feedback.options)
				return (
					targets.length > 0 &&
					targets.every((f) => fromState(scale, 'intensity', f.state.intensity) > feedback.options.threshold)
				)
			},
		},
	})
}
