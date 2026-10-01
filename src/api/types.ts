export type DmxProtocol = 'artnet' | 'sacn'

export const DMX_SLOTS = 512

/** A 512-slot DMX universe buffer (index 0 = slot 1) */
export type UniverseData = Uint8Array

export interface DmxTransport {
	start(): Promise<void>
	stop(): void
	/** Update a range of slots (address is 1-based) and transmit the universe */
	setSlots(universe: number, address: number, values: ArrayLike<number>): void
}

export interface TransportOptions {
	/** Fixture IP; DMX is unicast so each fixture only receives its own data */
	host: string
	/** Resend interval in ms so the fixtures keep receiving data even when nothing changes */
	refreshIntervalMs: number
}
