const mitt = require('mitt')

class SimpleSignalServer {
  constructor (io) {
    if (!(this instanceof SimpleSignalServer)) { return new SimpleSignalServer(io) }

    const emitter = this._emitter = mitt()
    this.on = emitter.on.bind(this)
    this.off = emitter.off.bind(this)
    this.emit = emitter.emit.bind(this)

    io.on('connection', (socket) => {
      socket.on('simple-signal[discover]', this._onDiscover.bind(this, socket))
      socket.on('disconnect', this._onDisconnect.bind(this, socket))
    })
  }

  _onDiscover (socket, discoveryData) {
    const discoveryRequest = { socket, discoveryData }
    discoveryRequest.discover = (discoveryData = {}) => {
      socket.removeAllListeners('simple-signal[offer]')
      socket.removeAllListeners('simple-signal[signal]')
      socket.removeAllListeners('simple-signal[reject]')

      socket.emit('simple-signal[discover]', { id: socket.id, discoveryData })

      socket.on('simple-signal[offer]', this._onOffer.bind(this, socket))
      socket.on('simple-signal[signal]', this._onSignal.bind(this, socket))
      socket.on('simple-signal[reject]', this._onReject.bind(this, socket))
    }

    if (!this._emitter.all.get('discover')?.length) {
      discoveryRequest.discover() // defaults to using socket.id for identification
    } else {
      this.emit('discover', discoveryRequest)
    }
  }

  _onOffer (socket, { sessionId, signal, target, metadata }) {
    const request = { initiator: socket.id, target, metadata, socket }
    request.forward = (metadata = request.metadata) => {
      socket.broadcast.to(target).emit('simple-signal[offer]', {
        initiator: socket.id,
        sessionId,
        signal,
        metadata
      })
    }

    if (!this._emitter.all.get('request')?.length) {
      request.forward()
    } else {
      this.emit('request', request)
    }
  }

  _onSignal (socket, { target, sessionId, signal, metadata }) {
    // misc. signaling data is always forwarded
    socket.broadcast.to(target).emit('simple-signal[signal]', {
      sessionId, signal, metadata
    })
  }

  _onReject (socket, { target, sessionId, metadata }) {
    // rejections are always forwarded
    socket.broadcast.to(target).emit('simple-signal[reject]', {
      sessionId, metadata
    })
  }

  _onDisconnect (socket) {
    this.emit('disconnect', socket)
  }
}

module.exports = { SimpleSignalServer }
module.exports.default = SimpleSignalServer
