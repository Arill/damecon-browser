import { ipcRenderer, contextBridge, webFrame } from 'electron'


export const injectIpc = () => {

    const ipc = {
      send: async function(channel, data, callback = () => {}) {
        const result = await ipcRenderer.invoke(channel, data)
        callback(result)
      },
      on: function(channel, callback) {
        ipcRenderer.on(channel, (ev, data) => callback(ev, data))
      }
    }

    //function mainWorldScript() {
      // Perform any component edits here
    //}

    try {
        contextBridge.exposeInMainWorld('ipc', ipc)
    
        // Must execute script in main world to modify custom component registry.
        //webFrame.executeJavaScript(`(${mainWorldScript}());`)
      } catch {
        // When contextIsolation is disabled, contextBridge will throw an error.
        // If that's the case, we're in the main world so we can just execute our
        // function.
        //mainWorldScript()
      }
}