import cuid from 'cuid'
import mitt, { Emitter } from 'mitt'
import SimplePeer from 'simple-peer'
import {
  Events,
  Socket,
  CustomPeer,
  SimpleSignalOptions,
  RequestData,
  ERR_CONNECTION_TIMEOUT,
  ERR_PREMATURE_CLOSE,
  Request
} from './types.js'

/**
 * SimpleSignalClient
 */
class SimpleSignalClient {
  public on: Emitter<Events>['on']
  public off: Emitter<Events>['off']
  public emit: Emitter<Events>['emit']

  public id: string | null
  public socket: Socket | null
  private readonly _connectionTimeout: number

  private _peers: Record<string, CustomPeer> | null
  private _sessionQueues: Record<string, SimplePeer.SignalData[]> | null
  private readonly _timers: Map<string, NodeJS.Timeout>

  constructor (socket: Socket, options: SimpleSignalOptions = {}) {
    const emitter = mitt<Events>()
    this.on = emitter.on
    this.off = emitter.off
    this.emit = emitter.emit

    const { connectionTimeout = 10 * 1000 } = options

    this.id = null
    this.socket = socket
    this._connectionTimeout = connectionTimeout

    this._peers = {}
    this._sessionQueues = {}
    this._timers = new Map()

    this.socket.on('simple-signal[discover]', this._onDiscover.bind(this))
    this.socket.on('simple-signal[offer]', this._onOffer.bind(this))
    this.socket.on('simple-signal[signal]', this._onSignal.bind(this))
    this.socket.on('simple-signal[reject]', this._onReject.bind(this))
  }

  private _onDiscover (data: { id: string; discoveryData: any }): void {
    this.id = data.id
    this.emit('discover', data.discoveryData)
  }

  private _onOffer ({ initiator, metadata, sessionId, signal }: { initiator: string; metadata: any; sessionId: string; signal: SimplePeer.SignalData }): void {
    if (!this._sessionQueues) return
    this._sessionQueues[sessionId] = [signal]

    const requestData: RequestData = { initiator, metadata, sessionId }
    const request: Request = {
      ...requestData,
      accept: this._accept.bind(this, requestData),
      reject: this._reject.bind(this, requestData)
    }

    this.emit('request', request)
  }

  private _accept (request: RequestData, metadata: any = {}, peerOptions: SimplePeer.Options = {}): Promise<{ peer: SimplePeer.Instance; metadata: any }> {
    if (!this._peers || !this._sessionQueues || !this.socket) {
      return Promise.reject(new Error('Client is destroyed.'))
    }

    peerOptions.initiator = false
    const peer = this._peers[request.sessionId] = new SimplePeer(peerOptions) as CustomPeer

    peer.on('signal', (signal: SimplePeer.SignalData) => {
      this.socket?.emit('simple-signal[signal]', {
        signal,
        metadata,
        sessionId: request.sessionId,
        target: request.initiator
      })
    })

    peer.once('close', () => {
      this._closePeer(request.sessionId)
    })

    // clear signaling queue
    const queue = this._sessionQueues[request.sessionId] || []
    queue.forEach(signal => {
      peer.signal(signal)
    })
    delete this._sessionQueues[request.sessionId]

    return new Promise((resolve, reject) => {
      this._onSafeConnect(peer, () => {
        this._clearTimer(request.sessionId)
        resolve({ peer, metadata: request.metadata })
      })

      peer.once('close', () => {
        reject({ metadata: { code: ERR_PREMATURE_CLOSE } })
      })

      this._startTimer(request.sessionId, metadata => {
        reject({ metadata })
        this._closePeer(request.sessionId)
      })
    })
  }

  private _reject (request: RequestData, metadata: any = {}): void {
    if (!this._sessionQueues || !this.socket) return

    // clear signaling queue
    delete this._sessionQueues[request.sessionId]
    this._clearTimer(request.sessionId)
    this.socket.emit('simple-signal[reject]', {
      metadata,
      sessionId: request.sessionId,
      target: request.initiator
    })
  }

  private _onReject ({ sessionId, metadata }: { sessionId: string; metadata: any }): void {
    const peer = this._peers?.[sessionId]
    if (peer && peer.reject) {
      peer.reject(metadata)
    }
  }

  private _onSignal ({ sessionId, signal, metadata }: { sessionId: string; signal: SimplePeer.SignalData; metadata?: any }): void {
    if (!this._peers) return
    const peer = this._peers[sessionId]
    if (peer) {
      peer.signal(signal)
      if (metadata !== undefined && peer.resolveMetadata) {
        peer.resolveMetadata(metadata)
      }
    } else if (this._sessionQueues) {
      this._sessionQueues[sessionId] = this._sessionQueues[sessionId] || []
      this._sessionQueues[sessionId].push(signal)
    }
  }

