const io = require('socket.io')()
const { SimpleSignalServer } = require('../../server/dist/index.cjs')
const signal = new SimpleSignalServer(io)

const PORT = 3000

signal.on('request', function (request) {
  request.forward()
})

signal.on('discover', function (request) {
  if (request.discoveryData === null) {
    request.discover(null)
  } else {
    request.discover('discovery metadata')
  }
})

console.log('test server running on port ' + PORT)
io.listen(PORT)
