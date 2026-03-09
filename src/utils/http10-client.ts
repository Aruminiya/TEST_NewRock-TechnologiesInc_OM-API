/**
 * HTTP 1.0 Client
 * 用於連接只支援 HTTP 1.0 的舊式伺服器（如 NewRock OM 設備）
 *
 * 為什麼需要這個？
 * Node.js 的 http 模組和 axios 對 HTTP 1.0 相容性不佳，會出現 socket hang up 錯誤。
 * 這個模組使用 net 模組直接發送 raw HTTP 1.0 請求，繞過相容性問題。
 */

import net from 'net';

export interface Http10Response {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface Http10RequestOptions {
  host: string;
  port?: number;
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

/**
 * 發送 HTTP 1.0 請求
 */
export function http10Request(options: Http10RequestOptions): Promise<Http10Response> {
  const {
    host,
    port = 80,
    path,
    method = 'GET',
    headers = {},
    body = '',
    timeout = 10000,
  } = options;

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, host);

    // 設定超時
    socket.setTimeout(timeout);

    // 構建請求 headers
    const requestHeaders: Record<string, string> = {
      Host: host,
      Connection: 'close',
      ...headers,
    };

    // 如果有 body，加上 Content-Length
    if (body) {
      requestHeaders['Content-Length'] = String(Buffer.byteLength(body));
    }

    // 構建 HTTP 1.0 請求
    const headerLines = Object.entries(requestHeaders)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\r\n');

    const request = [
      `${method} ${path} HTTP/1.0`,
      headerLines,
      '',
      body,
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
      const headerLines = headerPart.split('\r\n');
      const statusLine = headerLines[0];

      // 解析狀態碼
      const statusMatch = statusLine.match(/HTTP\/\d\.\d (\d+)/);
      const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;

      // 解析 headers
      const responseHeaders: Record<string, string> = {};
      for (let i = 1; i < headerLines.length; i++) {
        const colonIndex = headerLines[i].indexOf(':');
        if (colonIndex > 0) {
          const key = headerLines[i].slice(0, colonIndex).trim().toLowerCase();
          const value = headerLines[i].slice(colonIndex + 1).trim();
          responseHeaders[key] = value;
        }
      }

      resolve({
        status,
        headers: responseHeaders,
        body: bodyParts.join('\r\n\r\n'),
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Request timeout'));
    });

    socket.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * 快捷方法：GET 請求
 */
export function http10Get(host: string, path: string, options?: Partial<Http10RequestOptions>): Promise<Http10Response> {
  return http10Request({ host, path, method: 'GET', ...options });
}

/**
 * 快捷方法：POST 請求
 */
export function http10Post(host: string, path: string, body: string, options?: Partial<Http10RequestOptions>): Promise<Http10Response> {
  return http10Request({ host, path, method: 'POST', body, ...options });
}
