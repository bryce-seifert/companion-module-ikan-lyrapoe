import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, parseDiscoveryTargets, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { FixtureManager, type ManagedFixture, type StatePatch } from './fixtureManager.js'
import { createDgramDiscoverySocket } from './api/index.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

const DISCOVERY_TIMEOUT_MS = 2000

export default class IkanInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	fixtures!: FixtureManager

	#discoveryTimer: NodeJS.Timeout | null = null
	#discovering = false
	#lastStatusSummary: string | null = null

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config
		this.fixtures = new FixtureManager({
			createSocket: createDgramDiscoverySocket,
			log: (level, message) => this.log(level, message),
			onFixturesChanged: () => this.#fixturesChanged(),
		})
		this.fixtures.setProtocolSetting(config.protocol)
		this.#fixturesChanged()

		this.updateStatus(InstanceStatus.Connecting, 'Searching for fixtures')
		// Discovery takes a few seconds; init must return promptly so it runs in the background
		void this.discover()
		this.#scheduleDiscovery()
	}

	async destroy(): Promise<void> {
		this.#stopDiscoveryTimer()
		this.fixtures.destroy()
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		const scaleChanged = config.valueScale !== this.config.valueScale
		this.config = config
		// Option ranges, preset values and variable values are all in the chosen scale
		if (scaleChanged) this.#fixturesChanged()
		this.fixtures.setProtocolSetting(config.protocol)
		this.#scheduleDiscovery()
		void this.discover()
	}

	/** Poll the network for fixtures; refreshes the fixture list and status */
	async discover(): Promise<void> {
		if (this.#discovering) return
		this.#discovering = true
		try {
			const changed = await this.fixtures.discover(
				parseDiscoveryTargets(this.config.discoveryTargets),
				DISCOVERY_TIMEOUT_MS,
			)
			const all = this.fixtures.fixtures
			const online = all.filter((f) => f.online).length
			// updateStatus is logged by Companion every call, so only report when the counts change
			const summary = `${online}/${all.length}`
			if (summary !== this.#lastStatusSummary) {
				this.#lastStatusSummary = summary
				if (all.length === 0) this.updateStatus(InstanceStatus.Disconnected, 'No fixtures found')
				else if (online < all.length)
					this.updateStatus(InstanceStatus.UnknownWarning, `${online}/${all.length} fixtures online`)
				else this.updateStatus(InstanceStatus.Ok, `${all.length} fixture${all.length === 1 ? '' : 's'}`)
			}
			if (changed) this.checkFeedbacks('fixture_online')
		} catch (e) {
			this.#lastStatusSummary = null
			this.updateStatus(InstanceStatus.UnknownError, `Discovery failed: ${String(e)}`)
			this.log('error', `Discovery failed: ${String(e)}`)
		} finally {
			this.#discovering = false
		}
	}

	/** Update fixture state, transmit it, and refresh variables/feedbacks */
	applyState(fixtures: ManagedFixture[], patch: StatePatch): void {
		this.fixtures.updateState(fixtures, patch)
		UpdateVariableValues(this, fixtures)
		this.checkFeedbacks('color_mode', 'intensity_above')
	}

	#stopDiscoveryTimer(): void {
		if (this.#discoveryTimer) clearInterval(this.#discoveryTimer)
		this.#discoveryTimer = null
	}

	#scheduleDiscovery(): void {
		this.#stopDiscoveryTimer()
		if (this.config.discoveryInterval > 0) {
			this.#discoveryTimer = setInterval(() => void this.discover(), this.config.discoveryInterval * 1000)
		}
	}

	#fixturesChanged(): void {
		// Fixture dropdowns are baked into the definitions, so re-export them
		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		UpdateVariableValues(this, this.fixtures.fixtures)
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}
}
