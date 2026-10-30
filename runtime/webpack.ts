type VendorModule = { exports: unknown; paths?: unknown[]; children?: unknown[] };
type VendorFactory = (module: VendorModule, exports: unknown, require: ReturnType<typeof createRequire>) => void;

export function createRequire(modules: Record<string, VendorFactory>) {
  const cache: Record<string, VendorModule> = {};
  function require<T = unknown>(id: string | number): T {
    if (cache[id]) return cache[id].exports as T;
    if (!Object.hasOwn(modules, id)) throw Error(`editor_module_unavailable id=${id}`);
    const module = cache[id] = { exports: {} };
    modules[id](module, module.exports, require);
    return module.exports as T;
  }
  require.d = (exports: object, definitions: Record<string, () => unknown>) => {
    for (const key in definitions) if (!Object.hasOwn(exports, key)) Object.defineProperty(exports, key, { enumerable: true, get: definitions[key] });
  };
  require.n = (module: unknown) => {
    const vendor = module as { __esModule?: boolean; default?: unknown };
    const getter = module && vendor.__esModule ? () => vendor.default : () => module;
    require.d(getter, { a: getter });
    return getter;
  };
  require.r = (exports: object) => {
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    Object.defineProperty(exports, '__esModule', { value: true });
  };
  require.o = (object: object, key: PropertyKey) => Object.hasOwn(object, key);
  require.g = globalThis;
  require.p = '/cardkit/';
  require.b = location.href;
  require.nmd = (module: VendorModule) => { module.paths = []; module.children = []; return module; };
  require.hmd = (module: VendorModule) => module;
  require.e = async () => {};
  require.t = (value: unknown, mode: number) => {
    if (mode & 1) value = require(value as string | number);
    if (mode & 8 || typeof value === 'object' && value && mode & 4 && (value as { __esModule?: boolean }).__esModule) return value;
    const exports = Object.create(null);
    require.r(exports);
    Object.defineProperty(exports, 'default', { enumerable: true, value });
    if (mode & 2 && typeof value !== 'string') for (const key in value as Record<string, unknown>) Object.defineProperty(exports, key, { enumerable: true, get: () => (value as Record<string, unknown>)[key] });
    return exports;
  };
  return require;
}
