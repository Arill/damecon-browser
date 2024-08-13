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
    }
};

this.viewModel = async function() {
    const self = this;
    self.bindTest = ko.observable('hello!');
    const cfg = await configStore.all();
}
$(document).ready(() => ko.applyBindings(this.viewModel));