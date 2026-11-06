import dgram from 'node:dgram'
import type { EventEmitter } from 'node:events'
import os from 'node:os'
import { ARTNET_ID, ARTNET_PORT } from './artnet.js'
import { fetchFixtureDmxConfig, type FixtureDmxConfig } from './http.js'

const OP_POLL = 0x2000
const OP_POLL_REPLY = 0x2100
const LIMITED_BROADCAST = '255.255.255.255'

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

/** Minimal socket surface needed for discovery */
export interface DiscoverySocket extends EventEmitter {
	bind(port: number, address: string | undefined, callback: () => void): void
	send(msg: Buffer, port: number, address: string, callback: (error: Error | null) => void): void
	close(): void
	setBroadcast(flag: boolean): void
}

export function createDgramDiscoverySocket(): DiscoverySocket {
	return dgram.createSocket({ type: 'udp4', reuseAddr: true })
}

interface NetworkAdapter {
	address: string
	netmask: string
}

/** Every external IPv4 address on this machine. Read per poll, so a reconnected adapter is picked up. */
export function listNetworkAdapters(): NetworkAdapter[] {
	return Object.values(os.networkInterfaces())
		.flatMap((addresses) => addresses ?? [])
		.filter((address) => address.family === 'IPv4' && !address.internal)
		.map(({ address, netmask }) => ({ address, netmask }))
}

function ipv4ToNumber(address: string): number {
	return address.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0)
}

function numberToIpv4(value: number): string {
	return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.')
}

/** The adapter's subnet broadcast address, or null for a point-to-point link (/31 or /32), which has none */
function subnetBroadcast(adapter: NetworkAdapter): string | null {
	const mask = ipv4ToNumber(adapter.netmask)
	if (mask >= 0xfffffffe) return null
	return numberToIpv4((ipv4ToNumber(adapter.address) | ~mask) >>> 0)
}

interface PollPlan {
	/** Adapter address to send from; null leaves the choice of adapter to the OS */
	bindAddress: string | null
	destinations: string[]
}

/**
 * Work out which socket sends each poll. A broadcast from an unbound socket leaves through whichever
 * single adapter the OS picks, which on a host with virtual adapters (Hyper-V, Q-SYS) may not be the one
 * the fixtures are on, so broadcasts are sent from a socket bound to each relevant adapter instead.
 *
 * `255.255.255.255` also goes out as each adapter's subnet broadcast, because some platforms may still
 * route it by the default route whatever the socket is bound to.
 */
function planPolls(targets: string[], adapters: NetworkAdapter[]): PollPlan[] {
	const destinationsBySource = new Map<string | null, Set<string>>()
	const add = (bindAddress: string | null, destination: string) => {
		const destinations = destinationsBySource.get(bindAddress) ?? new Set<string>()
		destinationsBySource.set(bindAddress, destinations.add(destination))
	}

	for (const target of targets) {
		if (target === LIMITED_BROADCAST && adapters.length > 0) {
			for (const adapter of adapters) {
				add(adapter.address, target)
				const broadcast = subnetBroadcast(adapter)
				if (broadcast) add(adapter.address, broadcast)
			}
			continue
		}

		const onSubnet = adapters.filter((adapter) => subnetBroadcast(adapter) === target)
		if (onSubnet.length > 0) {
			for (const adapter of onSubnet) add(adapter.address, target)
		} else {
			add(null, target)
		}
	}

	return [...destinationsBySource].map(([bindAddress, destinations]) => ({
		bindAddress,
		destinations: [...destinations],
	}))
}

export interface DiscoveryOptions {
	createSocket: () => DiscoverySocket
	/** How long to listen for replies */
	timeoutMs: number
	/** Broadcast the poll this many times — replies to a single poll are occasionally dropped */
	pollCount: number
	/** Broadcast addresses and/or fixture IPs to poll */
	targets: string[]
	adapters: NetworkAdapter[]
	/** Timeout for the per-fixture HTTP config fetch */
	httpTimeoutMs: number
	log: (level: 'warn' | 'debug', message: string) => void
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

async function bindSocket(socket: DiscoverySocket, address: string | undefined, timeoutMs: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const fail = (error: Error) => {
			clearTimeout(timer)
			reject(error)
		}
		const timer = setTimeout(() => {
			socket.off('error', fail)
			reject(new Error('Timed out binding discovery socket'))
		}, timeoutMs)
		socket.once('error', fail)
		// Art-Net 4 nodes reply to the poll's source port, so an ephemeral port avoids
		// contending for 6454 with other Art-Net receivers on this host
		socket.bind(0, address, () => {
			clearTimeout(timer)
			socket.off('error', fail)
			socket.setBroadcast(true)
			resolve()
		})
	})
}

/** Broadcast ArtPoll from each adapter and collect every node that replies, keyed by IP */
async function discoverArtNetNodes(options: DiscoveryOptions): Promise<ArtNetNode[]> {
	const nodes = new Map<string, ArtNetNode>()
	const plans = planPolls(options.targets, options.adapters)
	const open: { socket: DiscoverySocket; plan: PollPlan }[] = []

	// Each failure is logged once per discovery. Only a target the user listed is worth a warning:
	// a virtual or disconnected adapter failing is routine
	const reported = new Set<string>()
	const report = (plan: PollPlan, message: string) => {
		if (reported.has(message)) return
		reported.add(message)
		options.log(plan.bindAddress === null ? 'warn' : 'debug', message)
	}

	const openSocket = async (plan: PollPlan): Promise<Error | null> => {
		const source = plan.bindAddress ?? 'the default adapter'
		const socket = options.createSocket()
		socket.on('message', (msg: Buffer, rinfo: { address: string }) => {
			const node = parseArtPollReply(msg, rinfo.address)
			if (node) nodes.set(node.ip, node)
		})
		try {
			await bindSocket(socket, plan.bindAddress ?? undefined, options.timeoutMs)
		} catch (e) {
			socket.close()
			const error = e instanceof Error ? e : new Error(String(e))
			report(plan, `Could not poll from ${source}: ${error.message}`)
			return error
		}
		socket.on('error', (error: Error) => report(plan, `Poll socket on ${source} failed: ${error.message}`))
		options.log('debug', `Polling ${plan.destinations.join(', ')} from ${source}`)
		open.push({ socket, plan })
		return null
	}

	try {
		const bindResults = await Promise.all(plans.map(openSocket))
		const bindError = bindResults.find((error) => error !== null)
		if (open.length === 0 && bindError) throw bindError

		const poll = buildArtPoll()
		const gap = Math.max(50, Math.floor(options.timeoutMs / (options.pollCount + 1)))
		for (let i = 0; i < options.pollCount; i++) {
			for (const { socket, plan } of open) {
				for (const destination of plan.destinations) {
					socket.send(poll, ARTNET_PORT, destination, (error) => {
						if (error) report(plan, `Could not poll ${destination}: ${error.message}`)
					})
				}
			}
			await new Promise((r) => setTimeout(r, gap))
		}
		await new Promise((r) => setTimeout(r, gap))
	} finally {
		for (const { socket } of open) socket.close()
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
