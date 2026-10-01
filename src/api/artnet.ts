import dgram from 'node:dgram'
import { DMX_SLOTS, type DmxTransport, type TransportOptions, type UniverseData } from './types.js'

export const ARTNET_PORT = 6454
export const ARTNET_ID = Buffer.from('Art-Net\0', 'ascii')
const OP_DMX = 0x5000
const PROTOCOL_VERSION = 14

function buildArtDmx(universe: number, sequence: number, data: UniverseData): Buffer {
	const packet = Buffer.alloc(18 + DMX_SLOTS)
	ARTNET_ID.copy(packet, 0)
	packet.writeUInt16LE(OP_DMX, 8)
	packet.writeUInt16BE(PROTOCOL_VERSION, 10)
	packet[12] = sequence
	packet[13] = 0 // physical port
	// 15-bit port-address: net (7 bits) : sub-net (4) : universe (4)
	packet[14] = universe & 0xff
	packet[15] = (universe >> 8) & 0x7f
	packet.writeUInt16BE(DMX_SLOTS, 16)
	packet.set(data.subarray(0, DMX_SLOTS), 18)
	return packet
}

export class ArtNetTransport implements DmxTransport {
	#socket: dgram.Socket | null = null
	#universes = new Map<number, UniverseData>()
	#sequence = 0
	#refreshTimer: NodeJS.Timeout | null = null
	readonly #host: string
	readonly #refreshIntervalMs: number

	constructor(options: TransportOptions) {
		this.#host = options.host
		this.#refreshIntervalMs = options.refreshIntervalMs
	}

	async start(): Promise<void> {
		if (this.#socket) return
		const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
		await new Promise<void>((resolve, reject) => {
			socket.once('error', reject)
			socket.bind(() => {
				socket.off('error', reject)
				resolve()
			})
		}).catch((e: unknown) => {
			socket.close()
			throw e
		})
		this.#socket = socket
		this.#refreshTimer = setInterval(() => this.#sendAll(), this.#refreshIntervalMs)
		// Slots set while the socket was binding were buffered but not sent
		this.#sendAll()
	}

	stop(): void {
		if (this.#refreshTimer) clearInterval(this.#refreshTimer)
		this.#refreshTimer = null
		this.#socket?.close()
		this.#socket = null
	}

	setSlots(universe: number, address: number, values: ArrayLike<number>): void {
		let buf = this.#universes.get(universe)
		if (!buf) {
			buf = new Uint8Array(DMX_SLOTS)
			this.#universes.set(universe, buf)
		}
		buf.set(values, address - 1)
		this.#send(universe, buf)
	}

	#sendAll(): void {
		for (const [universe, data] of this.#universes) this.#send(universe, data)
	}

	#send(universe: number, data: UniverseData): void {
		if (!this.#socket) return
		// Sequence 0 means "disabled" in the spec, so wrap 1..255
		this.#sequence = (this.#sequence % 255) + 1
		this.#socket.send(buildArtDmx(universe, this.#sequence, data), ARTNET_PORT, this.#host)
	}
}
