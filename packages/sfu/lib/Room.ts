import {types as mediasoupTypes} from 'mediasoup'
import {getMediaSoupWorker} from '../server'
import protoo from 'protoo-server'
import config from '../config'
import events from 'events'

const rooms = new Map<string, Room>()

interface handlePeerRequestSignature {
  peer: protoo.Peer
  request: any
  accept: (data?: any) => typeof data
  reject: any // todo: better typing for this
}

export default class Room extends events.EventEmitter {
  roomId: string
  closed: boolean
  protooRoom: protoo.Room
  router: mediasoupTypes.Router
  audioLevelObserver: mediasoupTypes.AudioLevelObserver

  static mediaCodecs = config.mediasoup.routerOptions.mediaCodecs
  static audioLevelObserverOptions = {
    maxEntries: 1,
    threshold: -80,
    interval: 800
  }
  static webRtcTransportOptions = config.mediasoup.webRtcTransportOptions

  static async create(roomId: string): Promise<Room> {
    /* Because constructors can't be async */
    console.log('creating a new room...')
    const protooRoom = new protoo.Room()
    const worker = getMediaSoupWorker() // rethinking this, rather do dependency injection
    const router = await worker.createRouter({mediaCodecs: Room.mediaCodecs})
    const audioLevelObserver = await router.createAudioLevelObserver(Room.audioLevelObserverOptions)
    return new Room(roomId, protooRoom, router, audioLevelObserver)
  }

  static async getCreate(roomId: string): Promise<Room> {
    if (!rooms.get(roomId)) {
      const room = await Room.create(roomId)
      rooms.set(roomId, room)
    }
    return rooms.get(roomId)
  }

  constructor(
    roomId: string,
    protooRoom: protoo.Room,
    router: mediasoupTypes.Router,
    audioLevelObserver: mediasoupTypes.AudioLevelObserver
  ) {
    super()
    this.setMaxListeners(Infinity)
    this.roomId = roomId
    this.closed = false
    this.protooRoom = protooRoom
    this.router = router
    this.audioLevelObserver = audioLevelObserver
    this.handleAudioLevelObserver()
  }

  close() {
    console.log('closing room...')
    this.closed = true
    this.protooRoom.close()
    this.router.close()
    this.emit('close')
  }

  handleAudioLevelObserver() {
    this.audioLevelObserver.on('volumes', () => {})
    this.audioLevelObserver.on('silence', () => {})
  }

  createPeer(peerId: string, transport: mediasoupTypes.Transport) {
    const existingPeer = this.protooRoom.getPeer(peerId)
    if (existingPeer) existingPeer.close()
    const peer = this.protooRoom.createPeer(peerId, transport)

    Object.assign(
      peer.data,
      {
        joined: false,
        displayName: undefined,
        device: undefined,
        rtpCapabilities: undefined,
        sctpCapabilities: undefined
      },
      {
        transports: new Map(),
        producers: new Map(),
        consumers: new Map()
      }
    )

    peer.on('close', () => console.log('handling peer close'))
    peer.on('request', (request, accept, reject) => {
      this.handlePeerRequest({peer, request, accept, reject}).catch((error) => {
        console.log('peer req failed:', error)
        reject(error)
      })
    })
  }

  async handlePeerRequest({peer, request, accept, reject}: handlePeerRequestSignature) {
    const requestHandlers = {} as {
      [method: string]: (handlePeerRequestSignature) => void
    }
    Object.assign(requestHandlers, {
      getRouterRtpCapabilities: this.getRouterRtpCapabilities,
      createWebRtcTransport: this.createWebRtcTransport,
      join: this.join,
      connectWebRtcTransport: this.connectWebRtcTransport,
      produce: this.createProducer
    })
    const handler = requestHandlers[request.method]
    if (!handler) {
      reject(500, `unknown request.method "${request.method}"`)
      return
    }
    handler({peer, request, accept, reject})
  }

  getJoinedPeers({excludePeer}: {excludePeer?: protoo.Peer} = {}) {
    return this.protooRoom.peers
      .filter((peer) => peer.data.joined)
      .filter((peer) => peer !== excludePeer)
  }

  letRoomConsumeProducer({
    newPeer,
    newProducer
  }: {
    newPeer: protoo.Peer
    newProducer: mediasoupTypes.Producer
  }) {
    console.log('creating consumer for new producer...')
    const existingPeers = this.getJoinedPeers({excludePeer: newPeer})
    for (const existingPeer of existingPeers) {
      this.createConsumer({
        consumerPeer: existingPeer,
        producerPeer: newPeer,
        producer: newProducer
      })
    }
  }

  letPeerConsumeRoom(newPeer: protoo.Peer) {
    console.log('letting peer consume room...')
    const existingPeers = this.getJoinedPeers({excludePeer: newPeer})
    for (const existingPeer of existingPeers) {
      const existingProducers = existingPeer.data.producers.values()
      for (const existingProducer of existingProducers) {
        this.createConsumer({
          consumerPeer: newPeer,
          producerPeer: existingPeer,
          producer: existingProducer
        })
      }
    }
  }

