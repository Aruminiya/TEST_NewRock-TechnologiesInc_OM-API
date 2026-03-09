# HTTP 1.0 相容性問題 - 深入解析

## 問題摘要

Node.js 的 http 模組（包含 axios、node-fetch 等）在與 HTTP 1.0 伺服器通訊時，可能出現 `socket hang up` 錯誤。這是由於 HTTP 協議版本差異導致的連接管理問題。

---

## 實際案例：NewRock OM 系列設備

### 設備背景

**NewRock OM 系列**是 IP PBX / VoIP 閘道設備，提供 XML API 介面供外部系統控制撥打電話、查詢狀態等功能。

### 確認 HTTP 版本

```bash
curl -v -X POST -H "Content-Type: text/xml" \
  -d '<?xml version="1.0"?><Transfer attribute="Connect"><ext id="9038"/><ext id="9037"/></Transfer>' \
  http://192.168.5.240/xml

# 回應顯示：
# < HTTP/1.0 200 OK       ← 確認為 HTTP 1.0
# < Connection: close     ← 回應後立即關閉連接
```

### 為什麼 NewRock OM 使用 HTTP 1.0

| 原因 | 說明 |
|------|------|
| **嵌入式系統資源有限** | CPU/記憶體有限，HTTP 1.0 實作簡單、佔用資源少 |
| **API 呼叫特性** | 每次 API 呼叫是獨立的，不需要 keep-alive 持久連接 |
| **韌體穩定性優先** | 工業設備重視穩定，不輕易更新協議實作 |
| **設備生命週期長** | 硬體設備可能使用多年，韌體版本較舊 |

### 問題現象

使用 Node.js + axios 發送請求時：

```typescript
// 這段程式碼會失敗
import axios from 'axios';

const response = await axios.post('http://192.168.5.240/xml', xmlData, {
  headers: { 'Content-Type': 'text/xml' }
});
// 錯誤: socket hang up
```

### 解決方案

使用 `net` 模組手動發送 HTTP 1.0 請求（詳見後續章節）。

---

## 1. HTTP 協議演進

### HTTP 1.0（1996 年）

```
Client                          Server
  |                               |
  |  ─── TCP 連接建立 ───────>    |
  |  ─── HTTP 請求 ───────────>   |
  |  <─── HTTP 回應 ────────────  |
  |  <─── TCP 連接關閉 ─────────  |  ← 每次請求後關閉
  |                               |
  |  ─── TCP 連接建立 ───────>    |  ← 下次請求重新建立
  |  ─── HTTP 請求 ───────────>   |
  |  ...                          |
```

**特點：**
- 每個請求使用獨立的 TCP 連接
- 伺服器回應後**立即關閉連接**
- 無 `Connection` header（或 `Connection: close`）

### HTTP 1.1（1997 年）

```
Client                          Server
  |                               |
  |  ─── TCP 連接建立 ───────>    |
  |  ─── HTTP 請求 1 ──────────>  |
  |  <─── HTTP 回應 1 ───────────  |
  |  ─── HTTP 請求 2 ──────────>  |  ← 重複使用同一連接
  |  <─── HTTP 回應 2 ───────────  |
  |  ─── HTTP 請求 3 ──────────>  |
  |  <─── HTTP 回應 3 ───────────  |
  |  ...                          |
  |  <─── TCP 連接關閉 ─────────  |  ← 閒置一段時間後才關閉
```

**特點：**
- 預設 **keep-alive**（持久連接）
- 多個請求可重複使用同一 TCP 連接
- 需要明確發送 `Connection: close` 才會關閉

---

## 2. 關鍵差異：連接管理

| 特性 | HTTP 1.0 | HTTP 1.1 |
|------|----------|----------|
| 預設連接 | 短連接（回應後關閉） | 持久連接（keep-alive） |
| Connection header | 無或 `close` | 預設 `keep-alive` |
| 連接關閉時機 | 回應結束後立即關閉 | 閒置超時或明確關閉 |
| Content-Length | 可選（靠連接關閉判斷結束） | 必須或使用 chunked |

### HTTP 1.0 判斷回應結束的方式

```
方式 1: Content-Length header
  → 讀取指定長度的 bytes 後，回應結束

方式 2: 連接關閉
  → 當伺服器關閉 TCP 連接時，回應結束
  → 這是 HTTP 1.0 常用的方式
```

