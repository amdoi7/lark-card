# 飞书卡片 JSON 2.0 字段与约束

适用于 `"schema": "2.0"`；未声明 `schema` 的卡片默认为 1.0。1.0 的字段定义见[官方 1.0 结构](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-structure)。2.0 仅支持共享卡片，要求飞书客户端 7.20 及以上；一张卡片最多 200 个元素或组件。完整定义见[官方 2.0 结构](https://open.feishu.cn/document/feishu-cards/card-json-v2-structure)。

## 结构索引

| 字段 | 含义 |
| --- | --- |
| `header` | 卡片标题区域。 |
| `body.elements` | 正文组件数组。 |
| `tag` | 组件类型。 |
| `elements` | 支持子组件的容器中的组件数组。 |
| `column_set.columns` | 分栏容器中的列数组；每列的子组件位于 `column.elements`。 |
| `direction` | 支持布局属性的容器内的排列方向；`vertical` 为纵向，`horizontal` 为横向，默认纵向。 |
| `content` / `i18n_content` | 组件文本或按语言区分的文本内容。 |

## 视觉效果到字段的映射

| 想达到的效果 | 字段映射 |
| --- | --- |
| 多个组件上下排列 | 在 `body` 或支持布局属性的容器中，将组件放进同一个 `elements`，设 `direction: "vertical"`；这是默认方向。调整先后顺序即调整上下顺序。 |
| 多个组件左右排列 | 父容器设 `direction: "horizontal"`；若需要分别控制两侧宽度和对齐，使用 `column_set`，每一侧放在一个 `column.elements` 中。 |
| 左右占比 1:4、1:1 | 在同一个 `column_set` 中，两列分别设 `width: "weighted"`，`weight` 设为 1 和 4，或都设为 1。`weight` 是 1–5 的整数；列宽设置只在 `flex_mode: "none"` 时生效。 |
| 内容靠左、居中、靠右 | 在父容器设置 `horizontal_align` 为 `left`、`center` 或 `right`；`column_set` 控制列的对齐，`column` 控制列内组件的对齐。文本本身另看组件的 `text_align`。 |
| 列内内容靠上、居中、靠下 | 在对应 `column` 设置 `vertical_align: "top" / "center" / "bottom"`。 |
| 调整间距和留白 | 父容器的 `vertical_spacing` / `horizontal_spacing` 控制子项之间的距离；`padding` 控制容器内边距；组件的 `margin` 控制该组件外边距。 |
| 整张卡片更宽或更窄 | `config.width_mode` 可设 `compact` 或 `fill`；不设置时使用默认宽度。 |

列宽 1:4、左列内容垂直居中的结构示例：

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

`column_set.columns` 的顺序是列顺序；`column.elements` 的顺序是列内组件顺序。`column.direction` 控制列内组件横排或纵排。

## 分栏与窄屏规则

| `column_set.flex_mode` | 窄屏排列 | 列宽规则 |
| --- | --- | --- |
| `none` | 按比例压缩。 | 使用列的 `width` 和 `weight`。 |
| `stretch` | 变为上下堆叠。 | 不使用 `none` 模式的列宽配比。 |
| `flow` | 放不下时换行。 | 不使用 `none` 模式的列宽配比。 |
| `bisect` / `trisect` | 分别按两列 / 三列等分。 | 不使用 `none` 模式的列宽配比。 |

**只有 `none` 使用列的 `width` 和 `weight`**。分栏属性的完整适用范围见[官方分栏文档](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/column-set)。

`padding` 和 `margin` 的四值顺序为上、右、下、左；间距可用预设值 `small` 对应 4px、`medium` 对应 8px、`large` 对应 12px、`extra_large` 对应 16px，或直接使用 `0–99px`。组件支持的属性及默认值不同，以[官方结构](https://open.feishu.cn/document/feishu-cards/card-json-v2-structure)和对应组件文档为准。

## 容器、文本与版本约束

| 对象 | 约束或语义 | 官方定义 |
| --- | --- | --- |
| 容器 | 最多嵌套五层；这是容器层级，不是任意 JSON 对象的深度。 | [表单](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/form-container)、[折叠面板](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/collapsible-panel) |
| 表单 | 不能嵌套表单或表格；表单内必须包含提交按钮。表单内交互组件的 `name` 影响提交回传。 | [表单容器](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/form-container) |
| 折叠面板 | 不能嵌套表单。 | [折叠面板](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/containers/collapsible-panel) |
| 标题 | 主标题最多四行，副标题最多一行，超出省略。 | [标题](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/content-components/title) |
| Markdown | 使用飞书卡片的链接和转义语法，与普通 Markdown 不完全一致。 | [富文本](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/content-components/rich-text) |
| 多语言 | 2.0 使用组件级多语言字段和 `config.locales`；不支持 1.0 的全局多语言内容结构 `i18n_elements` / `i18n_header`。 | [多语言配置](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/configure-multi-language-content) |
| 1.0 专有配置 | 旧 `action` 交互模块、自定义 `fallback` 和旧图片通栏配置不直接适用于 2.0；2.0 会对不支持的属性报错。 | [不兼容变更](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-breaking-changes-release-notes) |

## 组件属性索引

- [按钮：宽度、文字及行为](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/interactive-components/button)
- [输入框](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/interactive-components/input)
- [表格](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/content-components/table)
- [组件概览](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/component-json-v2-overview)
