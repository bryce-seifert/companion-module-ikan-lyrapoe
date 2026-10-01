import dgram from 'node:dgram'
import { randomUUID } from 'node:crypto'
import { DMX_SLOTS, type DmxTransport, type TransportOptions, type UniverseData } from './types.js'

const SACN_PORT = 5568
const ACN_PACKET_ID = Buffer.from('ASC-E1.17\0\0\0', 'ascii')
const VECTOR_ROOT_E131_DATA = 0x00000004
const VECTOR_E131_DATA_PACKET = 0x00000002
const VECTOR_DMP_SET_PROPERTY = 0x02
export const SACN_DEFAULT_PRIORITY = 100

export interface SacnOptions extends TransportOptions {
	sourceName: string
	priority: number
}

/** Flags (0x7) + 12-bit length, as used by every PDU layer in E1.31 */
function flagsAndLength(length: number): number {
	return 0x7000 | (length & 0x0fff)
}

function buildE131Data(
	cid: Buffer,
	sourceName: string,
	priority: number,
	universe: number,
	sequence: number,
	data: UniverseData,
): Buffer {
	const packet = Buffer.alloc(126 + DMX_SLOTS)

	// Root layer
	packet.writeUInt16BE(0x0010, 0) // preamble size
	packet.writeUInt16BE(0x0000, 2) // postamble size
	ACN_PACKET_ID.copy(packet, 4)
	packet.writeUInt16BE(flagsAndLength(110 + DMX_SLOTS), 16)
	packet.writeUInt32BE(VECTOR_ROOT_E131_DATA, 18)
	cid.copy(packet, 22, 0, 16)

	// Framing layer
	packet.writeUInt16BE(flagsAndLength(88 + DMX_SLOTS), 38)
	packet.writeUInt32BE(VECTOR_E131_DATA_PACKET, 40)
	packet.write(sourceName.slice(0, 63), 44, 'utf8')
	packet[108] = priority
	packet.writeUInt16BE(0, 109) // synchronization address
	packet[111] = sequence
	packet[112] = 0 // options
	packet.writeUInt16BE(universe, 113)

	// DMP layer
	packet.writeUInt16BE(flagsAndLength(11 + DMX_SLOTS), 115)
	packet[117] = VECTOR_DMP_SET_PROPERTY
	packet[118] = 0xa1 // address & data type
	packet.writeUInt16BE(0, 119) // first property address
	packet.writeUInt16BE(1, 121) // address increment
	packet.writeUInt16BE(DMX_SLOTS + 1, 123) // property value count (incl. start code)
	packet[125] = 0 // DMX start code
	packet.set(data.subarray(0, DMX_SLOTS), 126)
	return packet
}

export class SacnTransport implements DmxTransport {
	#socket: dgram.Socket | null = null
	#universes = new Map<number, UniverseData>()
	#sequences = new Map<number, number>()
	#refreshTimer: NodeJS.Timeout | null = null
	readonly #cid = uuidToBuffer(randomUUID())
	readonly #host: string
	readonly #sourceName: string
	readonly #priority: number
	readonly #refreshIntervalMs: number

	constructor(options: SacnOptions) {
		this.#host = options.host
		this.#sourceName = options.sourceName
		this.#priority = options.priority
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
		const sequence = ((this.#sequences.get(universe) ?? 0) + 1) & 0xff
		this.#sequences.set(universe, sequence)
		const packet = buildE131Data(this.#cid, this.#sourceName, this.#priority, universe, sequence, data)
		this.#socket.send(packet, SACN_PORT, this.#host)
	}
}

function uuidToBuffer(uuid: string): Buffer {
	return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}
