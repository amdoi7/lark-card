import { modules } from '/editor-registry.mjs';
import { createRequire } from './webpack.ts';
import { contentLocales, requireSchema, type CardDocument } from '../card/input.ts';

type CompiledCard = {
  card: { schema: string; newBody: { property: { elements: { property: unknown }[] } } };
  attachment: unknown;
  warnings: unknown[];
};
type EditorProject = { card: CardDocument; variables: unknown[]; compiled: CompiledCard };
type EditorState = {
  locale: string;
  uidl: unknown;
  config: Record<string, unknown> & { locales?: string[] };
  variables: unknown[];
  cardEntity: unknown;
};
type EditorI18n = {
  t: unknown;
  pY(options: { isOversea: boolean }): void;
  localI18n: {
    changeLanguage(locale: string): void;
    getResourceBundle(locale: string, namespace: string): Record<string, unknown>;
  };
};
type Subscription = { publish(source: string, value: unknown): void };
type BuilderTypes = {
  Source: { CardData: string; Host: string; IframeLoading: string; Disabled: string };
  Host: { Message: unknown };
};
type BuilderHost = {
  locales: unknown;
  sortedLocales: unknown;
  boxDrawer: unknown;
  colors: unknown;
  variables(options: unknown): unknown;
  createSubscription(initial: Record<string, unknown>): Subscription;
};
type SimulatorAsset = { name: string; contents?: unknown; url?: string[] };
type DesignerSDK = {
  initialized: boolean;
  init(root: string, props: unknown): Promise<void>;
  reset(props: unknown): Promise<void>;
  pluginManager: { getGlobalSimulatorConfig(...args: unknown[]): { assets: SimulatorAsset[] } };
};
type EditorWindow = Window & {
  CardBuilderSDKGlobalVar: unknown;
  CardBuilderGlobalState: unknown;
  PLUGIN_MANAGER_EXTERNALS: object;
  localCardKit: {
    report(operation: string, detail: unknown): void;
    diagnostics: { operation: string; detail: unknown }[];
    readonly sdk: DesignerSDK;
    settled(): Promise<CompiledCard | undefined>;
    load(card: unknown, variables: readonly unknown[], locale: string): Promise<CompiledCard>;
    exportProject(): { card: CardDocument; variables: unknown[] };
  };
};

const browser = window as unknown as EditorWindow;
const element = <T extends Element>(selector: string): T => document.querySelector<T>(selector)!;
const require = createRequire(modules);
const status = element<HTMLElement>('#local-status');
const sourceView = element<HTMLTextAreaElement>('#card-source');
const vrView = element<HTMLTextAreaElement>('#vr-source');
const localeSelect = element<HTMLSelectElement>('#card-locale');
const diagnostics: { operation: string; detail: unknown }[] = [];
let sdk: DesignerSDK,
  types: BuilderTypes,
  host: BuilderHost,
  subscription: Subscription,
  current: EditorState,
  schema: '1.0' | '2.0';
let ready = false,
  busy = false;
let revision = 0,
  pendingCompilation = Promise.resolve();
let compiledProject: EditorProject | undefined,
  lastFailure: unknown,
  originalV1Locales: Record<string, unknown> = {};

