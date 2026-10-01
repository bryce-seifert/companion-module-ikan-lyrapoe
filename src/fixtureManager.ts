import type { DropdownChoice } from '@companion-module/base'
import {
	createTransport,
	DEFAULT_FIXTURE_STATE,
	discoverFixtures,
	encodeFixtureState,
	getFixtureProfile,
	UNKNOWN_FIXTURE_PROFILE,
	type DiscoveredFixture,
	type DiscoverySocket,
	type DmxProtocol,
	type DmxTransport,
	type FixtureDmxConfig,
	type FixtureProfile,
	type FixtureState,
} from './api/index.js'
import type { ProtocolSetting } from './config.js'

/** Whether an action/feedback applies to every fixture, or only to the ones picked in its multi-select */
export type FixtureTarget = 'all' | 'select'

export interface ManagedFixture {
	/** Stable id derived from the MAC address */
	id: string
	ip: string
	/** Device name from the fixture's web UI; defaults to the model but the user can change it */
	name: string
	profile: FixtureProfile
	dmx: FixtureDmxConfig
	protocol: DmxProtocol
	state: FixtureState
	online: boolean
}

/** Patch to merge into each fixture's state, or a function computing one per fixture */
export type StatePatch = Partial<FixtureState> | ((fixture: ManagedFixture) => Partial<FixtureState>)

export function universeOf(fixture: ManagedFixture): number {
	return fixture.protocol === 'sacn' ? fixture.dmx.sacnUniverse : fixture.dmx.artnetUniverse
}

export interface FixtureManagerOptions {
	createSocket: () => DiscoverySocket
	log: (level: 'info' | 'warn' | 'error' | 'debug', message: string) => void
	/** Called after the fixture list changes (new fixture, or one went offline) */
	onFixturesChanged: () => void
}

export class FixtureManager {
	readonly #fixtures = new Map<string, ManagedFixture>()
	readonly #transports = new Map<string, DmxTransport>()
	readonly #options: FixtureManagerOptions
	#protocolSetting: ProtocolSetting = 'auto'
	#sorted: ManagedFixture[] | null = null

	constructor(options: FixtureManagerOptions) {
		this.#options = options
	}

