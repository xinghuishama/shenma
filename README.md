# 神码再现 v3.4 — GitHub Pages 部署版

> 🎯 一个可直接部署到 GitHub Pages 的六合彩智能分析工具。离线可用，Worker 加速，Web 版与 APK 版共用同一套前端代码。

## 在线体验

部署后访问地址：
```
https://你的用户名.github.io/shenma/
```

## 部署步骤（30 秒搞定）

### 方式 1：直接上传（最简单）

1. 访问 [github.com/new](https://github.com/new) 创建新仓库
2. 仓库名建议：`shenma`（或其他你喜欢的名字）
3. 上传这 5 个文件到仓库根目录：
   ```
   index.html
   app.js
   worker.js
   style.css
   data.js
   ```
4. 仓库 → **Settings → Pages** → Source 选 **Deploy from a branch** → 选 `main` 分支 → Save
5. 等待 1-2 分钟，访问 `https://你的用户名.github.io/shenma/`

### 方式 2：Git 命令行

```bash
git clone https://github.com/你的用户名/shenma.git
cd shenma
cp /path/to/这5个文件/ .
git add .
git commit -m "v3.4 initial"
git push origin main
```

然后去仓库 **Settings → Pages** 开启 Pages 服务即可。

---

## 项目特性

| 特性 | 说明 |
|------|------|
| ⚡ Web Worker 全量计算 | 解析 + 频次统计 + 筛选命中全部移入 Worker，主线程零阻塞 |
| 🔒 无 XSS 面 | 事件代理模式，零 inline onclick |
| 📴 离线可用 | localStorage 缓存开奖数据 + 筛选状态 |
| 🧠 缓存签名 | 筛选条件变更自动重建匹配函数，防止状态不一致 |
| ✂️ 命中剪枝 | `hit > 3` 提前退出，减少无效 CPU 消耗 |
| 📱 12 维筛选器 | 杀码 / 生肖 / 头数 / 尾数 / 数段 / 波色 / 五行 / 半单双 / 合数 |
| 🎱 3D 蛋形球 | 真实开奖风格红/绿/蓝蛋形球，完整五行/生肖/波色标签 |
| 🎯 独苗守护 | 仅有一个号码未命中时，触发飞入动画 + 脉冲高亮 |

---

## 技术栈

- **Vanilla JS** — 无框架依赖，零构建工具
- **Web Worker** — 独立文件 worker.js，非 Blob URL
- **Tailwind CSS** — 通过 CDN 加载
- **TypedArray** — `Uint8Array` / `Uint16Array` 降低内存与 GC 压力
- **DocumentFragment** — 批量 DOM 插入，减少重排

---

## 文件说明

| 文件 | 作用 |
|------|------|
| `index.html` | 入口页面，CDN 资源 + 本地资源引用 |
| `app.js` | 主线程：状态管理 / 事件代理 / 渲染 / 抽屉系统 / 离线缓存 |
| `worker.js` | Worker 线程：输入解析 / 频次统计 / 筛选命中 / 剪枝优化 |
| `style.css` | 全部样式：3D 球 / 蛋形球 / 动画 / 抽屉 / 历史记录 |
| `data.js` | 静态数据：生肖 / 波色 / 五行 / 数段 / numProps 预计算 |

---

## APK 打包

如果需要打包成 Android APK，请使用对应的 Android Studio 工程：

[下载 shenma-v34.zip（Android Studio 工程）](https://你的发布地址/shenma-v34.zip)

或者参考这个仓库的 `android/` 目录（如果有）。

---

## 截图预览

![预览](preview.jpg)

---

## 开源协议

MIT License — 自由使用，二次开发请注明出处。

---

> 💡 提示：GitHub Pages 免费额度无流量限制，适合个人长期托管。