function state(value: string, text: string) {
  status.dataset.state = value;
  status.textContent = text;
}
function report(operation: string, detail: unknown) {
  diagnostics.push({ operation, detail });
  element<HTMLElement>('#diagnostics').textContent = diagnostics
    .slice(-40)
    .map((item) => JSON.stringify(item))
    .join('\n');
  if (['frame.error', 'compile.failed'].includes(operation))
    state('error', `${operation}: ${(detail as { message: string }).message}`);
}
function controls() {
  sourceView.readOnly = !ready || busy;
  for (const node of document.querySelectorAll<HTMLButtonElement | HTMLSelectElement>(
    '#local-toolbar button,#local-toolbar select,#apply-source',
  ))
    node.disabled = !ready || busy;
  for (const id of ['export-card', 'export-vr', 'save-project'])
    element<HTMLButtonElement>(`#${id}`).disabled ||= !compiledProject;
}
async function api<T>(operation: string, data: unknown): Promise<T> {
  const response = await fetch(`/api/${operation}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30000),
  });
  const result = (await response.json()) as T & { code: string; message: string; details: unknown };
  if (!response.ok)
    throw Object.assign(Error(`${result.code}: ${result.message}`), {
      code: result.code,
      details: result.details,
    });
  return result;
}
function unavailable(operation: string) {
  return (...args: unknown[]): never => {
    report('host.unavailable', { operation, args });
    throw Error(
      `host_capability_unavailable operation=${operation}; 本地模式没有远端资源或业务授权`,
    );
  };
}
function publicCard(): CardDocument {
  const uidl =
    schema === '1.0' ? { ...originalV1Locales, [current.locale]: current.uidl } : current.uidl;
  return require<{ o1(input: unknown, version: number): { dsl: CardDocument } }>(91943).o1(
    { uidl, config: current.config, variables: current.variables },
    Number(schema),
  ).dsl;
}
function requestCompilation() {
  const version = ++revision;
  compiledProject = undefined;
  lastFailure = undefined;
  vrView.value = '';
  controls();
  state('compiling', `Card JSON ${schema} → VR 编译中…`);
  const card = publicCard();
  sourceView.value = JSON.stringify(card, null, 2);
  const variables = structuredClone(current.variables);
  const language = localeSelect.value;
  pendingCompilation = pendingCompilation.then(async () => {
    if (version !== revision) return;
    try {
      const result = await api<CompiledCard>('compile', { card, variables, locale: language });
      if (version !== revision) return;
      compiledProject = { card, variables, compiled: result };
      current.cardEntity = {
        cardDSL: result.card,
        attachment: result.attachment,
        warnings: result.warnings,
      };
      subscription.publish(types.Source.CardData, { ...current });
      vrView.value = JSON.stringify(
        { card: result.card, attachmentMeta: result.attachment },
        null,
        2,
      );
      result.warnings.forEach((warning) => report('compiler.warning', warning));
      if (!busy) state('ready', `Card JSON ${schema} → VR ${result.card.schema} · 本地编辑`);
    } catch (error) {
      if (version !== revision) return;
      lastFailure = error;
      current.cardEntity = { err: error };
      subscription.publish(types.Source.CardData, { ...current });
      const failure = error as Error & { details?: unknown };
      report('compile.failed', { message: failure.message, details: failure.details });
    }
    controls();
  });
  return pendingCompilation;
}
async function loadCard(input: unknown, variables: unknown = []) {
  if (busy) throw Error('editor_busy');
  busy = true;
  ++revision;
  compiledProject = undefined;
  lastFailure = undefined;
  controls();
  state('loading', '官方 JSON → UIDL → 原厂编辑器…');
  try {
    if (!Array.isArray(variables)) throw Error('variables 必须是官方变量描述数组');
    const version = requireSchema(input);
    const card = input as CardDocument;
    await api<CompiledCard>('compile', { card, variables, locale: localeSelect.value });
    const lowered = require<{
      hh(
        input: unknown,
        version: number,
      ): { uidl: Record<string, unknown>; config: EditorState['config'] };
    }>(752103).hh({ dsl: card, variables, defaultLocale: localeSelect.value }, Number(version));
    schema = version;
    originalV1Locales = schema === '1.0' ? lowered.uidl : {};
    const locale = Object.hasOwn(originalV1Locales, localeSelect.value)
      ? localeSelect.value
      : Object.hasOwn(originalV1Locales, 'en_us')
        ? 'en_us'
        : Object.keys(originalV1Locales)[0];
    if (schema === '1.0') localeSelect.value = locale;
    current = {
      locale: localeSelect.value,
      uidl: schema === '1.0' ? lowered.uidl[locale] : lowered.uidl,
      config: { ...lowered.config, update_multi: card.config?.update_multi ?? schema === '2.0' },
      variables,
      cardEntity: undefined,
    };
    if (schema === '2.0')
      current.config.locales = [...new Set([...contentLocales(card), current.locale])];
    const features = require<{
      getFeaturesByUserDSLVersion(input: { userDSLVersion: number }): unknown;
    }>(81091).getFeaturesByUserDSLVersion({ userDSLVersion: Number(schema) });
    const globalVar = createHost(features);
    browser.CardBuilderSDKGlobalVar = globalVar;
    const variableConfig = host.variables({
      context: {
        features,
        userDSLVersion: Number(schema),
        cardId: 'local',
        getUIDL: () => current.uidl,
      },
    });
    const manifest = [
      {
        name: `materials-msg-card-${Number(schema)}`,
        statics: [
          ['designer', 'designer.75b535a7.umd.js'],
          ['runtime', 'runtime.8529c68d.umd.js'],
          ['simulator', 'simulator.0dc8325e.umd.js'],
        ].map(([runtimeEnv, file]) => ({
          type: 'remote',
          runtimeEnv,
          fileUrl: `/cardkit/materials/${file}`,
          fileType: 'js',
        })),
      },
    ];
    const props = {
      data: { uidl: current.uidl, variables },
      globalVar,
      language: 'zh',
      manifest,
      variable: variableConfig,
      categoryOrder: [
        {
          category: '容器',
          components: ['ColumnLayout', 'Form', 'LoopContainer', 'InteractiveContainer'],
        },
        {
          category: '展示',
          components: [
            'Text',
            'Markdown',
            'Title',
            'Hr',
            'Image',
            'ImagesLayout',
            'Person',
            'PersonList',
            'Chart',
            'Table',
            'Remark',
          ],
        },
        {
          category: '交互',
          components: [
            'Input',
            'Button',
            'Overflow',
            'Select',
            'MultiSelect',
            'DatePicker',
            'TimePicker',
            'DateTimePicker',
            'PersonSelect',
            'MultiPersonSelect',
            'ButtonGroup',
          ],
        },
      ],
      metaDataModifier: (metadata: { componentName: string }[]) =>
        metadata.map((item) => ({
          ...item,
          ...(schema === '2.0' && ['Remark', 'ButtonGroup'].includes(item.componentName)
            ? { snippets: false }
            : {}),
        })),
      batchParseMarkdown: (contents: string[]) =>
        Promise.all(contents.map(globalVar.api.parseMarkdown)),
      onChange(data: { uidl: unknown; variables: unknown[] }) {
        current.uidl = data.uidl;
        current.variables = data.variables;
        void requestCompilation();
      },
      onInit(designer: {
        ui: { rightPane: { panels: { config: object; updateConfig(config: object): void }[] } };
      }) {
        const panel = designer.ui.rightPane.panels[0];
        panel.updateConfig({ ...panel.config, title: '组件配置' });
      },
    };
    if (!sdk.initialized) await sdk.init('root', props);
    else await sdk.reset(props);
    subscription.publish(types.Source.CardData, { ...current });
    await requestCompilation();
  } finally {
    busy = false;
    const project = compiledProject as EditorProject | undefined;
    if (project)
      state('ready', `Card JSON ${schema} → VR ${project.compiled.card.schema} · 本地编辑`);
    controls();
  }
}
function createHost(features: unknown) {
  const i18n = require<EditorI18n>(795190);
  return {
    lang: 'zh-CN',
    cardLocale: localeSelect.value,
    userDSLVersion: Number(schema),
    brand: 'feishu',
    env: 'local',
    features,
    subscription,
    localeMap: host.locales,
    sortedLocaleList: host.sortedLocales,
    componentBlackList: schema === '2.0' ? ['Remark', 'ButtonGroup'] : [],
    ui: {
      setters: require<{ SetterControls: unknown }>(874796).SetterControls,
      toast: require<{ Toast: unknown }>(300386).Toast,
    },
    monitor: {
      error: (...args: unknown[]) => report('engine.error', args),
      info: (...args: unknown[]) => report('engine.info', args),
      event: (...args: unknown[]) => report('engine.event', args),
    },
    report: { reportEditClickEvent: () => {}, reportEditViewEvent: () => {} },
    api: {
      t: i18n.t,
      boxDrawer: host.boxDrawer,
      recentlyUsedColorManager: host.colors,
      generateDynamicString: require<{ Id: unknown }>(832611).Id,
      getLocales: () => current.config.locales || [localeSelect.value],
      getCardConfig: () => current.config,
      updateCardConfig(config: EditorState['config']) {
        current.config = config;
        void requestCompilation();
      },
      async parseMarkdown(content: string) {
        const result = await api<CompiledCard>('compile', {
          card: { schema: '1.0', body: { elements: [{ tag: 'markdown', content }] } },
          variables: [],
          locale: localeSelect.value,
        });
        return result.card.newBody.property.elements[0].property;
      },
      async getFullAttachement(metadata: unknown) {
        report('resource.unresolved', metadata);
        return { images: {}, atUsers: {}, characters: {} };
      },
      async requestLocalResource(packet: { cmd: number }) {
        report('resource.local-query', { cmd: packet.cmd, scope: '内置资源；无租户自定义表情' });
        switch (packet.cmd) {
          case 141:
            return { source: 'local', isError: false, data: { emojisOrder: [] } };
          case 142:
          case 143:
            return { source: 'local', isError: false, data: { emojiResourceSet: [] } };
          default:
            return unavailable('resource.command')(packet.cmd);
        }
      },
      uploadImage: unavailable('image.upload'),
      getImageUrlByImageKey: unavailable('image.resolve'),
      getUserUnionID: () => '',
      codeTokenizer: unavailable('code.tokenize'),
      translateText: unavailable('translate'),
      openAssistant: unavailable('assistant'),
      triggerI18nOnboarding: () => {},
      collectUpdateMarkdownTask(task: () => void) {
        task();
      },
    },
    getInitUdWebOptions: () => ({
      theme: 'light',
      locale: 'zh-CN',
      appName: 'Local CardKit',
      env: 'development',
      frontier: false,
      slardar: false,
      skipFetchUser: true,
      user: {
        id: '',
        tenantId: '',
        region: 'cn',
        unit: 'cn',
        geo: 'CN',
        tenantBrand: 'feishu',
        tenantTag: 'standard',
      },
      urls: { larkAPIDomain: location.host, larkAPI: location.origin },
    }),
  };
}
function download(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
async function action(run: () => unknown | Promise<unknown>) {
  state('working', '本地操作处理中…');
  try {
    await run();
    if (status.dataset.state === 'working' && compiledProject)
      state('ready', `Card JSON ${schema} → VR ${compiledProject.compiled.card.schema} · 本地编辑`);
  } catch (error) {
    const failure = error as Error & { details?: unknown };
    state('error', failure.message);
    report('editor.rejected', { message: failure.message, details: failure.details });
  }
}
async function bootstrap() {
  const i18n = require<EditorI18n>(795190);
  i18n.pY({ isOversea: false });
  i18n.localI18n.changeLanguage('zh-CN');
  browser.CardBuilderGlobalState = { t: i18n.t, language: 'zh-CN' };
  const coreI18n = require<{
    oc: {
      init(options: unknown): Promise<void>;
      addResourceBundle(
        locale: string,
        namespace: undefined,
        resources: Record<string, unknown>,
      ): void;
    };
  }>(939862).oc;
  await coreI18n.init({ lng: 'zh', fallbackLng: ['zh'] });
  coreI18n.addResourceBundle('zh', undefined, {
    ...i18n.localI18n.getResourceBundle('zh-CN', 'translation'),
    SettingPanel: '组件配置',
  });
  types = require(819500);
  host = require(0);
  subscription = host.createSubscription({
    [types.Source.CardData]: undefined,
    [types.Source.Host]: types.Host.Message,
    [types.Source.IframeLoading]: false,
    [types.Source.Disabled]: false,
  });
  const runtimeInfo = (await (await fetch('/runtime-info.json')).json()) as {
    locales: string[];
    renderer: 'simulator' | 'client';
  };
  element<HTMLAnchorElement>('#client-preview').hidden = runtimeInfo.renderer !== 'client';
  for (const locale of runtimeInfo.locales) localeSelect.add(new Option(locale, locale));
  localeSelect.value = 'zh_cn';
  sdk = require<{ K(): { getInstance(): DesignerSDK } }>(864274).K().getInstance();
  const getSimulatorConfig = sdk.pluginManager.getGlobalSimulatorConfig.bind(sdk.pluginManager);
  sdk.pluginManager.getGlobalSimulatorConfig = (...args: unknown[]) => {
    const config = getSimulatorConfig(...args);
    config.assets.push({
      name: 'cardkit_styles',
      url: [...document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')].map(
        (node) => node.href,
      ),
    });
    config.assets = config.assets.map((asset) => {
      if (!asset.contents) return asset;
      if (
        asset.name !== 'pluginManagerInjectScripts' &&
        !Object.hasOwn(browser.PLUGIN_MANAGER_EXTERNALS, asset.name)
      )
        throw Error(`unknown_inline_asset name=${asset.name}`);
      const { contents: _contents, ...rest } = asset;
      return { ...rest, url: ['/browser/editor-frame.ts'] };
    });
    return config;
  };
  ready = true;
  browser.localCardKit = {
    report,
    diagnostics,
    get sdk() {
      return sdk;
    },
    async settled() {
      let observed;
      do {
        observed = revision;
        await pendingCompilation;
      } while (observed !== revision);
      if (lastFailure) throw lastFailure;
      return compiledProject?.compiled;
    },
    async load(card, variables, locale) {
      localeSelect.value = locale;
      if (localeSelect.value !== locale) throw Error(`locale_invalid value=${locale}`);
      await loadCard(card, variables);
      const compiled = await this.settled();
      if (!compiled) throw Error('editor_not_compiled');
      return compiled;
    },
    exportProject() {
      if (!compiledProject) throw Error('editor_not_compiled');
      return { card: compiledProject.card, variables: compiledProject.variables };
    },
  };
  await loadCard(await (await fetch(element<HTMLSelectElement>('#card-example').value)).json());
}

sourceView.addEventListener('input', () => {
  ++revision;
  compiledProject = undefined;
  vrView.value = '';
  state('edited', '源码已修改，点击“应用源码到编辑器”');
  controls();
});
element('#load-example').addEventListener('click', () =>
  action(async () =>
    loadCard(await (await fetch(element<HTMLSelectElement>('#card-example').value)).json()),
  ),
);
element('#apply-source').addEventListener('click', () =>
  action(() => loadCard(JSON.parse(sourceView.value), current.variables)),
);
const fileInput = element<HTMLInputElement>('#file-input');
element('#import-card').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () =>
  action(async () => {
    const file = fileInput.files![0];
    if (!file) return;
    const input = JSON.parse(await file.text());
    await loadCard(input.card ?? input, input.variables ?? []);
    fileInput.value = '';
  }),
);
element('#save-project').addEventListener('click', () =>
  action(() => download(browser.localCardKit.exportProject(), 'local-cardkit.json')),
);
element('#export-card').addEventListener('click', () =>
  action(() => download(browser.localCardKit.exportProject().card, `card-${schema}.json`)),
);
element('#export-vr').addEventListener('click', () =>
  action(() =>
    download(
      {
        card: compiledProject!.compiled.card,
        attachmentMeta: compiledProject!.compiled.attachment,
      },
      `card-${schema}.vr.json`,
    ),
  ),
);
element('#migrate-card').addEventListener('click', () =>
  action(async () => {
    const version = revision;
    const variables = structuredClone(current.variables);
    const result = await api<{ card: CardDocument; warnings: unknown[] }>('migrate', {
      card: publicCard(),
      variables,
      locale: current.locale,
      allowShared: element<HTMLInputElement>('#allow-shared').checked,
    });
    if (version !== revision)
      throw Error('editor_changed_during_migration: 已保留新修改；请基于当前卡片重新转换');
    result.warnings.forEach((warning) => report('migration.warning', warning));
    await loadCard(result.card, variables);
  }),
);
localeSelect.addEventListener('change', () =>
  action(() => loadCard(publicCard(), current.variables)),
);
window.addEventListener('error', (event) => report('frame.error', { message: event.message }));
window.addEventListener('unhandledrejection', (event) =>
  report('frame.error', { message: String(event.reason) }),
);
bootstrap().catch((error: Error) => {
  state('error', error.message);
  report('bootstrap.failed', { message: error.message, stack: error.stack });
});
