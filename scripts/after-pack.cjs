const path = require('node:path')
const rcedit = require('rcedit')
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return
  await rcedit(path.join(context.appOutDir, 'Desktop Calendar.exe'), {
    icon: path.join(context.packager.projectDir, 'resources/generated/calendar.ico'),
    'version-string': { ProductName: 'Desktop Calendar', FileDescription: 'Local-first desktop calendar', CompanyName: '', LegalCopyright: '' }
  })
}
