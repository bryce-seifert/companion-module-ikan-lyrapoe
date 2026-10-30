import type { SomeCompanionConfigField } from '@companion-module/base'
import type { LightPresets } from './lightPresets.js'
import type { ValueScale } from './valueScale.js'

export type ProtocolSetting = 'auto' | 'artnet' | 'sacn'

export type ModuleConfig = {
	discoveryTargets: string
	discoveryInterval: number
	protocol: ProtocolSetting
	valueScale: ValueScale
	/** Saved by the light preset actions; has no config field */
	lightPresets: LightPresets
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Discovery',
			width: 12,
			value:
				'Fixtures are found with an Art-Net poll and their DMX address, universe and protocol are read from each ' +
				'fixture. List broadcast addresses and/or individual fixture IPs to poll, separated by commas.',
		},
		{
			type: 'textinput',
			id: 'discoveryTargets',
			label: 'Poll addresses',
			width: 8,
			default: '255.255.255.255',
		},
		{
			type: 'number',
			id: 'discoveryInterval',
			label: 'Re-poll every (seconds, 0 = startup only)',
			width: 4,
			min: 0,
			max: 3600,
			default: 30,
		},
		{
			type: 'dropdown',
			id: 'protocol',
			label: 'Protocol',
			width: 6,
			default: 'auto',
			choices: [
				{ id: 'auto', label: 'Auto (as configured on each fixture)' },
				{ id: 'artnet', label: 'Art-Net' },
				{ id: 'sacn', label: 'sACN' },
			],
		},
		{
			type: 'dropdown',
			id: 'valueScale',
			label: 'Value scale',
			description: 'How intensity, saturation, RGB and green/magenta are entered and displayed.',
			width: 6,
			default: 'percent',
			choices: [
				{ id: 'percent', label: 'Percentage' },
				{ id: 'dmx', label: 'DMX (0-255)' },
			],
		},
	]
}

export function parseDiscoveryTargets(value: string): string[] {
	return value
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
}