  public connect (target: string, metadata: any = {}, peerOptions: SimplePeer.Options = {}): Promise<{ peer: SimplePeer.Instance; metadata: any }> {
    if (!this.id) {
      throw new Error('Must complete discovery first.')
    }
    if (!this._peers || !this.socket) {
      return Promise.reject(new Error('Client is destroyed.'))
    }

    peerOptions.initiator = true

    const sessionId = cuid()
    let firstOffer = true
    const peer = this._peers[sessionId] = new SimplePeer(peerOptions) as CustomPeer

    peer.once('close', () => {
      this._closePeer(sessionId)
    })

    peer.on('signal', (signal: SimplePeer.SignalData) => {
      const messageType = (signal as RTCSessionDescriptionInit).sdp && firstOffer ? 'simple-signal[offer]' : 'simple-signal[signal]'
      if ((signal as RTCSessionDescriptionInit).sdp) {
        firstOffer = false
      }
      this.socket?.emit(messageType, {
        signal, metadata, sessionId, target
      })
    })

    return new Promise((resolve, reject) => {
      peer.resolveMetadata = (metadata) => {
        peer.resolveMetadata = null
        this._onSafeConnect(peer, () => {
          this._clearTimer(sessionId)
          resolve({ peer, metadata })
        })
      }

      peer.reject = (metadata) => {
        reject({ metadata })
        this._closePeer(sessionId)
      }

      peer.once('close', () => {
        reject({ metadata: { code: ERR_PREMATURE_CLOSE } })
      })

      this._startTimer(sessionId, metadata => peer.reject!(metadata))
    })
  }

  private _onSafeConnect (peer: SimplePeer.Instance, callback: (peer: SimplePeer.Instance) => void): void {
    // simple-signal caches stream and track events so they always come AFTER connect
    const cachedEvents: { name: string; args: any[] }[] = []
    function streamHandler (stream: MediaStream) {
      cachedEvents.push({ name: 'stream', args: [stream] })
    }
    function trackHandler (track: MediaStreamTrack, stream: MediaStream) {
      cachedEvents.push({ name: 'track', args: [track, stream] })
    }
    peer.on('stream', streamHandler)
    peer.on('track', trackHandler)
    peer.once('connect', () => {
      setTimeout(() => {
        peer.emit('connect') // expose missed 'connect' event to application
        setTimeout(() => {
          cachedEvents.forEach(({ name, args }) => {
            peer.emit(name as any, ...args)
          })
        }, 0)
      }, 0)
      peer.removeListener('stream', streamHandler)
      peer.removeListener('track', trackHandler)
      callback(peer)
    })
  }

  private _closePeer (sessionId: string): void {
    if (this._peers) {
      const peer = this._peers[sessionId]
      if (peer) peer.destroy()
      delete this._peers[sessionId]
    }
    this._clearTimer(sessionId)
  }

  private _startTimer (sessionId: string, cb: (metadata: { code: string }) => void): void {
    if (this._connectionTimeout !== -1) {
      const timer = setTimeout(() => {
        this._clearTimer(sessionId)
        cb({ code: ERR_CONNECTION_TIMEOUT })
      }, this._connectionTimeout)
      this._timers.set(sessionId, timer)
    }
  }

  private _clearTimer (sessionId: string): void {
    if (this._timers.has(sessionId)) {
      clearTimeout(this._timers.get(sessionId)!)
      this._timers.delete(sessionId)
    }
  }

  public discover (discoveryData: any = {}): void {
    this.socket?.emit('simple-signal[discover]', discoveryData)
  }

  public peers (): SimplePeer.Instance[] {
    if (!this._peers) return []
    return Object.values(this._peers)
  }

  public destroy (): void {
    this.socket?.close()
    this.peers().forEach(peer => peer.destroy())

    this.id = null
    this.socket = null
    this._peers = null
    this._sessionQueues = null
    this._timers.clear()
  }
}

;(SimpleSignalClient as any).SimplePeer = SimplePeer // For tests
;(SimpleSignalClient as any).ERR_CONNECTION_TIMEOUT = ERR_CONNECTION_TIMEOUT // For tests
;(SimpleSignalClient as any).ERR_PREMATURE_CLOSE = ERR_PREMATURE_CLOSE // For tests

export {
  SimplePeer,
  SimpleSignalClient,
  ERR_CONNECTION_TIMEOUT,
  ERR_PREMATURE_CLOSE
}

export default SimpleSignalClient
