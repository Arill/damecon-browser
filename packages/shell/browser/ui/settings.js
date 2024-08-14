const sendMessage = function(message, data) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({message, data}, (response) => {
            if (response?.complete) {
                resolve(response.result);
            }
            else {
                reject('settings.js failed to send message');
            }
        });
    });
};

const configStore = {
    set: async function (key, value) {
        return await sendMessage('set-config-item', {key, value});
    },
    get: async function (key) {
        return await sendMessage('get-config-item', {key});
    },
    all: async function () {
        return await sendMessage('get-config');
    },

};

const access = function(o, s) {
    s = s.replace(/\[(\w+)\]/g, '.$1'); // convert indexes to properties
    s = s.replace(/^\./, '');           // strip a leading dot
    var a = s.split('.');
    for (var i = 0, n = a.length; i < n; ++i) {
        var k = a[i];
        if (o === Object(o) && k in o) {
            o = o[k];
        } else {
            return;
        }
    }
    return o;
}

this.viewModel = function() {
    const self = this;
    self.configPages = ko.observableArray([
        {
            id: 0,
            name: 'KC3Kai',
            img: 'assets/icons/kc3kai.png'
        },
        {
            id: 1,
            name: 'Proxy',
            faIcon: 'fa-solid fa-circle-nodes'
        }
    ]);

    self.selectConfigPage = function (item) {
        self.selectedConfigPage(item.id);
    }

    self.settingsApply = async function (callback) {
        for (let [groupKey, group] of Object.entries(self.settings)) {
            for (let [key, path] of Object.entries(self.settings[groupKey])) {
                await callback(key, path);
            }
        }
    }
    self.settingsApplySync = function (callback) {
        for (let [groupKey, group] of Object.entries(self.settings)) {
            for (let [key, path] of Object.entries(self.settings[groupKey])) {
                callback(key, path);
            }
        }
    }

    self.fetchConfig = async function() {
        const config = await configStore.all();
        self.settingsApplySync((key, path) => self[key](access(config, path)));
        self.settingsInitialized(true);
    };
    self.saveConfig = async function() {
        await self.settingsApply(async (key, path) => await configStore.set(path, self[key]()));
    }

    self.kc3CheckForUpdates = async function() {
        await await sendMessage('kc3-doupdate');
    }

    self.selectedConfigPage = ko.observable(0);

    self.kc3UpdateChannels = [ 'release', 'master', 'develop' ];
    self.kc3UpdateSchedules = [ 'startup', 'daily', 'weekly', 'manual' ];

    self.settings = {
        kc3kai: {
            'kc3UpdateChannel': 'kc3kai.update.channel',
            'kc3UpdateSchedule': 'kc3kai.update.schedule',
            'kc3UpdateAuto': 'kc3kai.update.auto',
            'kc3OpenStartPage': 'kc3kai.startup.openStartPage',
            'kc3OpenDevtools': 'kc3kai.startup.openDevtools',
            'kc3OpenStratRoom': 'kc3kai.startup.openStratRoom'
        },
        proxy: {
            'proxyClientHost': 'proxy.client.host',
            'proxyClientPort': 'proxy.client.port',
            'proxyClientEnable': 'proxy.client.enable'
        }
    };
    self.settingsInitialized = ko.observable(false);

    // initialize viewmodel items
    self.settingsApplySync((key, path) => {
        self[key] = ko.observable();
        self[key].subscribe(function(newValue) {
            if (!self.settingsInitialized())
                return;
            console.log('setting changed', path, newValue)
            configStore.set(path, newValue);
        })
    });

    self.fetchConfig();
}
$(document).ready(() => ko.applyBindings(this.viewModel));