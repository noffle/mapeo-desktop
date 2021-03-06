var electronInstaller = require('electron-winstaller')
var mkdirp = require('mkdirp').sync
var rimraf = require('rimraf').sync
var path = require('path')

var distFolder = path.join(__dirname, '..', 'dist')
var pkg = require(path.join('..', 'package.json'))
var buildFolder = path.join(distFolder, 'Mapeo-win32-x64')
var installerFolder = path.join(distFolder, 'installer-win-x64')

rimraf(installerFolder)
mkdirp(installerFolder)

electronInstaller.createWindowsInstaller({
  appDirectory: buildFolder,
  outputDirectory: installerFolder,

  usePackageJson: false,

  description: pkg.productDescription,
  authors: pkg.author,
  name: 'Mapeo',
  exe: 'Mapeo.exe',
  setupExe: 'Installar_Mapeo_' + pkg.version + '_Windows.exe',
  iconUrl: 'https://raw.githubusercontent.com/digidem/mapeo-desktop/master/static/mapeo_installer.ico',
  version: pkg.version,
  title: 'mapeo',
}).then(function () {
  console.log('It worked!')
}).catch(function (e) {
  console.error(`No dice: ${e.message}`)
})
