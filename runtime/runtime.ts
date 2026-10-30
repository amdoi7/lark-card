type Card = Record<string, unknown>;
type Diagnostic = { operation: string; detail: unknown };
type CompiledCard = { sourceSchema: string; card: Card & { schema: string }; attachment: unknown; warnings: unknown[] };
type Migration = { card: Card; compiled: CompiledCard; warnings: unknown[] };
type BoundaryProps = { onFailure(error: Error): void; children: unknown };
type ReactRuntime = {
  Component: new (props: BoundaryProps) => { props: BoundaryProps; state: { error: Error | null } };
  createElement(type: unknown, props: Record<string, unknown>, ...children: unknown[]): unknown;
  useLayoutEffect(effect: () => void, dependencies: unknown[]): void;
};
type CardEngine = { CardRender: unknown };
type RendererManifest = { locales: string[]; html: string; engineModule: number };
type ClientWindow = Window & typeof globalThis & {
  ShellAPI: unknown;
  LarkAPI: unknown;
  vendors_lib: { React: ReactRuntime; ReactDOM: { createRoot(element: Element): { render(value: unknown): void } } };
  feishuPreview: { render(value?: unknown): Promise<CompiledCard | Migration>; migrate(value?: unknown): Promise<CompiledCard | Migration>; manifest: RendererManifest; diagnostics: Diagnostic[] };
};

const client = window as ClientWindow;
const element = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const status = element<HTMLElement>('#status');
const editor = element<HTMLTextAreaElement>('#editor');
const variablesEditor = element<HTMLTextAreaElement>('#variables');
const eventView = element<HTMLElement>('#events');
const platform = element<HTMLSelectElement>('#platform');
const theme = element<HTMLSelectElement>('#theme');
const locale = element<HTMLSelectElement>('#locale');
const example = element<HTMLSelectElement>('#example');
const vrView = element<HTMLElement>('#compiled');
const diagnostics: Diagnostic[] = [];
const themeMediaRules: CSSMediaRule[] = [];
const samples = new Map<string, string>();
let root: { render(value: unknown): void };
let engine: CardEngine;
let React: ReactRuntime;
let RenderBoundary: unknown;
let CommittedCard: unknown;
let revision = 0, pending = true;
let lastCompilation: CompiledCard | undefined;
let lastInput: Card | undefined;

function report(operation: string, detail: unknown) {
  diagnostics.push({ operation, detail });
  if (operation === 'engine.monitor' && (detail as { type: string }).type === 'exceptionError') state('error', JSON.stringify(detail));
  eventView.textContent = diagnostics.slice(-40).map(item => JSON.stringify(item)).join('\n');
}

function state(value: string, message: string) {
  status.dataset.state = value;
  status.textContent = message;
}

function controls() {
  for (const control of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>('#controls button, #controls select, #allow-shared')) control.disabled = pending;
  editor.readOnly = pending;
  variablesEditor.readOnly = pending;
  element<HTMLButtonElement>('#export-vr').disabled = pending || !lastCompilation;
  element<HTMLButtonElement>('#export-json').disabled = pending || !lastInput;
}

