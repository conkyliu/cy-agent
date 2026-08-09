/**
 * 渲染进程访问 preload 白名单 API 的入口与类型声明。
 * 渲染进程 MUST NOT 直接 import electron / node 模块。
 */

import type { DesktopApi } from '../../shared/ipc';

declare global {
  interface Window {
    desktop: DesktopApi;
  }
}

export const desktop: DesktopApi = window.desktop;
