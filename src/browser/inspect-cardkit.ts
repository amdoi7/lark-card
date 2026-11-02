type InspectorResource = {
  name: string;
  version?: string;
  libraryName?: string;
  scriptType?: string;
  url?: string | string[];
  contents?: { type: string }[];
};

type InspectorWindow = Window & {
  NCLCSimulatorHost: {
    config: { assets?: InspectorResource[]; runtime?: InspectorResource };
    plugins: InspectorResource[];
    canvas: { designer: { pluginManager: { simulatorModuleAdapters: unknown[] } } };
  };
  NCLCSimulatorRuntime?: {
    runtime?: {
      installedPlugin: Map<
        string,
        InspectorResource & {
          module: { exports: Record<string, unknown> & { components?: object } };
        }
      >;
    };
  };
};

(() => {
  const frame = document.querySelector<HTMLIFrameElement>('iframe[title="nclc-runtime-frame"]');
  const view = (frame ? frame.contentWindow : window) as InspectorWindow;
  let host, doc;
  try {
    host = view.NCLCSimulatorHost;
    doc = view.document;
  } catch (error) {
    throw Error(
      `iframe_origin_boundary: 请在 DevTools 的执行上下文中选择 nclc-runtime-frame 再运行。${(error as Error).message}`,
    );
  }
  if (!host)
    throw Error('simulator_host_missing: 请在已加载卡片的 CardKit 页面或其 runtime iframe 运行');
  const assetURL = (value: string) => {
    const url = new URL(value, doc.baseURI);
    if (!['http:', 'https:'].includes(url.protocol)) return { scheme: url.protocol };
    const hadQuery = !!url.search;
    return { url: url.origin + url.pathname, queryOmitted: hadQuery };
  };
  const resource = (item: InspectorResource | Function) => {
    if (typeof item === 'function') return { localFunction: item.name };
    return {
      name: item.name,
      version: item.version,
      libraryName: item.libraryName,
      scriptType: item.scriptType,
      urls: item.url ? (Array.isArray(item.url) ? item.url : [item.url]).map(assetURL) : [],
      inlineTypes: item.contents?.map((content) => content.type),
    };
  };
  const runtime = view.NCLCSimulatorRuntime?.runtime;
  const result = {
    assets: (host.config.assets || []).map(resource),
    runtime: host.config.runtime ? resource(host.config.runtime) : null,
    plugins: host.plugins.map(resource),
    installedPlugins: runtime
      ? [...runtime.installedPlugin].map(([name, plugin]) => ({
          name,
          ...resource(plugin),
          exports: Object.keys(plugin.module.exports),
          components: Object.keys(plugin.module.exports.components || {}),
        }))
      : [],
    scripts: [...doc.scripts].filter((script) => script.src).map((script) => assetURL(script.src)),
    styles: [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((link) =>
      assetURL(link.href),
    ),
    hostPrototype: Object.getOwnPropertyNames(Object.getPrototypeOf(host)),
    adapterCount: host.canvas.designer.pluginManager.simulatorModuleAdapters.length,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
})();
