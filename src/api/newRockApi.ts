import { http10Post } from '../utils/http10-client.js';

const API_HOST = '192.168.5.240';
const API_PATH = '/xml';

// 測試撥打電話
export async function mackeCall(from: string, to: string): Promise<{ success: boolean; data?: unknown; error?: unknown }> {
  const xmlData = `
    <?xml version="1.0" encoding="utf-8" ?>
    <Transfer attribute="Connect">
        <ext id="${from}"/>
        <ext id="${to}"/>
    </Transfer>
  `;

  try {
    const response = await http10Post(API_HOST, API_PATH, xmlData, {
      headers: { 'Content-Type': 'text/xml' },
    });
    return { success: true, data: response }; // 返回成功
  } catch (error) {
    console.error('錯誤:', (error as Error).message);
    return { success: false, error }; // 返回錯誤
  }
}