async function run(operation: 'compile' | 'migrate', value: unknown = editor.value): Promise<CompiledCard | Migration> {
  if (!engine) throw Error('runtime_not_ready');
  if (pending) throw Error('preview_busy: 请等待当前编译完成');
  pending = true;
  lastCompilation = undefined;
  lastInput = undefined;
  vrView.textContent = '';
  controls();
  revision++;
  try {
    const card = typeof value === 'string' ? JSON.parse(value) : value;
    editor.value = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const variables = JSON.parse(variablesEditor.value);
    state('compiling', operation === 'migrate' ? '正在迁移全部语言并由官方编译器校验…' : '官方编译器正在生成 VR…');
    const response = await fetch(`/api/${operation}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card, variables, locale: locale.value, allowShared: element<HTMLInputElement>('#allow-shared').checked }),
      signal: AbortSignal.timeout(30000),
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(Error(`${result.code}: ${result.message}`), { code: result.code, details: result.details });
    const compiled: CompiledCard = operation === 'migrate' ? result.compiled : result;
    const publicCard: Card = operation === 'migrate' ? result.card : card;
    const warnings: unknown[] = [...(operation === 'migrate' ? result.warnings : []), ...compiled.warnings];
    for (const warning of warnings) report('compiler.warning', warning);
    state('rendering', `Card JSON ${compiled.sourceSchema} 已编译 · 原厂渲染中…`);
    for (const rule of themeMediaRules) rule.media.mediaText = theme.value === 'dark' ? 'all' : 'not all';
    document.body.dataset.theme = theme.value;
    element<HTMLElement>('#preview-card').dataset.platform = platform.value;
    const entity = {
      cardId: 'local-preview',
      version: String(revision),
      content: { card: JSON.stringify(compiled.card), attachment: compiled.attachment },
    };
    await new Promise<void>((resolve, reject) => {
      root.render(React.createElement(RenderBoundary, { key: revision, onFailure: reject }, React.createElement(CommittedCard, { entity, onCommit: resolve })));
    });
    if (status.dataset.state === 'error') throw Error(status.textContent!);
    lastCompilation = compiled;
    lastInput = publicCard;
    if (operation === 'migrate') editor.value = JSON.stringify(publicCard, null, 2);
    vrView.textContent = JSON.stringify({ card: compiled.card, attachmentMeta: compiled.attachment }, null, 2);
    state('ready', `${operation === 'migrate' ? 'V1 → V2 已转换 · ' : ''}Card JSON ${compiled.sourceSchema} → VR ${compiled.card.schema} · 原厂本地渲染${warnings.length ? ` · ${warnings.length} 条提示（见诊断）` : ''}`);
    return operation === 'migrate' ? result : compiled;
  } catch (error) {
    root.render(null);
    const failure = error as Error & { details?: unknown };
    state('error', failure.message);
    report('preview.rejected', { message: failure.message, details: failure.details });
    throw error;
  } finally {
    pending = false;
    controls();
  }
}

function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function bootstrap() {
  const manifest: RendererManifest = await (await fetch('/manifest.json')).json();
  for (const language of manifest.locales) locale.add(new Option(language, language));
  locale.value = 'zh_cn';
  const html = await (await fetch(`/vendor/messenger/${manifest.html}`)).text();
  const documentSource = new DOMParser().parseFromString(html, 'text/html');
  for (const node of documentSource.querySelectorAll('link[rel="stylesheet"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = node.getAttribute('href')!;
    await new Promise<void>((resolve, reject) => {
      link.onload = () => resolve();
      link.onerror = () => reject(Error(`stylesheet_load_failed url=${link.href}`));
      document.head.append(link);
    });
  }
  const themeSheet = [...document.styleSheets].find(sheet => sheet.href?.endsWith('/resource/theme.css'))!;
  for (const rule of themeSheet.cssRules) {
    if ('media' in rule && (rule as CSSMediaRule).media?.mediaText === '(prefers-color-scheme: dark)') themeMediaRules.push(rule as CSSMediaRule);
  }
  if (themeMediaRules.length !== 1) throw Error('native_theme_rule_unknown');
  client.ShellAPI = { app: { environment: { lang: 'zh-CN', appName: 'Feishu Local Preview' } } };
  client.LarkAPI = {};
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/vendor/messenger/i18n/entry.js';
    script.onload = () => resolve();
    script.onerror = () => reject(Error('i18n_entry_load_failed'));
    document.head.append(script);
  });
  const languageSources = [...documentSource.querySelectorAll('script[src]')]
    .map(node => node.getAttribute('src')!).filter(src => src.includes('/i18n/') && src.endsWith('-zh-CN.js'));
  await Promise.all(languageSources.map(src => new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(Error(`i18n_load_failed url=${src}`));
    document.head.append(script);
  })));
  const modules = [...documentSource.querySelectorAll('script[type="module"][src]')].map(node => node.getAttribute('src')!);
  const { __webpack_require__: require } = await import(modules[0]);
  const chunks = await Promise.all(modules.slice(1).map(src => import(src)));
  for (const chunk of chunks) require.C(chunk);
  const Engine = require(manifest.engineModule).Ay;
  React = client.vendors_lib.React;
  root = client.vendors_lib.ReactDOM.createRoot(element('#card-root'));
  const blocked = (operation: string, detail: unknown): never => {
    report(operation, detail);
    throw Error(`host_capability_unavailable operation=${operation}; 本地预览不执行远端业务`);
  };
  engine = new Engine({
    lang: 'zh-CN',
    appName: 'Feishu Local Preview',
    logger: Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message: unknown) => report(`engine.${level}`, message)])),
    monitor: (event: unknown) => report('engine.monitor', event),
    getResources: async (request: unknown) => blocked('resource.resolve', request),
    confirm: async (request: unknown) => blocked('dialog.confirm', request),
    toast: Object.fromEntries(['info', 'warn', 'error', 'success'].map(level => [level, (message: unknown) => report(`toast.${level}`, message)])),
  });
  RenderBoundary = class extends React.Component {
    constructor(props: BoundaryProps) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error: Error) { return { error }; }
    componentDidCatch(error: Error) {
      report('render.failed', error.message);
      this.props.onFailure(error);
    }
    render() { return this.state.error ? null : this.props.children; }
  };
  CommittedCard = ({ entity, onCommit }: { entity: unknown; onCommit(): void }) => {
    React.useLayoutEffect(() => { onCommit(); }, [entity, onCommit]);
    const [language, region] = locale.value.split('_');
    return React.createElement(engine.CardRender, {
      entity,
      platform: platform.value,
      theme: theme.value,
      lang: `${language}-${region.toUpperCase()}`,
      isDebugMode: true,
      openUrl: (url: unknown) => report('link.blocked', { url }),
      openProfile: (user: unknown) => report('profile.unavailable', user),
      onCardActionRequest: async (request: unknown) => blocked('card.action', request),
      onClientChannel: (event: unknown) => report('client.channel', event),
    });
  };
  element<HTMLElement>('#runtime-info').textContent = JSON.stringify(manifest, null, 2);
  await Promise.all([...example.options].map(async option => {
    const response = await fetch(option.value);
    if (!response.ok) throw Error(`sample_load_failed status=${response.status}`);
    samples.set(option.value, await response.text());
  }));
  editor.value = samples.get(example.value)!;
  client.feishuPreview = { render: value => run('compile', value), migrate: value => run('migrate', value), manifest, diagnostics };
  pending = false;
  await run('compile');
}

function fromUI(operation: 'compile' | 'migrate') {
  void run(operation).catch(() => {});
}
for (const name of ['platform', 'theme', 'locale']) element(`#${name}`).addEventListener('change', () => fromUI('compile'));
element('#render').addEventListener('click', () => fromUI('compile'));
element('#migrate').addEventListener('click', () => fromUI('migrate'));
element('#sample').addEventListener('click', () => {
  editor.value = samples.get(example.value)!;
  variablesEditor.value = '[]';
  fromUI('compile');
});
element('#export-vr').addEventListener('click', () => download({ card: lastCompilation!.card, attachmentMeta: lastCompilation!.attachment }, `card-${lastCompilation!.sourceSchema}.vr.json`));
element('#export-json').addEventListener('click', () => download(lastInput, `card-${lastInput!.schema ?? '1.0'}.json`));
for (const field of [editor, variablesEditor]) field.addEventListener('input', () => {
  lastCompilation = undefined;
  lastInput = undefined;
  vrView.textContent = '';
  state('edited', '输入已修改，点击编译并预览');
  controls();
});
window.addEventListener('error', event => { state('error', event.message); report('runtime.error', event.message); });
window.addEventListener('unhandledrejection', event => { state('error', String(event.reason)); report('runtime.rejection', String(event.reason)); });
bootstrap().catch((error: Error) => { state('error', error.message); report('bootstrap.failed', error.stack); });

export {};