	/** Sorted by DMX address, then IP */
	get fixtures(): ManagedFixture[] {
		this.#sorted ??= [...this.#fixtures.values()].sort(
			(a, b) => a.dmx.dmxAddress - b.dmx.dmxAddress || a.ip.localeCompare(b.ip, undefined, { numeric: true }),
		)
		return this.#sorted
	}

	getFixture(id: string): ManagedFixture | undefined {
		return this.#fixtures.get(id)
	}

	/**
	 * Unknown ids are skipped. The option can be switched to an expression, which may yield a single id or a
	 * comma-separated string rather than an array.
	 */
	getFixtures(ids: string[]): ManagedFixture[] {
		const value: unknown = ids
		const list = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : []
		return list.flatMap((id) => this.#fixtures.get(String(id).trim()) ?? [])
	}

	/** Resolve an action/feedback fixture selection to the fixtures it targets */
	resolveTargets(target: FixtureTarget, ids: string[]): ManagedFixture[] {
		return target === 'all' ? this.fixtures : this.getFixtures(ids)
	}

	fixtureChoices(modeSwitchingOnly: boolean): DropdownChoice<string>[] {
		return this.fixtures
			.filter((f) => !modeSwitchingOnly || f.profile.modeChannel)
			.map((f) => ({
				id: f.id,
				label: `${f.name} (${f.ip}, DMX ${f.dmx.dmxAddress})${f.online ? '' : ' [offline]'}`,
			}))
	}

	setProtocolSetting(setting: ProtocolSetting): void {
		if (setting === this.#protocolSetting) return
		this.#protocolSetting = setting
		for (const fixture of this.#fixtures.values()) {
			fixture.protocol = this.#resolveProtocol(fixture.dmx)
			this.#applyState(fixture)
		}
		this.#pruneTransports()
	}

	/** Poll for fixtures; resolves to whether anything about the fixture list changed */
	async discover(targets: string[], timeoutMs: number): Promise<boolean> {
		const found = await discoverFixtures({
			createSocket: this.#options.createSocket,
			targets,
			timeoutMs,
			pollCount: 3,
			httpTimeoutMs: 3000,
		})

		const seen = new Set<string>()
		let changed = false
		for (const node of found) {
			const id = fixtureId(node)
			seen.add(id)
			const existing = this.#fixtures.get(id)
			if (!node.dmx) {
				if (!existing) {
					this.#options.log('warn', `Found ${node.longName} at ${node.ip} but could not read its DMX config`)
				}
				continue
			}
			if (existing) {
				const dmxChanged = JSON.stringify(existing.dmx) !== JSON.stringify(node.dmx)
				if (existing.name !== node.longName) {
					existing.name = node.longName
					// Keep the known profile if the new name no longer mentions the model; the hardware hasn't changed
					existing.profile = getFixtureProfile(node.longName) ?? existing.profile
					changed = true
				}
				if (dmxChanged || existing.ip !== node.ip || !existing.online) {
					existing.ip = node.ip
					existing.dmx = node.dmx
					existing.protocol = this.#resolveProtocol(node.dmx)
					existing.online = true
					this.#applyState(existing)
					changed = true
				}
			} else {
				const profile = getFixtureProfile(node.longName)
				if (!profile) {
					this.#options.log(
						'info',
						`Could not tell the model of "${node.longName}" at ${node.ip} from its name; showing all controls`,
					)
				}
				const fixture: ManagedFixture = {
					id,
					ip: node.ip,
					name: node.longName,
					profile: profile ?? UNKNOWN_FIXTURE_PROFILE,
					dmx: node.dmx,
					protocol: this.#resolveProtocol(node.dmx),
					state: { ...DEFAULT_FIXTURE_STATE },
					online: true,
				}
				this.#fixtures.set(id, fixture)
				this.#options.log(
					'info',
					`Found ${fixture.name} at ${fixture.ip} (${fixture.protocol}, DMX ${fixture.dmx.dmxAddress})`,
				)
				changed = true
			}
		}

		for (const fixture of this.#fixtures.values()) {
			if (!seen.has(fixture.id) && fixture.online) {
				fixture.online = false
				this.#options.log('warn', `${fixture.name} at ${fixture.ip} did not answer the poll`)
				changed = true
			}
		}

		if (changed) {
			this.#sorted = null
			this.#pruneTransports()
			this.#options.onFixturesChanged()
		}
		return changed
	}

	/** Merge a partial state into each target fixture and transmit */
	updateState(fixtures: ManagedFixture[], patch: StatePatch): void {
		for (const fixture of fixtures) {
			Object.assign(fixture.state, typeof patch === 'function' ? patch(fixture) : patch)
			this.#applyState(fixture)
		}
	}

	destroy(): void {
		for (const transport of this.#transports.values()) transport.stop()
		this.#transports.clear()
		this.#fixtures.clear()
		this.#sorted = null
	}

	#resolveProtocol(dmx: FixtureDmxConfig): DmxProtocol {
		return this.#protocolSetting === 'auto' ? dmx.protocol : this.#protocolSetting
	}

	#applyState(fixture: ManagedFixture): void {
		const values = encodeFixtureState(fixture.profile, fixture.state)
		this.#transportFor(fixture).setSlots(universeOf(fixture), fixture.dmx.dmxAddress, values)
	}

	#transportFor(fixture: ManagedFixture): DmxTransport {
		const key = transportKey(fixture)
		let transport = this.#transports.get(key)
		if (!transport) {
			transport = createTransport(fixture.protocol, fixture.ip)
			const started = transport
			started.start().catch((e) => {
				this.#options.log('error', `Failed to start ${key}: ${String(e)}`)
				// Forget it so the next command retries with a fresh transport instead of sending into the void
				if (this.#transports.get(key) === started) this.#transports.delete(key)
			})
			this.#transports.set(key, transport)
		}
		return transport
	}

	/** Stop transports no fixture sends to any more (its IP, protocol or universe changed), so they stop refreshing */
	#pruneTransports(): void {
		const inUse = new Set([...this.#fixtures.values()].map(transportKey))
		for (const [key, transport] of this.#transports) {
			if (!inUse.has(key)) {
				transport.stop()
				this.#transports.delete(key)
			}
		}
	}
}

/** Transports keep resending every universe they have been given, so each one serves a single fixture universe */
function transportKey(fixture: ManagedFixture): string {
	return `${fixture.protocol}:${fixture.ip}:${universeOf(fixture)}`
}

function fixtureId(node: DiscoveredFixture): string {
	return node.mac.replace(/:/g, '')
}
