import mitt from 'mitt'
import { Server, Socket } from 'socket.io'

interface DiscoveryRequest {
  socket: Socket;
  discoveryData: any;
  discover: (discoveryData?: any) => void;
}

interface OfferRequest {
  initiator: string;
  target: string;
  metadata: any;
  socket: Socket;
  forward: (metadata?: any) => void;
}

class SimpleSignalServer {
  private _emitter: mitt.Emitter
  public on: mitt.Emitter['on']
  public off: mitt.Emitter['off']
  public emit: mitt.Emitter['emit']

  constructor (io: Server) {
    if (!(this instanceof SimpleSignalServer)) {
      return new SimpleSignalServer(io)
    }

    const emitter = (this._emitter = mitt())
    this.on = emitter.on.bind(this)
    this.off = emitter.off.bind(this)
    this.emit = emitter.emit.bind(this)

    io.on('connection', (socket: Socket) => {
      socket.on('simple-signal[discover]', this._onDiscover.bind(this, socket))
      socket.on('disconnect', this._onDisconnect.bind(this, socket))
    })
  }

  _onDiscover (socket: Socket, discoveryData: any) {
    const discoveryRequest: DiscoveryRequest = {
      socket,
      discoveryData,
      discover: (discoveryData = {}) => {
        socket.removeAllListeners('simple-signal[offer]')
        socket.removeAllListeners('simple-signal[signal]')
        socket.removeAllListeners('simple-signal[reject]')

        socket.emit('simple-signal[discover]', { id: socket.id, discoveryData })

        socket.on('simple-signal[offer]', this._onOffer.bind(this, socket))
        socket.on('simple-signal[signal]', this._onSignal.bind(this, socket))
        socket.on('simple-signal[reject]', this._onReject.bind(this, socket))
      },
    }

    if (!this._emitter.all.get('discover')?.length) {
      discoveryRequest.discover() // defaults to using socket.id for identification
    } else {
      this.emit('discover', discoveryRequest)
    }
  }

  _onOffer (socket: Socket, { sessionId, signal, target, metadata }: { sessionId: string, signal: any, target: string, metadata: any }) {
    const request: OfferRequest = {
      initiator: socket.id,
      target,
      metadata,
      socket,
      forward: (metadata = request.metadata) => {
        socket.broadcast.to(target).emit('simple-signal[offer]', {
          initiator: socket.id,
          sessionId,
          signal,
          metadata,
        })
      },
    }

    if (!this._emitter.all.get('request')?.length) {
      request.forward()
    } else {
      this.emit('request', request)
    }
  }

  _onSignal (socket: Socket, { target, sessionId, signal, metadata }: { target: string, sessionId: string, signal: any, metadata: any }) {
    // misc. signaling data is always forwarded
    socket.broadcast.to(target).emit('simple-signal[signal]', {
      sessionId,
      signal,
      metadata,
    })
  }

  _onReject (socket: Socket, { target, sessionId, metadata }: { target: string, sessionId: string, metadata: any }) {
    // rejections are always forwarded
    socket.broadcast.to(target).emit('simple-signal[reject]', {
      sessionId,
      metadata,
    })
  }

  _onDisconnect (socket: Socket) {
    this.emit('disconnect', socket)
  }
}

export { SimpleSignalServer }
export default SimpleSignalServer
