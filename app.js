#!/usr/bin/env electron

var path = require('path')
var fs = require('fs')
var minimist = require('minimist')
var electron = require('electron')
var app = electron.app  // Module to control application life.
var Menu = electron.Menu
var BrowserWindow = electron.BrowserWindow  // Module to create native browser window.
var net = require('net')
var to = require('to2')
var userConfig = require('./lib/user-config')

var menuTemplate = require('./lib/menu')

if (require('electron-squirrel-startup')) return

var APP_NAME = app.getName()

var log = require('./lib/log').Node()

// Set up global node exception handler
handleUncaughtExceptions()

// Path to `userData`, operating system specific, see
// https://github.com/atom/electron/blob/master/docs/api/app.md#appgetpathname
var userDataPath = app.getPath('userData')

var argv = minimist(process.argv.slice(2), {
  default: {
    port: 5000,
    datadir: path.join(userDataPath, 'data'),
    tileport: 5005
  },
  boolean: [ 'headless', 'debug' ],
  alias: {
    p: 'port',
    t: 'tileport',
    d: 'debug'
  }
})

var oldUserDataPath = require('application-config-path')('ecuador-map-editor')
var hasOldUserData = true

try {
  fs.statSync(oldUserDataPath)
} catch (e) {
  hasOldUserData = false
}

// Migrate old data if needed
if (hasOldUserData) {
  try {
    mv(path.join(oldUserDataPath, 'data'), path.join(userDataPath, 'data'))
  } catch (e) {}
  try {
    mv(path.join(oldUserDataPath, 'tiles'), path.join(userDataPath, 'tiles'))
  } catch (e) {}
  try {
    mv(path.join(oldUserDataPath, 'imagery.json'), path.join(userDataPath, 'imagery.json'))
  } catch (e) {}
  try {
    mv(path.join(oldUserDataPath, 'presets.json'), path.join(userDataPath, 'presets.json'))
  } catch (e) {}
}

var osmdb = require('osm-p2p')
var osm = osmdb(argv.datadir)
log('preparing osm indexes..')
osm.ready(function () {
  log('osm indexes READY')
})

var createServer = require('./server.js')
var server = createServer(osm)

var pending = 2

server.listen(argv.port, '127.0.0.1', function () {
  global.osmServerHost = '127.0.0.1:' + server.address().port
  log(global.osmServerHost)
  ready()
})

var tileServer = require('./tile-server.js')()
tileServer.listen(argv.tileport, function () {
  log('tile server listening on :', server.address().port)
})

if (!argv.headless) {
  app.on('ready', ready)

  app.on('before-quit', server.shutdown)

  // Quit when all windows are closed.
  app.on('window-all-closed', function () {
    app.quit()
  })
}

var win = null
var menu = null

function ready () {
  if (--pending !== 0) return
  if (argv.headless) return
  var INDEX = 'file://' + path.resolve(__dirname, './index.html')
  win = new BrowserWindow({title: APP_NAME, show: false})
  win.once('ready-to-show', () => win.show())
  win.maximize()
  if (argv.debug) win.webContents.openDevTools()
  win.loadURL(INDEX)

  var ipc = electron.ipcMain

  require('./lib/user-config')

  ipc.on('save-file', function () {
    var metadata = userConfig.getSettings('metadata')
    var ext = metadata ? metadata.dataset_id : 'mapeodata'
    electron.dialog.showSaveDialog(win, {
      title: 'Crear nuevo base de datos para sincronizar',
      defaultPath: 'base-de-datos-mapeo.' + ext,
      filters: [
        { name: 'Mapeo Data (*.' + ext + ')', extensions: [ext] },
      ]
    }, onopen)

    function onopen (filename) {
      if (typeof filename === 'undefined') return
      win.webContents.send('select-file', filename)
    }
  })

  ipc.on('open-file', function () {
    var metadata = userConfig.getSettings('metadata')
    var ext = metadata ? metadata.dataset_id : 'mapeodata'
    electron.dialog.showOpenDialog(win, {
      title: 'Seleccionar base de datos para sincronizar',
      properties: [ 'openFile' ],
      filters: [
        { name: 'Mapeo Data (*.' + ext + ')', extensions: [ext] },
      ]
    }, onopen)

    function onopen (filenames) {
      if (typeof filenames === 'undefined') return
      if (filenames.length === 1) {
        var file = filenames[0]
        win.webContents.send('select-file', file)
      }
    }
  })

  ipc.on('sync-to-target', syncToTarget)

  ipc.on('zoom-to-data-get-centroid', function () {
    getGlobalDatasetCentroid(function (_, loc) {
      win.webContents.send('zoom-to-data-response', loc)
    })
  })

  ipc.on('refresh-window', function () {
    win.reload()
  })

  menu = Menu.buildFromTemplate(menuTemplate(app))
  Menu.setApplicationMenu(menu)

  // Emitted when the window is closed.
  win.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    win = null
    app.quit()
  })
}

// Move a file, but only if the old one exists and the new one doesn't
function mv (src, dst) {
  try {
    fs.statSync(src)
  } catch (e) {
    return
  }
  try {
    fs.statSync(dst)
  } catch (e) {
    fs.rename(src, dst)
  }
}

function syncToTarget (event, target) {
  log('sync to target', target)
  var socket = net.connect(target.port, target.host, onConnect)

  socket.on('error', function (err) {
    server.send('replication-error', err.message)
  })

  function onConnect () {
    log('connected to', target.name, 'to replicate dataset', target.dataset_id)
    server.replicateNetwork(socket, 'pull')
  }
}

function handleUncaughtExceptions () {
  process.on('uncaughtException', function (error) {
    log('uncaughtException in Node:', error)

    // Show a vaguely informative dialog.
    var opts = {
      type: 'error',
      buttons: [ 'OK' ],
      title: 'Error Fatal',
      message: error.message
    }
    electron.dialog.showMessageBox(win, opts, function () {
      process.exit(1)
    })
  })
}

function getGlobalDatasetCentroid (done) {
  var bbox = [[-90,90],[-180,180]]

  var stream = osm.queryStream(bbox)

  stream.pipe(to.obj(function (doc, enc, next) {
    if (doc && doc.type === 'node') {
      var loc = [Number(doc.lon), Number(doc.lat)]
      stream.unpipe(this)
      done(null, loc)
    } else {
      next()
    }
  }))
  stream.on('error', function (err) {
    done(err)
  })
}
