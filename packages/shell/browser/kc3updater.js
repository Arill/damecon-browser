const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('fs');
const fsAsync = fs.promises
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const ProgressBar = require('electron-progressbar');

let self;
class KC3Updater {
    parentWindow;
    progressBar;
    constructor(options) {
        this.parentWindow = options.parent;
        self = this;
    }
    newProgressBar() {
        return new ProgressBar({
            indeterminate: false,
            text: 'Preparing to update...',
            detail: 'Please wait...',
            maxValue: 1.001, // prevent it from closing automatically when it reaches 100%
            browserWindow: {
                parent: self.parentWindow
            }
        });
    }
    handleGitProgress(ev) {
        self.updateProgressLabel(ev.phase, ev.loaded, ev.total);
        if (ev.total) {
            self.updateProgressBar(ev.loaded / ev.total);
        }
        else {
            self.updateProgressBar(-1);
        }
    }
    updateProgressLabel(phase, loaded, total) {
        if (total) {
            self.progressBar.text = 'Updating...';
            const progressFormatted = new Intl.NumberFormat(undefined, { maximumSignificantDigits: 3 }).format(loaded / total * 100);
            self.progressBar.detail = `${phase}: ${loaded} of ${total} (${progressFormatted}%)...`;
        }
        else {
            self.progressBar.detail = 'Just a moment.';
        }
    }

    updateProgressBar(value) {
        if (value === -1)
            self.progressBar.value = 0;
        else
            self.progressBar.value = value;
    }

    async update(kc3Path) {
        const dir = kc3Path || path.join(process.cwd(), 'kc3kai');
        console.log(`KC3Kai location: ${dir}`);
        if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'package.json'))) {
            console.log('Cloning repo...');
            self.progressBar = self.newProgressBar();
            await git.clone({
                fs,
                http,
                dir,
                onProgress: self.handleGitProgress,
                url: 'https://github.com/kc3kai/kc3kai'
            });
            await git.checkout({ fs, http, dir, ref: 'develop' });
            self.progressBar.setCompleted();
            self.progressBar.close();
        }
        else
            console.log('Updating existing repo...');

        console.log('Checking kc3-translations...');
        const langPath = 'src/data/lang';
        let langOk = fs.existsSync(path.join(dir, langPath, '.git'));


        // Get current commit
        let currentCommit = (await git.log({fs, dir, depth: 1}))[0];
        // Get current lang commit
        let currentLangCommit;
        if (langOk)
            currentLangCommit = (await git.log({fs, dir, filepath: langPath, depth: 1}))[0];

        // Fetch new commit info
        console.log('Updating repo info...');
        self.progressBar = self.newProgressBar();
        let result = await git.fetch({ fs, http, dir, onProgress: self.handleGitProgress });
        self.progressBar.setCompleted();
        self.progressBar.close();
        console.log(result);

        // Update branch list
        console.log('Fetching branch list...');
        let branches = await git.listBranches({ fs, dir, remote: 'origin' });
        console.log(branches);

        // Get newest commit
        let latestCommit = (await git.log({fs, dir, depth: 1}))[0];

        if (currentCommit.oid != latestCommit.oid || !langOk) {
            console.log('Pulling KC3Kai...');
            // Pull from remote
            self.progressBar = self.newProgressBar();
            await git.fastForward({
                fs,
                http,
                dir,
                onProgress: self.handleGitProgress,
                url: 'https://github.com/kc3kai/kc3kai'
            });
            self.progressBar.setCompleted();
            self.progressBar.close();

            // Get the last commit involving lang submodule dir
            console.log('Checking kc3-translations location...');
            let latestLangCommits = await git.log({
                fs, dir, filepath: langPath, depth: 1
            });

            console.log(`Commits: ${latestLangCommits?.length}`);
            let latestLangCommit = latestLangCommits[0];

            console.log(`current lang: ${currentLangCommit?.oid ?? '[none]'}`);
            console.log(`latest lang: ${latestLangCommit.oid}`);
            console.log(`lang dir OK: ${langOk}`);
            if (currentLangCommit?.oid != latestLangCommit.oid || !langOk) {
                console.log('Locating kc3-translations commit...');
                // get list of modified files
                let tree = await git.readTree({
                    fs, dir, oid: latestLangCommit.commit.tree, filepath: 'src/data'
                });
                let tlOid = tree.tree.find(t => t.path === 'lang').oid;

                const langDir = path.join(dir, langPath);
                await fsAsync.rm(langDir, { recursive: true, force: true });

                console.log('Pulling kc3-translations...');
                self.progressBar = self.newProgressBar();
                await git.clone({
                    fs,
                    http,
                    dir: langDir,
                    onProgress: self.handleGitProgress,
                    url: 'https://github.com/kc3kai/kc3-translations',
                    ref: tlOid,
                    depth: 1
                });
                self.progressBar.setCompleted();
                self.progressBar.close();
            } // pull lang
        } // pull kc3kai


        console.log('Done.');

    }
}

module.exports = { KC3Updater };