---

## 3. Node.js http 模組的行為

### 預設使用 HTTP 1.1

Node.js http 模組發送請求時：

```
GET /api HTTP/1.1        ← 預設使用 HTTP 1.1
Host: example.com
Connection: keep-alive   ← 預設期望持久連接
```

### 連接池（Connection Pool）

```javascript
// Node.js 內部使用 Agent 管理連接池
const agent = new http.Agent({
  keepAlive: true,      // 預設 true（Node.js 19+）
  maxSockets: 5,        // 每個 host 最多 5 個連接
});
```

**連接池運作方式：**

```
┌─────────────────────────────────────────────┐
│              Connection Pool                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ Socket1 │ │ Socket2 │ │ Socket3 │ ...   │
│  │ (idle)  │ │ (active)│ │ (idle)  │       │
│  └─────────┘ └─────────┘ └─────────┘       │
└─────────────────────────────────────────────┘
         ↑
         │ 重複使用連接
         │
    ┌────┴────┐
    │ Request │
    └─────────┘
```

---

## 4. 問題發生的根本原因

### 時序圖：正常 HTTP 1.1 流程

```
Client (Node.js)              Server (HTTP 1.1)
      |                              |
      | ──── SYN ──────────────────> |  TCP 三次握手
      | <─── SYN-ACK ─────────────── |
      | ──── ACK ──────────────────> |
      |                              |
      | ──── HTTP Request ─────────> |
      | <─── HTTP Response ───────── |
      |                              |
      | (等待下一個請求...)           |  ← 連接保持開啟
      |                              |
```

### 時序圖：HTTP 1.0 伺服器導致的問題

```
Client (Node.js)              Server (HTTP 1.0)
      |                              |
      | ──── SYN ──────────────────> |  TCP 三次握手
      | <─── SYN-ACK ─────────────── |
      | ──── ACK ──────────────────> |
      |                              |
      | ──── HTTP Request ─────────> |
      | <─── HTTP Response ───────── |
      | <─── FIN ────────────────── |  ← 伺服器立即關閉連接
      |                              |
      | !!! socket hang up !!!       |  ← Node.js 認為連接異常中斷
      |                              |
```

### 為什麼 Node.js 認為是「異常中斷」？

```javascript
// Node.js http 模組內部邏輯（簡化）

socket.on('close', () => {
  if (response.complete) {
    // 回應完整，正常關閉
  } else {
    // 回應不完整，認為是異常
    emit('error', new Error('socket hang up'));
  }
});
```

**問題在於：**

1. HTTP 1.0 伺服器發送完回應後立即關閉連接
2. Node.js 可能還沒完全處理完回應
3. TCP FIN 封包到達時，Node.js 認為是「意外關閉」
4. 觸發 `socket hang up` 錯誤

---

## 5. TCP 層面的詳細分析

### 正常關閉 vs 異常關閉

```
正常關閉（Graceful Close）:
  Client          Server
    |               |
    | <─── FIN ──── |  Server 發起關閉
    | ──── ACK ───> |  Client 確認
    | ──── FIN ───> |  Client 也關閉
    | <─── ACK ──── |  Server 確認
    |               |
    (四次揮手完成)

異常關閉（RST）:
  Client          Server
    |               |
    | <─── RST ──── |  直接重置，無需確認
    |               |
    (連接立即終止)
```

### HTTP 1.0 伺服器的行為

某些舊的 HTTP 1.0 伺服器在發送完回應後：

1. 發送 TCP FIN 開始關閉連接
2. 可能不等待 Client 的 ACK
3. 或者使用 RST 直接重置

Node.js 的 http 模組對這種「提前關閉」處理不佳。

---

## 6. 實際封包分析

### 使用 tcpdump 或 Wireshark 觀察

```bash
# 監聽網路封包
sudo tcpdump -i any host 192.168.5.240 -nn
```

### curl 成功的封包流程

```
1. TCP SYN      (Client → Server)
2. TCP SYN-ACK  (Server → Client)
3. TCP ACK      (Client → Server)
4. HTTP POST    (Client → Server)
5. HTTP 200 OK  (Server → Client)
6. TCP FIN      (Server → Client)  ← curl 正確處理
7. TCP ACK      (Client → Server)
8. TCP FIN      (Client → Server)
9. TCP ACK      (Server → Client)
```

