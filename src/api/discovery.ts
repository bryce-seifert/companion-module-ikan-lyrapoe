import dgram from 'node:dgram'
import type { EventEmitter } from 'node:events'
import { ARTNET_ID, ARTNET_PORT } from './artnet.js'
import { fetchFixtureDmxConfig, type FixtureDmxConfig } from './http.js'

const OP_POLL = 0x2000
const OP_POLL_REPLY = 0x2100

interface ArtNetNode {
	ip: string
	mac: string
	/** The fixture model, e.g. "LCX10-POE" */
	longName: string
}

export interface DiscoveredFixture extends ArtNetNode {
	/** null when the fixture's web API could not be reached (e.g. password protected) */
	dmx: FixtureDmxConfig | null
}

/**
 * Minimal socket surface needed for discovery, satisfied by both `node:dgram` and Companion's
 * shared UDP socket (which lets several connections listen on 6454 at once).
 */
export interface DiscoverySocket extends EventEmitter {
	bind(port: number, callback?: () => void): void
	send(msg: Buffer, port: number, address: string): void
	close(callback?: () => void): void
	setBroadcast?(flag: boolean): void
}

export function createDgramDiscoverySocket(): DiscoverySocket {
	return dgram.createSocket({ type: 'udp4', reuseAddr: true })
}

export interface DiscoveryOptions {
	createSocket: () => DiscoverySocket
	/** How long to listen for replies */
	timeoutMs: number
	/** Broadcast the poll this many times — replies to a single poll are occasionally dropped */
	pollCount: number
	/** Only broadcast addresses; a fixture IP can be given to poll one node directly */
	targets: string[]
	/** Timeout for the per-fixture HTTP config fetch */
	httpTimeoutMs: number
}

function buildArtPoll(): Buffer {
	return Buffer.concat([ARTNET_ID, Buffer.from([OP_POLL & 0xff, OP_POLL >> 8, 0x00, 0x0e, 0x02, 0x00])])
}

function parseArtPollReply(msg: Buffer, fromIp: string): ArtNetNode | null {
	if (msg.length < 207 || !msg.subarray(0, 8).equals(ARTNET_ID)) return null
	if (msg.readUInt16LE(8) !== OP_POLL_REPLY) return null
	const cstr = (start: number, end: number) => msg.toString('ascii', start, end).replace(/\0.*$/s, '')
	return {
		ip: fromIp,
		mac: [...msg.subarray(201, 207)].map((b) => b.toString(16).padStart(2, '0')).join(':'),
		longName: cstr(44, 108),
	}
}

/** Broadcast ArtPoll and collect every node that replies, keyed by IP */
async function discoverArtNetNodes(options: DiscoveryOptions): Promise<ArtNetNode[]> {
	const nodes = new Map<string, ArtNetNode>()
	const socket = options.createSocket()
	socket.on('message', (msg: Buffer, rinfo: { address: string }) => {
		const node = parseArtPollReply(msg, rinfo.address)
		if (node) nodes.set(node.ip, node)
	})

	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Timed out binding discovery socket')), options.timeoutMs)
			socket.once('error', reject)
			// Art-Net 4 nodes reply to the poll's source port, so an ephemeral port avoids
			// contending for 6454 with other Art-Net receivers on this host
			socket.bind(0, () => {
				clearTimeout(timer)
				socket.off('error', reject)
				socket.setBroadcast?.(true)
				resolve()
			})
		})

		const poll = buildArtPoll()
		const gap = Math.max(50, Math.floor(options.timeoutMs / (options.pollCount + 1)))
		for (let i = 0; i < options.pollCount; i++) {
			for (const target of options.targets) socket.send(poll, ARTNET_PORT, target)
			await new Promise((r) => setTimeout(r, gap))
		}
		await new Promise((r) => setTimeout(r, gap))
	} finally {
		socket.close()
	}

	return [...nodes.values()]
}

/** Discover nodes and enrich each with its DMX address/protocol from the fixture's web API */
export async function discoverFixtures(options: DiscoveryOptions): Promise<DiscoveredFixture[]> {
	const nodes = await discoverArtNetNodes(options)
	return Promise.all(
		nodes.map(async (node) => ({
			...node,
			dmx: await fetchFixtureDmxConfig(node.ip, options.httpTimeoutMs).catch(() => null),
		})),
	)
}
