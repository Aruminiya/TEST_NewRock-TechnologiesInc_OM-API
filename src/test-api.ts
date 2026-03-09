import { http10Post } from './utils/http10-client.js';

const API_HOST = '192.168.5.240';
const API_PATH = '/xml';

// 測試撥打電話
async function testCall(): Promise<void> {
  const xmlData = `<?xml version="1.0" encoding="utf-8" ?>
<Transfer attribute="Connect">
    <ext id="9038"/>
    <ext id="9037"/>
</Transfer>`;

  try {
    console.log('發送請求...');
    const response = await http10Post(API_HOST, API_PATH, xmlData, {
      headers: { 'Content-Type': 'text/xml' },
    });
    console.log('狀態碼:', response.status);
    console.log('Headers:', response.headers);
    console.log('Body:', response.body || '(空)');
  } catch (error) {
    console.error('錯誤:', (error as Error).message);
  }
}

// 執行
async function main(): Promise<void> {
  console.log('開始測試 API...\n');
  await testCall();
  console.log('\n測試完成');
}

main();