### Node.js 失敗的封包流程

```
1. TCP SYN      (Client → Server)
2. TCP SYN-ACK  (Server → Client)
3. TCP ACK      (Client → Server)
4. HTTP POST    (Client → Server)
5. HTTP 200 OK  (Server → Client)
6. TCP FIN      (Server → Client)  ← Node.js 誤判為異常
   ↓
   socket hang up 錯誤
```

---

## 7. 為什麼 curl 可以，Node.js 不行？

### curl 的處理方式

```c
// curl 內部邏輯（C 語言，簡化）

while (receiving) {
  bytes = recv(socket, buffer, size);

  if (bytes == 0) {
    // 連接關閉 = 回應結束
    // 對於 HTTP 1.0 這是正常的
    break;
  }

  process(buffer, bytes);
}
// 成功完成
```

### Node.js http 模組的處理方式

```javascript
// Node.js 內部邏輯（簡化）

socket.on('data', (chunk) => {
  parser.execute(chunk);
});

socket.on('close', (hadError) => {
  if (!parser.finished) {
    // 解析器還沒完成，認為是錯誤
    this.emit('error', new Error('socket hang up'));
  }
});
```

**關鍵差異：**

| 特性 | curl | Node.js http |
|------|------|--------------|
| 連接關閉處理 | 視為正常結束信號 | 檢查解析器狀態 |
| HTTP 1.0 支援 | 完整支援 | 部分支援 |
| 設計目標 | 廣泛相容性 | 現代 HTTP 優化 |

---

## 8. 解決方案原理

### 方案 A：使用 net 模組

```javascript
import net from 'net';

// 直接操作 TCP socket
const socket = net.createConnection(80, host);

socket.on('end', () => {
  // 我們自己處理連接關閉
  // 視為正常結束，不是錯誤
  parseResponse(buffer);
});
```

**為什麼有效：**
- 繞過 http 模組的「智慧」判斷
- 自己控制如何解釋連接關閉
- 可以正確處理 HTTP 1.0 的行為

### 方案 B：使用 curl

```javascript
import { exec } from 'child_process';

// 讓 curl 處理 HTTP 協議
exec(`curl -X POST ${url}`, callback);
```

**為什麼有效：**
- curl 對 HTTP 1.0 有完整支援
- 完全繞過 Node.js 的 http 實作

---

## 9. 總結

### 問題根源

```
HTTP 1.0 伺服器          Node.js http 模組
     │                         │
     │ 發送回應後立即關閉        │ 預期 keep-alive
     │ Connection: close       │ 連接保持開啟
     │                         │
     └──────── 不匹配 ──────────┘
                 ↓
          socket hang up
```

### 技術層面

1. **協議版本差異**：HTTP 1.0 vs HTTP 1.1 的連接管理完全不同
2. **Node.js 設計取捨**：針對現代 HTTP 優化，對舊協議相容性較差
3. **TCP 層面**：伺服器的 FIN 被誤判為異常中斷

### 解決方案選擇

| 情境 | 建議 |
|------|------|
| 臨時解決 | 使用 curl |
| 生產環境 | 使用 net 模組封裝 |
| 長期方案 | 升級伺服器到 HTTP 1.1+（若可行） |

### 針對 NewRock OM 設備

由於 NewRock OM 是嵌入式硬體設備，無法升級 HTTP 協議版本，因此：

- **建議方案**：使用 `net` 模組封裝 HTTP 1.0 請求
- **替代方案**：使用 curl 執行請求
- **不可行**：升級設備韌體（廠商可能不支援 HTTP 1.1）

---

## 10. 附錄：驗證命令

### 確認伺服器 HTTP 版本

```bash
curl -v http://your-server/api 2>&1 | grep "HTTP/"

# 輸出範例：
# < HTTP/1.0 200 OK    ← HTTP 1.0
# < HTTP/1.1 200 OK    ← HTTP 1.1
```

### 觀察連接關閉行為

```bash
curl -v http://your-server/api 2>&1 | grep -E "(Connection|close)"

# HTTP 1.0 通常會看到：
# < Connection: close
# * Closing connection
```

### Node.js 偵錯

```javascript
// 啟用 HTTP 偵錯
process.env.NODE_DEBUG = 'http';

// 或執行時
NODE_DEBUG=http node app.js
```
