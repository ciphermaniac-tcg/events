// Builds the TOM bridge helper jar that the desktop app injects into TOM.
// Usage: node native/tom-bridge/build.mjs          writes the jar
//        node native/tom-bridge/build.mjs --test   runs the headless tests instead
// Needs a JDK 17 or newer: javac, jar and java from JAVA_HOME/bin, or from PATH.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceRoot = join(here, 'src');
const testRoot = join(here, 'test');
const output = join(here, '..', 'src-tauri', 'resources', 'tom-bridge.jar');

function tool(name) {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', name + suffix) : name;
}

function javaSources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return javaSources(path);
    }
    return entry.name.endsWith('.java') ? [path] : [];
  });
}

function compile(classes, roots) {
  const sources = roots.flatMap(javaSources);
  execFileSync(tool('javac'), ['--release', '17', '-Xlint:all', '-Werror', '-d', classes, ...sources], {
    stdio: 'inherit'
  });
}

function writeJar(classes) {
  compile(classes, [sourceRoot]);
  cpSync(join(sourceRoot, 'META-INF'), join(classes, 'META-INF'), { recursive: true });
  mkdirSync(dirname(output), { recursive: true });
  execFileSync(tool('jar'), ['--create', '--file', output, '-C', classes, '.'], { stdio: 'inherit' });
  console.log(`Wrote ${output}`);
}

function runTests(classes) {
  compile(classes, [sourceRoot, testRoot]);
  execFileSync(tool('java'), ['-Djava.awt.headless=true', '-cp', classes, 'com.ciphermaniac.tombridge.BridgeTest'], {
    stdio: 'inherit'
  });
}

const classes = mkdtempSync(join(tmpdir(), 'tom-bridge-'));
try {
  if (process.argv.includes('--test')) {
    runTests(classes);
  } else {
    writeJar(classes);
  }
} finally {
  rmSync(classes, { recursive: true, force: true });
}
