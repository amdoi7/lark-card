# 飞书卡片 JSON 2.0 视觉调整参考

适用于 `"schema": "2.0"` 的卡片；未声明 `schema` 默认为 1.0，不要直接套用本参考。1.0 参见[官方结构文档](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-structure)和本项目的迁移流程。2.0 仅支持共享卡片，要求飞书客户端 7.20 及以上；一张卡片最多 200 个元素或组件。完整规则见[官方 2.0 结构](https://open.feishu.cn/document/feishu-cards/card-json-v2-structure)。

## 从预览找到要改的位置

`header` 控制标题；`body.elements` 是正文组件数组，默认纵向排列。按可见文本搜索 `content`，再沿 `elements`、`columns` 找到对应组件和父容器；`tag` 表示组件类型。正文也可以有 `direction`，不要假设所有容器都纵向排列。

## 布局：从目标找到字段

| 想达到的效果 | 修改位置 |
| --- | --- |
| 多个组件上下排列 | 在 `body` 或支持布局属性的容器中，将组件放进同一个 `elements`，设 `direction: "vertical"`；这是默认方向。调整先后顺序即调整上下顺序。 |
| 多个组件左右排列 | 父容器设 `direction: "horizontal"`；若需要分别控制两侧宽度和对齐，使用 `column_set`，每一侧放在一个 `column.elements` 中。 |
| 左右占比 1:4、1:1 | 在同一个 `column_set` 中，两列分别设 `width: "weighted"`，`weight` 设为 1 和 4，或都设为 1。`weight` 是 1–5 的整数；列宽设置只在 `flex_mode: "none"` 时生效。 |
| 内容靠左、居中、靠右 | 看父容器的 `horizontal_align: "left" / "center" / "right"`；`column_set` 控制列的对齐，`column` 控制列内组件的对齐。文本本身另看组件的 `text_align`。 |
| 列内内容靠上、居中、靠下 | 在对应 `column` 设置 `vertical_align: "top" / "center" / "bottom"`。 |
| 调整间距和留白 | 父容器的 `vertical_spacing` / `horizontal_spacing` 控制子项之间的距离；`padding` 控制容器内边距；组件的 `margin` 控制该组件外边距。 |
| 整张卡片更宽或更窄 | `config.width_mode` 可设 `compact` 或 `fill`；不设置时使用默认宽度。 |

例如，标签在左、输入框在右，列宽按 1:4 分配，标签垂直居中：

```json
{
  "schema": "2.0",
  "body": {
    "elements": [{
      "tag": "column_set",
      "flex_mode": "none",
      "horizontal_spacing": "8px",
      "columns": [
        { "tag": "column", "width": "weighted", "weight": 1, "vertical_align": "center", "elements": [
          { "tag": "markdown", "content": "备注" }
        ] },
        { "tag": "column", "width": "weighted", "weight": 4, "elements": [
          { "tag": "input", "name": "note", "width": "fill", "placeholder": { "tag": "plain_text", "content": "请输入" } }
        ] }
      ]
    }]
  }
}
```

同一列里再放多个组件时，`column.direction` 控制这些组件横排或纵排；不要把 `column_set` 的列顺序与列内 `elements` 的顺序混淆。实际表单可参考 [`examples/project-assistant.card.json`](../../../examples/project-assistant.card.json)，但移动组件时必须保留原表单边界。

### 窄屏与间距

`column_set.flex_mode` 控制窄屏自适应：`none` 按比例压缩，`stretch` 变为上下堆叠，`flow` 放不下时换行，`bisect` / `trisect` 分别按两列 / 三列等分。**只有 `none` 使用列的 `width` 和 `weight`**；换成其他模式后不要仍期待 1:4 生效。查看[官方分栏文档](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/column-set)确认适用场景，并同时检查桌面与移动端效果。

`padding` 和 `margin` 的四值顺序为上、右、下、左；间距可用 `small`（4px）、`medium`（8px）、`large`（12px）、`extra_large`（16px）或 `0–99px`。组件支持的属性及默认值不同，以[官方结构](https://open.feishu.cn/document/feishu-cards/card-json-v2-structure)和对应组件文档为准。

### 文字或组件仍显示不完整

先检查父容器宽度、列宽、组件自身宽度和窄屏模式；再检查文字本身的限制。主标题最多四行、副标题最多一行，超出省略，见[标题](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/content-components/title)。按钮宽度和文字见[按钮](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/interactive-components/button)；输入框、表格及其他组件分别查[输入框](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/interactive-components/input)、[表格](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/content-components/table)或[组件概览](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/component-json-v2-overview)。

## 避免常见误改

- 2.0 会对不支持的属性报错；不要把 1.0 字段直接搬过来。包括旧 `action` 交互模块、自定义 `fallback` 和旧图片通栏配置，参见[官方不兼容变更](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-breaking-changes-release-notes)。
- 嵌套前查组件规则：表单不能嵌套表单或表格，折叠面板不能嵌套表单；容器最多嵌套五层。参见[表单](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/form-container)和[折叠面板](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/collapsible-panel)。
- 富文本的链接和转义语法以[官方 Markdown 参考](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/content-components/rich-text)为准，不要假定与普通 Markdown 完全一致。
- 多语言卡片检查对应的 `i18n_content` 和 `config.locales`；只修改 `content` 不一定改变当前语言显示的内容。2.0 不支持全局多语言配置，参见[多语言配置](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/configure-multi-language-content)。

## 修改后验证

1. 保持 `name`、`value`、链接、表单边界、按钮行为及权限不变，除非明确要求修改业务行为。表单内交互组件的 `name` 影响回传；表单需要提交按钮，详见[表单容器](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/form-container)。
2. 在项目根目录运行 `bun src/cli.ts render-batch card.json --output-dir previews`，输出目录必须不存在。查看 `previews/manifest.json` 和桌面、移动端两张图；需要时换一个新目录重复。对于动态生成的卡片，先导出各状态的 JSON。
3. 编译失败时查看错误的 `code` 和组件 `details`；出现 `resource_unresolved` 或 `simulator_component_count_decreased` 时，先排查本地资源或模拟器漏渲染，必要时用 `bun src/cli.ts render card.json --renderer client -o card-client.png` 对比，不要仅凭缺失元素修改业务卡片。后者的路径是该类型组件的候选路径，不一定全部是丢失的组件。

本地图片只能检查布局，不能证明真实移动设备表现、链接、回调、表单提交或权限正确；这些需要在真实客户端及业务环境中验证。更多预览限制和排错见 [skill](../SKILL.md)。
