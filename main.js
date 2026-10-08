import './style.css'
import { WebContainer } from '@webcontainer/api';
import { files } from './files';

/** @type {import('@webcontainer/api').WebContainer}  */
let webcontainerInstance;
let previewUrl = null;

window.addEventListener('load', async () => {
  textareaEl.value = files['index.js'].file.contents;
  textareaEl.addEventListener('input', (e) => {
    writeIndexJS(e.currentTarget.value);
  });

  // Call only once
  webcontainerInstance = await WebContainer.boot();
  await webcontainerInstance.mount(files);

  const exitCode = await installDependencies();
  if (exitCode !== 0) {
    throw new Error('Installation failed');
  };

  startDevServer();
});

async function installDependencies() {
  // Install dependencies
  const installProcess = await webcontainerInstance.spawn('npm', ['install']);
  installProcess.output.pipeTo(new WritableStream({
    write(data) {
      console.log(data);
    }
  }))
  // Wait for install command to exit
  return installProcess.exit;
}

async function startDevServer() {
  // Run `npm run start` to start the Express app
  await webcontainerInstance.spawn('npm', ['run', 'start']);

  // Wait for `server-ready` event
  webcontainerInstance.on('server-ready', (port, url) => {
    previewUrl = url;
    iframeEl.src = url;
  });
}

/**
 * @param {string} content
 */

async function writeIndexJS(content) {
  await webcontainerInstance.fs.writeFile('/index.js', content);
}

document.querySelector('#app').innerHTML = `
  <div class="container">
    <div class="editor">
      <textarea>I am a textarea</textarea>
    </div>
    <div class="preview">
      <iframe src="loading.html"></iframe>
    </div>
  </div>
`

/** @type {HTMLIFrameElement | null} */
const iframeEl = document.querySelector('iframe');

/** @type {HTMLTextAreaElement | null} */
const textareaEl = document.querySelector('textarea');

// WebMCP is optional: the editor keeps working in browsers without modelContext.
const modelContext = document.modelContext;
if (typeof modelContext?.registerTool === 'function') {
  const controller = new AbortController();
  window.addEventListener('pagehide', () => controller.abort(), { once: true });
  const tools = [
    {
      name: 'get_editor_code',
      title: 'Read the starter code',
      description: 'Returns the current contents of the visible index.js editor and whether its preview server is ready.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() { return { file: 'index.js', content: textareaEl.value, previewReady: Boolean(previewUrl), previewUrl }; },
    },
    {
      name: 'replace_editor_code',
      title: 'Replace the starter code',
      description: 'Replaces index.js in the visible editor and the current WebContainer session. This edits the running browser sandbox only; review the code before using it elsewhere.',
      inputSchema: { type: 'object', properties: { content: { type: 'string', description: 'Complete replacement JavaScript for index.js (maximum 50000 characters).' } }, required: ['content'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input) {
        if (typeof input?.content !== 'string' || input.content.length > 50000) throw new TypeError('Provide JavaScript text up to 50000 characters.');
        if (!webcontainerInstance) throw new Error('The WebContainer is still starting. Try again after the preview is ready.');
        textareaEl.value = input.content;
        await writeIndexJS(input.content);
        return { file: 'index.js', characters: input.content.length, updated: true, persistence: 'current browser session' };
      },
    },
  ];
  for (const tool of tools) modelContext.registerTool(tool, { signal: controller.signal }).catch((error) => console.warn('WebMCP registration failed:', tool.name, error));
}
