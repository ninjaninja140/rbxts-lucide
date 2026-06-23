# @nrbx/lucide

> Lucide icons for Roblox React ([@rbxts/react](https://www.npmjs.com/package/@rbxts/react))

A roblox-ts package that brings the beautiful [Lucide](https://lucide.dev) icon set to Roblox. Over **1,700 icons** available as typed React components, with support for dynamic lookup, icon combining, and full Roblox ImageLabel props.

## 📦 Installation

```bash
npm install @nrbx/lucide
# or
yarn add @nrbx/lucide
# or
pnpm add @nrbx/lucide
```

Add to your Rojo project file under `node_modules`:

```json
"node_modules": {
  "$className": "Folder",
  "@rbxts": {
    "$path": "node_modules/@rbxts"
  },
  "@nrbx": {
    "$path": "node_modules/@nrbx"
  }
}
```

And to your `tsconfig.json`:

```json
"typeRoots": ["node_modules/@rbxts", "node_modules/@nrbx"]
```

## 🚀 Quick Start

```tsx
import React from "@rbxts/react";
import { Activity, Heart, Settings } from "@nrbx/lucide";

function MyComponent() {
    return (
        <frame Size={new UDim2(0, 200, 0, 200)}>
            <Activity
                Size={new UDim2(0, 48, 0, 48)}
                Position={new UDim2(0, 10, 0, 10)}
                ImageColor3={new Color3(1, 1, 1)}
            />
        </frame>
    );
}
```

## 🎨 Usage

### Named Icon Components

Every icon is available as a PascalCase named export:

```tsx
import { ArrowRight, Bell, Camera, Download, Mail, User } from "@nrbx/lucide";

<ArrowRight Size={new UDim2(0, 32, 0, 32)} />
```

### Dynamic Icon (`DynamicIcon`)

Resolve an icon by its kebab-case name string at runtime:

```tsx
import { DynamicIcon } from "@nrbx/lucide";

const iconName = "activity";

<DynamicIcon name={iconName} Size={new UDim2(0, 48, 0, 48)} />
```

### Icon Combining (`CombineIcons`)

Layer multiple icons together — Lucide's icon composition pattern:

```tsx
import { CombineIcons } from "@nrbx/lucide";

// Places "check" on top of "circle"
<CombineIcons icons={["circle", "check"]} Size={new UDim2(0, 64, 0, 64)} />
```

### Nesting Children

Icons support standard React children — nest icons within each other:

```tsx
import { Circle, Check } from "@nrbx/lucide";

<Circle Size={new UDim2(0, 64, 0, 64)}>
    <Check Size={new UDim2(0.5, 0, 0.5, 0)} Position={new UDim2(0.25, 0, 0.25, 0)} />
</Circle>
```

### Base Template (`IconTemplate`)

Use the low-level template directly with an icon id:

```tsx
import { IconTemplate } from "@nrbx/lucide";

<IconTemplate icon="activity" Size={new UDim2(0, 24, 0, 24)} />
```

## 🔧 Props

All icon components accept standard Roblox `ImageLabel` properties plus:

| Prop | Type | Description |
|------|------|-------------|
| `icon` | `string` | Icon identifier in kebab-case (e.g. `arrow-right`, `bell`) — only on `IconTemplate` |
| `name` | `string` | Icon identifier in kebab-case — only on `DynamicIcon` |
| `icons` | `string[]` | Array of icon identifiers to combine — only on `CombineIcons` |
| `children` | `React.ReactNode` | Nested content for icon combining |

All standard `ImageLabel` props are supported: `Size`, `Position`, `ImageColor3`, `BackgroundTransparency`, `AnchorPoint`, `ZIndex`, `Visible`, `LayoutOrder`, `Event`, `Change`, `Tag`, `ref`, and more.

**Defaults applied** (overridable via props):

- `Size` — `UDim2.fromOffset(24, 24)`
- `BackgroundTransparency` — `1` (transparent background)
- `ScaleType` — `"Fit"`

## 📋 Utility Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `GetIconData(name)` | `IconData \| undefined` | Full icon metadata (id, title, assetId, uri, contributors) |
| `GetIconUri(name)` | `string` | The `rbxassetid://` URI string for the icon |
| `GetAllIcons()` | `IconData[]` | Array of all available icon metadata entries |

## 🏗️ Architecture

```
@nrbx/lucide
├── src/
│   ├── IconTemplate.tsx    — Base icon component (renders ImageLabel)
│   ├── DynamicIcon.tsx     — Dynamic lookup by string name
│   ├── CombineIcon.tsx     — Layer multiple icons together
│   ├── icons.json          — Icon metadata (id, title, assetId, uri, contributors)
│   ├── icons/              — ~1,700 generated icon components
│   │   ├── activity.tsx
│   │   ├── arrow-right.tsx
│   │   ├── ...
│   │   └── index.ts        — Barrel export
│   └── index.tsx           — Package entry point
└── scripts/
    ├── generate-pngs.ts    — SVG → PNG conversion
    ├── upload-pngs.ts      — Roblox Open Cloud upload
    └── generate-icons.ts   — Component code generation
```

## 📄 License

MIT — see [LICENSE.txt](./LICENSE.txt)

---

Built with [Lucide](https://lucide.dev) icons • [roblox-ts](https://roblox-ts.com) • [@rbxts/react](https://www.npmjs.com/package/@rbxts/react)
