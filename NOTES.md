# Node.js 測試 API 學習筆記

## 專案背景

本專案用於測試 **NewRock OM 系列** IP PBX / VoIP 閘道設備的 XML API。

### NewRock OM 設備簡介

- **類型**：IP PBX / VoIP 閘道（嵌入式硬體設備）
- **API 格式**：XML over HTTP
- **HTTP 版本**：HTTP 1.0（舊式協議）
- **用途**：透過 API 控制撥打電話、查詢狀態等

### API 範例

```xml
POST http://192.168.5.240/xml

<?xml version="1.0" encoding="utf-8" ?>
<Transfer attribute="Connect">
    <ext id="9038"/>
    <ext id="9037"/>
</Transfer>
```

此請求會讓分機 9038 和 9037 建立通話連接。

---

## 1. 專案初始化

### 建立 TypeScript + ES Modules 專案

```bash
# 初始化專案
npm init -y

# 安裝依賴
npm install axios
npm install typescript tsx @types/node -D
```

### package.json 設定

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsc && node dist/test-api.js",
    "build": "tsc",
    "start": "node dist/test-api.js"
  }
}
```

### tsconfig.json 設定

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

---

## 2. 使用 axios 測試 API

### 基本用法

```typescript
import axios, { AxiosInstance } from 'axios';

const api: AxiosInstance = axios.create({
  baseURL: 'http://your-api-url.com',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// GET 請求
const response = await api.get('/endpoint');

// POST 請求
const response = await api.post('/endpoint', { key: 'value' });
```

---

## 3. 遇到的問題：HTTP 1.0 相容性

### 問題描述

使用 axios 或 Node.js http 模組發送請求到舊的 HTTP 1.0 伺服器時，出現 `socket hang up` 錯誤。

```
POST 錯誤: socket hang up
```

### 原因分析

| 項目 | HTTP 1.0 伺服器 | Node.js http 模組 |
|------|-----------------|-------------------|
| HTTP 版本 | HTTP/1.0 | HTTP/1.1 |
| 連接方式 | 回應後立即關閉 | 預期 keep-alive |
| 結果 | 正常關閉 | 認為連接異常中斷 |

curl 可以正常運作是因為它對 HTTP 1.0 的相容性處理得比較完善。

### 重點

- **不是程式語言的問題**
- **不是 Node.js 版本的問題**
- 是 Node.js **http 模組的實作方式**與舊式伺服器不相容
- axios 底層使用 http 模組，所以也會受影響

---

## 4. 解決方案

### 方案一：使用 curl

透過 `child_process` 執行 curl 命令。

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function postXml(xmlData: string): Promise<{ status: number; body: string }> {
  const escapedXml = xmlData.replace(/'/g, "'\\''");
  const cmd = `curl -s -w "\\n%{http_code}" -X POST -H "Content-Type: text/xml" -d '${escapedXml}' ${API_URL}`;

  const { stdout } = await execAsync(cmd);
  const lines = stdout.trim().split('\n');
  const status = parseInt(lines.pop() || '0', 10);
  const body = lines.join('\n');

  return { status, body };
}
```

**優點：** 簡單可靠
**缺點：** 依賴系統有 curl

---

### 方案二：使用 net 模組

手動構建 HTTP 1.0 請求，直接用 TCP socket 發送。

```typescript
import net from 'net';

function postXml(xmlData: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(80, '192.168.5.240');

    // 手動構建 HTTP 1.0 請求
    const request = [
      'POST /xml HTTP/1.0',
      'Host: 192.168.5.240',
      'Content-Type: text/xml',
      `Content-Length: ${Buffer.byteLength(xmlData)}`,
      'Connection: close',
      '',
      xmlData,
    ].join('\r\n');

    let response = '';

    socket.on('connect', () => {
      socket.write(request);
    });

    socket.on('data', (data) => {
      response += data.toString();
    });

    socket.on('end', () => {
      // 解析 HTTP 回應
      const [headerPart, ...bodyParts] = response.split('\r\n\r\n');
      const statusLine = headerPart.split('\r\n')[0];
      const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
      const body = bodyParts.join('\r\n\r\n');

      resolve({ status, body });
    });

    socket.on('error', (error) => {
      reject(error);
    });
  });
}
```

**優點：** 純 Node.js，無外部依賴
**缺點：** 需要手動處理 HTTP 協議

---

## 5. net 模組介紹

### 什麼是 net 模組

`net` 是 Node.js 內建的 **TCP 網路模組**，用於建立低階的網路連接。

### 網路層級關係

```
應用層    axios / fetch / http 模組   ← 處理 HTTP 協議
          ↓
傳輸層    net 模組                    ← 處理 TCP 連接
          ↓
網路層    作業系統                     ← IP 封包
```

### http 模組 vs net 模組

| 模組 | 層級 | 功能 |
|------|------|------|
| `http` | 應用層 | 自動處理 HTTP 協議（headers、status code 等） |
| `net` | 傳輸層 | 只負責 TCP 連接，傳送/接收原始資料 |

### 基本用法

```typescript
import net from 'net';

// 建立 TCP 連接
const socket = net.createConnection(80, 'example.com');

// 連接成功
socket.on('connect', () => {
  socket.write('GET / HTTP/1.0\r\n\r\n');
});

// 收到資料
socket.on('data', (data) => {
  console.log(data.toString());
});

// 連接關閉
socket.on('end', () => {
  console.log('連接結束');
});

// 錯誤處理
socket.on('error', (error) => {
  console.error(error);
});
```

### 為什麼 net 能解決 HTTP 1.0 問題

- 完全控制發送的 HTTP 版本（可以指定 `HTTP/1.0`）
- 不受 Node.js http 模組的預設行為影響
- 直接處理伺服器關閉連接的情況（透過 `end` 事件）

---

## 6. 總結

| 情境 | 建議方案 |
|------|----------|
| 現代 API (HTTP 1.1/2) | axios / fetch / http 模組 |
| 舊式 API (HTTP 1.0) | net 模組 或 curl |
| 快速測試 | curl |
| 生產環境、無外部依賴 | net 模組 |
