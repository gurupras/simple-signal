import { describe, test, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Server, Socket } from 'socket.io'
import { SimpleSignalServer } from '../src/index.js'
import { createMockSocketPair } from '@gurupras/test-helpers'
import { MockSocket } from '@gurupras/test-helpers/fake-socket.io-sockets.js'

class MockServer extends EventEmitter {
  sockets: Socket[] = []
  on = super.on.bind(this)

  simulateConnection () {
    const { serverSocket, clientSocket } = createMockSocketPair()
    this.emit('connection', serverSocket)
    return { serverSocket, clientSocket }
  }
}

describe('SimpleSignalServer', () => {
  let io: MockServer
  let server: SimpleSignalServer
  let serverSocket: MockSocket
  let clientSocket: MockSocket

  beforeEach(() => {
    io = new MockServer()
    server = new SimpleSignalServer(io as unknown as Server)
    ;({ serverSocket, clientSocket } = io.simulateConnection())
  })

  test('should call discover immediately if no discover listeners are registered', async () => {
    clientSocket.emit('simple-signal[discover]', { foo: 'bar' })
    await Promise.resolve()
    expect(serverSocket.removeAllListeners).toHaveBeenCalledWith('simple-signal[offer]')
    expect(serverSocket.emit).toHaveBeenCalledWith('simple-signal[discover]', {
      id: serverSocket.id,
      discoveryData: {},
    })
  })

  test('should emit "discover" if discover listener is registered', () => {
    const discoverHandler = vi.fn((req) => req.discover())
    server.on('discover', discoverHandler)

    clientSocket.emit('simple-signal[discover]', { info: 'data' })

    expect(discoverHandler).toHaveBeenCalled()
    expect(serverSocket.emit).toHaveBeenCalledWith('simple-signal[discover]', {
      id: serverSocket.id,
      discoveryData: {},
    })
  })

  test('should forward offers if no request listener is registered', () => {
    const targetId = 'target-socket-id'
    const broadcastToResult = {
      emit: vi.fn(),
    }
    serverSocket.broadcast.to = vi.fn().mockReturnValue(broadcastToResult)

    const payload = {
      sessionId: 'sess123',
      signal: { type: 'offer' },
      target: targetId,
      metadata: { role: 'initiator' },
    }

    clientSocket.emit('simple-signal[discover]', {})
    clientSocket.emit('simple-signal[offer]', payload)

    expect(serverSocket.broadcast.to).toHaveBeenCalledWith(targetId)
    expect(broadcastToResult.emit).toHaveBeenCalledWith('simple-signal[offer]', {
      initiator: serverSocket.id,
      sessionId: payload.sessionId,
      signal: payload.signal,
      metadata: payload.metadata,
    })
  })

  test('should emit "request" event if request listener is registered', () => {
    const handler = vi.fn((req) => req.forward())
    server.on('request', handler)

    const broadcastToResult = {
      emit: vi.fn(),
    }
    serverSocket.broadcast.to = vi.fn().mockReturnValue(broadcastToResult)

    const payload = {
      sessionId: 'sess123',
      signal: { type: 'offer' },
      target: 'target-id',
      metadata: { custom: true },
    }

    clientSocket.emit('simple-signal[discover]', {})
    clientSocket.emit('simple-signal[offer]', payload)

    expect(handler).toHaveBeenCalled()
    expect(serverSocket.broadcast.to).toHaveBeenCalledWith(payload.target)
    expect(broadcastToResult.emit).toHaveBeenCalledWith('simple-signal[offer]', {
      initiator: serverSocket.id,
      sessionId: payload.sessionId,
      signal: payload.signal,
      metadata: payload.metadata,
    })
  })

  test('should forward signal events', () => {
    const broadcastToResult = {
      emit: vi.fn(),
    }
    serverSocket.broadcast.to = vi.fn().mockReturnValue(broadcastToResult)

    const payload = {
      target: 'target-id',
      sessionId: 'sess456',
      signal: { sdp: 'v=0...' },
      metadata: { foo: 'bar' },
    }

    clientSocket.emit('simple-signal[discover]', {})
    clientSocket.emit('simple-signal[signal]', payload)

    expect(serverSocket.broadcast.to).toHaveBeenCalledWith(payload.target)
    expect(broadcastToResult.emit).toHaveBeenCalledWith('simple-signal[signal]', {
      sessionId: payload.sessionId,
      signal: payload.signal,
      metadata: payload.metadata,
    })
  })

  test('should forward reject events', () => {
    const broadcastToResult = {
      emit: vi.fn(),
    }
    serverSocket.broadcast.to = vi.fn().mockReturnValue(broadcastToResult)

    const payload = {
      target: 'target-id',
      sessionId: 'sess789',
      metadata: { reason: 'busy' },
    }

    clientSocket.emit('simple-signal[discover]', {})
    clientSocket.emit('simple-signal[reject]', payload)

    expect(serverSocket.broadcast.to).toHaveBeenCalledWith(payload.target)
    expect(broadcastToResult.emit).toHaveBeenCalledWith('simple-signal[reject]', {
      sessionId: payload.sessionId,
      metadata: payload.metadata,
    })
  })

  test('should emit disconnect event', () => {
    const disconnectHandler = vi.fn()
    server.on('disconnect', disconnectHandler)

    clientSocket.emit('disconnect')

    expect(disconnectHandler).toHaveBeenCalledWith(serverSocket)
  })
})
