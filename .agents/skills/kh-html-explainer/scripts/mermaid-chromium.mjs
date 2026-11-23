import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// Deny network sockets in Chromium and its descendants without blocking local IPC.
const linuxNetworkFilter = `
import ctypes as c
import errno
import os
import socket
import sys

class Condition(c.Structure):
    _fields_ = [('arg', c.c_uint), ('op', c.c_int), ('a', c.c_uint64), ('b', c.c_uint64)]

lib = c.CDLL('libseccomp.so.2')
lib.seccomp_init.argtypes = [c.c_uint32]
lib.seccomp_init.restype = c.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [c.c_char_p]
lib.seccomp_rule_add_array.argtypes = [c.c_void_p, c.c_uint32, c.c_int, c.c_uint, c.POINTER(Condition)]
lib.seccomp_load.argtypes = [c.c_void_p]
lib.seccomp_release.argtypes = [c.c_void_p]

context = lib.seccomp_init(0x7fff0000)  # SCMP_ACT_ALLOW
deny = 0x00050000 | errno.EAFNOSUPPORT  # SCMP_ACT_ERRNO
local_only = Condition(0, 1, socket.AF_UNIX, 0)  # SCMP_CMP_NE
if not context:
    raise RuntimeError('seccomp_init')
try:
    for name, condition in ((b'socket', local_only), (b'socketpair', local_only), (b'io_uring_setup', None)):
        syscall = lib.seccomp_syscall_resolve_name(name)
        count = int(condition is not None)
        if syscall < 0 or lib.seccomp_rule_add_array(context, deny, syscall, count, condition) != 0:
            raise RuntimeError('seccomp_rule_add_array: ' + name.decode())
    if lib.seccomp_load(context) != 0:
        raise RuntimeError('seccomp_load')
finally:
    lib.seccomp_release(context)
os.execvp(sys.argv[1], sys.argv[1:])
`;

function isolatedCommand(executable, args) {
  if (process.platform === 'darwin') {
    return ['/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default) (deny network*)', executable, ...args]];
  }
  if (process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch)) {
    return ['python3', ['-I', '-S', '-c', linuxNetworkFilter, executable, ...args]];
  }
  throw new Error('オフラインのMermaid描画はmacOS、Linux x64、Linux arm64で利用できます');
}

async function chromiumBinary() {
  const override = process.env.KH_HTML_EXPLAINER_CHROMIUM;
  if (override) return override;
  const names = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
  const installed = process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : [];
  const path = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const file of [...installed, ...path.flatMap(dir => names.map(name => join(dir, name)))]) {
    try {
      await access(file, constants.X_OK);
      return file;
    } catch {
      // Try the next standard installation location.
    }
  }
  throw new Error('Mermaidの描画にはChromeまたはChromiumが必要です。KH_HTML_EXPLAINER_CHROMIUM に実行ファイルを指定できます');
}

export async function withOfflineChromium(render) {
  const executable = await chromiumBinary();
  const profile = await mkdtemp(join(tmpdir(), 'kh-mermaid-'));
  const args = [
    '--headless', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-extensions', '--disable-sync', '--disable-breakpad',
    '--disable-domain-reliability', '--disable-quic', '--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND',
    '--user-data-dir=' + profile, '--remote-debugging-pipe',
  ];
  if (process.env.KH_HTML_EXPLAINER_CHROMIUM_NO_SANDBOX === '1') args.push('--no-sandbox');

  // Keep service credentials and proxy environment variables out of the renderer process.
  const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'FONTCONFIG_PATH', 'FONTCONFIG_FILE']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const [command, isolatedArgs] = isolatedCommand(executable, args);
  const child = spawn(command, isolatedArgs, { env, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const [input, output] = [child.stdio[3], child.stdio[4]];
  const pending = new Map();
  let id = 0;
  let buffer = '';
  let stderr = '';
  let failure;
  let resourceRequest = false;

  function fail(error) {
    failure ??= error;
    for (const { reject } of pending.values()) reject(failure);
    pending.clear();
  }
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
  child.on('error', error => fail(new Error('Chrome/Chromiumを起動できません: ' + error.message, { cause: error })));
  const closed = new Promise(resolve => child.once('close', () => {
    let reason = 'Chrome/Chromiumの描画プロセスが終了しました';
    if (/seccomp/i.test(stderr)) reason = 'Linuxでネットワークを遮断できません。Python 3、libseccomp.so.2、seccompの利用可否を確認してください';
    else if (/sandbox/i.test(stderr)) reason = '利用可能なChrome/Chromiumのサンドボックスを確認してください';
    fail(new Error(reason));
    resolve();
  }));
  input.on('error', error => fail(error));
  output.setEncoding('utf8').on('data', chunk => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\0')) !== -1) {
      const raw = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        fail(new Error('Chrome/Chromiumから不正な応答を受け取りました', { cause: error }));
        return;
      }
      if (message.method === 'Network.requestWillBeSent') resourceRequest = true;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });

  function send(method, params = {}, sessionId) {
    if (failure) return Promise.reject(failure);
    const request = { id: ++id, method, params, sessionId };
    return new Promise((resolve, reject) => {
      pending.set(request.id, { resolve, reject });
      input.write(JSON.stringify(request) + '\0');
    });
  }

  const timer = setTimeout(() => {
    fail(new Error('Mermaidの描画が制限時間内に終わりませんでした'));
    child.kill('SIGKILL');
  }, 120_000);
  try {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => send(method, params, sessionId);
    await page('Page.enable');
    await page('Network.enable');
    await page('Network.setBlockedURLs', { urls: ['*'] });
    await page('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    const { frameTree } = await page('Page.getFrameTree');
    await page('Page.setDocumentContent', {
      frameId: frameTree.frame.id,
      // Mermaid uses local inline styles while measuring the diagram. The final HTML has a stricter CSP.
      html: '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" '
        + 'content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><body></body>',
    });
    const evaluate = async expression => {
      const { result, exceptionDetails } = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.split('\n')[0] ?? exceptionDetails.text);
      return result.value;
    };
    const result = await render(evaluate);
    if (resourceRequest) throw new Error('Mermaidの描画中にリソース読み込みが検出されました');
    return result;
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
    await closed;
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
