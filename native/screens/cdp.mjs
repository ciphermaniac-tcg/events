// Reads a webview over the DevTools protocol. On an emulator image every
// WebView is debuggable, release builds too.
// Usage: node cdp.mjs <port> report <out.json>
//          reloads the page, collects the console and uncaught errors while
//          it loads again, and reports its address, user agent and text
//        node cdp.mjs <port> eval <expression>
//          prints the expression's value

import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const [port, command, argument] = process.argv.slice(2);
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find(target => target.type === 'page') ?? pages[0];
if (!page) {
  throw new Error('No page to inspect');
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

const events = [];
const waiting = new Map();
let nextId = 1;
socket.addEventListener('message', message => {
  const data = JSON.parse(String(message.data));
  if (data.id && waiting.has(data.id)) {
    waiting.get(data.id)(data);
    waiting.delete(data.id);
    return;
  }
  if (['Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Log.entryAdded'].includes(data.method)) {
    events.push(data);
  }
});

function send(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise(resolve => {
    waiting.set(id, resolve);
  });
}

const STATE = `JSON.stringify({
  url: location.href,
  userAgent: navigator.userAgent,
  readyState: document.readyState,
  rootChildren: document.getElementById('root')?.childElementCount ?? null,
  text: document.body?.innerText.slice(0, 400) ?? null
})`;

async function evaluate(expression) {
  const answer = await send('Runtime.evaluate', { expression, returnByValue: true });
  return answer.result?.result?.value;
}

async function report(out) {
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  const before = await evaluate(STATE);
  await send('Page.reload', { ignoreCache: true });
  await sleep(15000);
  const after = await evaluate(STATE);
  await writeFile(
    out,
    JSON.stringify({ target: { title: page.title, url: page.url }, before, after, events }, null, 2)
  );
  console.log(JSON.stringify({ before, after, events: events.length }));
}

if (command === 'eval') {
  console.log(await evaluate(argument));
} else if (command === 'pinch') {
  const scale = { x: 200, y: 400, scaleFactor: 2, relativeSpeed: 600, gestureSourceType: 'touch' };
  console.log(JSON.stringify(await send('Input.synthesizePinchGesture', scale)));
} else {
  await report(argument);
}
socket.close();
