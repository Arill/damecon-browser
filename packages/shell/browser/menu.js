const { Menu } = require('electron')

const setupMenu = (browser) => {
  const isMac = process.platform === 'darwin'

  const tab = () => browser.getFocusedWindow().getFocusedTab()
  const tabWc = () => tab().webContents

  // this menu is never actually visible but we can easily shove shortcuts here so hey
  // though realistically if we're gonna support the wider set of shortcuts
  // we probably should get away from using this
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          nonNativeMacOSRole: true,
          click: () => tabWc().reload(),
        },
        {
          label: 'Reload2',
          accelerator: 'F5',
          nonNativeMacOSRole: true,
          click: () => tabWc().reload(),
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+F4',
          nonNativeMacOSRole: true,
          click: () => tab().destroy(),
        },
        {
          label: 'Close Tab2',
          accelerator: 'CmdOrCtrl+W',
          nonNativeMacOSRole: true,
          click: () => tab().destroy(),
        },
        {
          label: 'Force Reload',
          accelerator: 'Shift+CmdOrCtrl+R',
          nonNativeMacOSRole: true,
          click: () => tabWc().reloadIgnoringCache(),
        },
        {
          label: 'Open devtools',
          accelerator: 'F12',
          nonNativeMacOSRole: true,
          click: () => tabWc().toggleDevTools(),
        },
        {
          label: 'Open devtools2',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          nonNativeMacOSRole: true,
          click: () => tabWc().toggleDevTools(),
        },
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          nonNativeMacOSRole: true,
          click: () => browser.getFocusedWindow().tabs.create(),          
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

module.exports = {
  setupMenu,
}
