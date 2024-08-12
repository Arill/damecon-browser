const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('fs');
const fsAsync = fs.promises
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');

let self;

class ProcessTracker {
    name;
    processStarted; // (process)
    processProgress; // (process, stage, current, total)
    processCompleted; // (process)

    constructor(name, options) {
        this.name = name;
        this.processStarted = options.processStarted;
        this.processProgress = options.processProgress;
        this.processCompleted = options.processCompleted;
        if (this.processStarted)
            this.processStarted(name)
    }

    progress(ev) {
        if (this.processProgress)
            this.processProgress(this.name, ev.phase, ev.loaded, ev.total);
    }

    complete() {
        if (this.processCompleted)
            this.processCompleted(this.name);
    }
}

class KC3Updater {
    processOpts;

    constructor(options) {
        this.processOpts = {
            processStarted: options.onProcessStarted,
            processProgress: options.onProcessProgress,
            processCompleted: options.onProcessCompleted
        }
        self = this;
    }

    newProcess(name) {
        return new ProcessTracker(name, self.processOpts);
    }

    async update(kc3Path) {
        let updateProcess = self.newProcess('KC3 Update');
        const updatePhases = 7;
        let updatePhase = 0;
        const updateProgress = () => undefined;// updateProcess.progress('', ++updatePhase, updatePhases);

        try {
            const dir = kc3Path || path.join(process.cwd(), 'kc3kai');
            console.log(`KC3Kai location: ${dir}`);
            if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'package.json'))) {
                console.log('Cloning repo...');
                
                const kc3CloneProcess = self.newProcess('Cloning repo');
                await git.clone({
                    fs,
                    http,
                    dir,
                    onProgress: kc3CloneProcess.progress.bind(kc3CloneProcess),
                    url: 'https://github.com/kc3kai/kc3kai'
                });
                await git.checkout({ fs, http, dir, ref: 'develop' });
                kc3CloneProcess.complete();
            }
            else
                console.log('Updating existing repo...');

            updateProgress();

            console.log('Checking kc3-translations...');
            const langPath = 'src/data/lang';
            let langOk = fs.existsSync(path.join(dir, langPath, '.git'));

            updateProgress();

            // Get current commit
            let currentCommit = (await git.log({fs, dir, depth: 1}))[0];
            // Get current lang commit
            let currentLangCommit;
            if (langOk)
                currentLangCommit = (await git.log({fs, dir, filepath: langPath, depth: 1}))[0];

            updateProgress();

            // Fetch new commit info
            console.log('Updating repo info...');
            const kc3FetchProcess = self.newProcess('Checking for new commits');
            let result = await git.fetch({ fs, http, dir, onProgress: kc3FetchProcess.progress.bind(kc3FetchProcess) });
            kc3FetchProcess.complete();
            console.log(result);

            updateProgress();

            // Update branch list
            console.log('Fetching branch list...');
            let branches = await git.listBranches({ fs, dir, remote: 'origin' });
            console.log(branches);

            updateProgress();

            // Get newest commit
            let latestCommit = (await git.log({fs, dir, depth: 1}))[0];

            if (currentCommit.oid != latestCommit.oid || !langOk) {
                console.log('Pulling KC3Kai...');
                // Pull from remote
                const kc3PullProcess = self.newProcess('Pulling latest commits');
                await git.fastForward({
                    fs,
                    http,
                    dir,
                    onProgress: kc3PullProcess.progress.bind(kc3PullProcess),
                    url: 'https://github.com/kc3kai/kc3kai'
                });
                kc3PullProcess.complete();

                updateProgress();

                // Get the last commit involving lang submodule dir
                console.log('Checking kc3-translations location...');
                let latestLangCommits = await git.log({
                    fs, dir, filepath: langPath, depth: 1
                });

                updateProgress();

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
                    const tlPullProcess = self.newProcess('Updating translation repo');
                    await git.clone({
                        fs,
                        http,
                        dir: langDir,
                        onProgress: tlPullProcess.progress.bind(tlPullProcess),
                        url: 'https://github.com/kc3kai/kc3-translations',
                        ref: tlOid
                    });
                    tlPullProcess.complete();
                } // pull lang
            } // pull kc3kai


            console.log('Done.');
        }
        finally {
            updateProcess.complete();
        }
    }
}

module.exports = { KC3Updater };