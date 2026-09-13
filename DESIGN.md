---
version: alpha
name: Private Design Archive
colors:
  background: '#F7F7F2'
  foreground: '#252A26'
  muted: '#62685F'
  accent: '#334D37'
  border: '#DCDED4'
typography:
  body:
    fontFamily: 'Inter, PingFang SC, sans-serif'
    fontSize: 14px
    lineHeight: 1.65
  heading:
    fontFamily: 'Inter, PingFang SC, sans-serif'
    fontSize: 44px
    fontWeight: 500
    letterSpacing: -0.035em
spacing:
  sm: 8px
  md: 16px
  lg: 32px
  xl: 56px
rounded:
  sm: 6px
  md: 10px
---

## Overview

私人设计档案室：低对比背景、清晰文字和稳定网格，让收藏作品成为主角。资料库以操作效率为主，详情以截图和阅读为主。

## Colors

温和灰白底色，深绿色只用于核心操作。状态使用文字明确表达，不只靠颜色。

## Typography

界面使用易读的无衬线字体。大标题保持克制，截图、证据值和文档内容优先于装饰。

## Layout

桌面三列资料库，窄屏两列，手机单列。详情宽列显示截图，右侧窄列显示设计信息；手机顺序堆叠。

## Elevation & Depth

用细边框分隔操作区域，不堆叠阴影和玻璃层。

## Shapes

预览容器使用轻微圆角，色板使用圆形。表格和文档保留直观结构。

## Components

URL 采集框、检索栏、截图画廊、版本列表与 Markdown 预览采用一致的操作反馈。空态不显示虚构收藏或质量分。

## Do's and Don'ts

- 保持截图原有色彩和比例。
- 区分处理状态与版本质量。
- 提供键盘焦点、错误恢复和小屏操作。
- 不用装饰性指标填满面板。
- 不将开发术语放进主要用户流程。
