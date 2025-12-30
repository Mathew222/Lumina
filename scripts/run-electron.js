const { spawn } = require('child_process');
const electron = require('electron');
const path = require('path');

// Explicitly unset the variable that causes Electron to run as Node
delete process.env.ELECTRON_RUN_AS_NODE;

// electron is a string path in this environment (due to the bug we are working around)
// If it resolves to object (fixed env), we need electron.toString() or similar? 
// No, if it resolves to object, we can't spawn it easily?
// Wait, if we fix the env, require('electron') might return the object?
// BUT we are running this script using 'node', so require('electron') will return path string (npm package).
// 'electron' npm package always returns path string when running in Node.
// So this is safe!

console.log('Spawning Electron from:', electron);

const child = spawn(electron, ['.'], {
    stdio: 'inherit',
    env: process.env,
    cwd: path.resolve(__dirname, '..')
});

child.on('close', (code) => {
    process.exit(code);
});