  async createConsumer({
    consumerPeer,
    producerPeer,
    producer
  }: {
    consumerPeer: protoo.Peer
    producerPeer: protoo.Peer
    producer: mediasoupTypes.Producer
  }) {
    if (!consumerPeer.data.rtpCapabilities) return
    const canConsume = this.router.canConsume({
      producerId: producer.id,
      rtpCapabilities: consumerPeer.data.rtpCapabilities
    })
    if (!canConsume) return
    const recvTransport = Array.from(consumerPeer.data.transports.values()).find(
      (transport: mediasoupTypes.Transport) => transport.appData.consuming
    ) as mediasoupTypes.Transport
    if (!recvTransport) return
    const consumer = await recvTransport.consume({
      producerId: producer.id,
      rtpCapabilities: consumerPeer.data.rtpCapabilities,
      paused: true
    })
    this.handleConsumer(consumer)
    await this.requestNewConsumer({
      producerPeer,
      producer,
      consumerPeer,
      consumer
    })
    await consumer.resume()
  }

  async requestNewConsumer({
    producerPeer,
    producer,
    consumerPeer,
    consumer
  }: {
    producerPeer: protoo.Peer
    producer: mediasoupTypes.Producer
    consumerPeer: protoo.Peer
    consumer: mediasoupTypes.Consumer
  }) {
    console.log('requesting client to accept new consumer...')
    await consumerPeer.request('newConsumer', {
      peerId: producerPeer.id,
      producerId: producer.id,
      id: consumer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      type: consumer.type,
      appData: producer.appData,
      producerPaused: consumer.producerPaused
    })
  }

  handleConsumer(consumer: mediasoupTypes.Consumer) {
    consumer.on('transportclose', () => console.log('handling transportclose'))
    consumer.on('producerclose', () => console.log('handling producerclose'))
    consumer.on('producerpause', () => console.log('handling producerpause'))
    consumer.on('producerresume', () => console.log('handling producerresume'))
    consumer.on('score', () => console.log('handling score'))
    consumer.on('layerschange', () => console.log('handling layerschange'))
  }

  notifyRoomOfNewPeer(newPeer: protoo.Peer) {
    for (const otherPeer of this.getJoinedPeers({excludePeer: newPeer})) {
      console.log('notifying of new peer:', newPeer.id)
      otherPeer
        .notify('newPeer', {
          id: newPeer.id,
          device: newPeer.device
        })
        .catch(() => {})
    }
  }

  /* Peer Request Handlers */
  getRouterRtpCapabilities = ({accept}: handlePeerRequestSignature) => {
    accept(this.router.rtpCapabilities)
  }

  createWebRtcTransport = async ({peer, request, accept}: handlePeerRequestSignature) => {
    const transport = await this.router.createWebRtcTransport({
      ...Room.webRtcTransportOptions,
      appData: request.data
    })
    const {id, iceParameters, iceCandidates, dtlsParameters, sctpParameters} = transport
    accept({
      id,
      iceParameters,
      iceCandidates,
      dtlsParameters,
      sctpParameters
    })
    peer.data.transports.set(transport.id, transport)
  }

  join = ({peer, request, accept}: handlePeerRequestSignature) => {
    if (peer.data.join) throw new Error('Peer already joined')
    const {device, rtpCapabilities} = request.data
    Object.assign(peer.data, {
      joined: true,
      device,
      rtpCapabilities
    })
    const peerInfos = this.getJoinedPeers({excludePeer: peer}).map((joinedPeer) => ({
      id: joinedPeer.id,
      device: joinedPeer.data.device
    }))
    accept({peers: peerInfos})
    this.letPeerConsumeRoom(peer)
    this.notifyRoomOfNewPeer(peer)
  }

  connectWebRtcTransport = async ({peer, request, accept}: handlePeerRequestSignature) => {
    console.log('accepting request to connect this transport...')
    const {transportId, dtlsParameters} = request.data
    const transport = peer.data.transports.get(transportId)
    if (!transport) throw new Error(`transport with id "${transportId}" not found`)
    await transport.connect({dtlsParameters})
    accept()
  }

  createProducer = async ({peer, request, accept}: handlePeerRequestSignature) => {
    console.log('creating producer...')
    if (!peer.data.joined) throw new Error('Peer not joined yet')
    const {transportId, kind, rtpParameters} = request.data
    const transport = peer.data.transports.get(transportId)
    if (!transport) throw new Error(`transport with id "${transportId}" not found`)

    const appData = Object.assign(request.data, {
      peerId: peer.id
    })
    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData
    })
    accept({id: producer.id})
    this.letRoomConsumeProducer({
      newPeer: peer,
      newProducer: producer
    })
    peer.data.producers.set(producer.id, producer)
    if (producer.kind !== 'audio') return
    this.audioLevelObserver.addProducer({producerId: producer.id}).catch(() => {})
  }
}
