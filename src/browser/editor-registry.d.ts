declare module '*editor-registry.mjs' {
  export const modules: Record<
    string,
    (module: unknown, exports: unknown, require: unknown) => void
  >;
}
