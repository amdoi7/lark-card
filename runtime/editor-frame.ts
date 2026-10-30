type EditorHost = Window & {
  localCardKitHostReady: boolean;
  NCLC_PLUGIN_EXTERNALS: Map<unknown, unknown>;
  PLUGIN_MANAGER_EXTERNALS: Record<string, unknown>;
  CardBuilderSDKGlobalVar: unknown;
  localCardKit: { report(operation: string, detail: unknown): void };
};

(() => {
  const frame = window as unknown as EditorHost;
  const host = parent as EditorHost;
  if (frame.localCardKitHostReady) return;
  frame.localCardKitHostReady = true;
  frame.NCLC_PLUGIN_EXTERNALS = new Map();
  const externals = host.PLUGIN_MANAGER_EXTERNALS;
  for (const [index, [name, value]] of Object.entries(externals).entries()) (frame as unknown as Record<string, unknown>)[`${name}_${index}`] = value;
  Object.assign(frame, {
    React: externals.react,
    ReactDOM: externals['react-dom'],
    mobx: externals.mobx,
    mobxReact: externals['mobx-react'],
    mobxReactLite: externals['mobx-react-lite'],
    NCLCDesigner: externals['@nclc/designer'],
    Vchart: externals['@visactor/vchart'],
    CardBuilderSDKGlobalVar: host.CardBuilderSDKGlobalVar,
  });
  frame.addEventListener('error', event => host.localCardKit.report('frame.error', { message: event.message }));
  frame.addEventListener('unhandledrejection', event => {
    const error = event.reason?.error || event.reason;
    host.localCardKit.report('frame.error', { message: error?.stack || error?.message || JSON.stringify(error) });
  });
})();
